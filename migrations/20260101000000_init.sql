-- =====================================================================
--  VSL Studio - core schema
--  Tables: profiles, projects, assets, audit_logs
--  Security model:
--    * Every auth.users row gets a public.profiles row (trigger).
--    * New accounts land with status = 'pending' and have NO access to
--      application data until an admin flips them to 'approved'.
--    * Row Level Security is enabled everywhere; approval is enforced
--      inside the policies themselves, not only in the UI.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.user_role      as enum ('user', 'admin');
create type public.user_status    as enum ('pending', 'approved', 'rejected', 'suspended');
create type public.project_status as enum ('draft', 'analyzing', 'analyzed', 'failed');
create type public.asset_type     as enum ('sales_page', 'quiz');
create type public.source_type    as enum ('paste', 'file');

-- ---------------------------------------------------------------------
-- Utility: keep updated_at fresh
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text        not null,
  full_name    text,
  company      text,
  role         public.user_role   not null default 'user',
  status       public.user_status not null default 'pending',
  approved_at  timestamptz,
  approved_by  uuid references auth.users (id) on delete set null,
  notes        text,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index profiles_status_idx  on public.profiles (status);
create index profiles_role_idx    on public.profiles (role);
create index profiles_created_idx on public.profiles (created_at desc);
create unique index profiles_email_key on public.profiles (lower(email));

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Security helpers.
-- SECURITY DEFINER so they can read profiles without tripping the very
-- RLS policies that call them (avoids infinite recursion).
-- ---------------------------------------------------------------------
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.profiles p
    where p.id = uid
      and p.role = 'admin'
      and p.status = 'approved'
  );
$fn$;

create or replace function public.is_approved(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.profiles p
    where p.id = uid
      and p.status = 'approved'
  );
$fn$;

revoke execute on function public.is_admin(uuid)    from public;
revoke execute on function public.is_approved(uuid) from public;
grant  execute on function public.is_admin(uuid)    to authenticated, service_role;
grant  execute on function public.is_approved(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Provision a profile for every new auth user.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.profiles (id, email, full_name, company)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'company', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.email in sync when the user changes it in auth.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$fn$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------
-- Nobody may promote themselves. role/status are admin-only fields.
-- service_role (edge functions) has auth.uid() = null and is allowed.
-- ---------------------------------------------------------------------
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    return new;                              -- service_role / SQL editor
  end if;

  if (new.role is distinct from old.role or new.status is distinct from old.status)
     and not public.is_admin() then
    raise exception 'Only administrators may change role or status'
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;

create trigger profiles_protect_privileges
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();

-- ---------------------------------------------------------------------
-- projects - one VSL letter + its structured analysis
-- ---------------------------------------------------------------------
create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  name            text not null check (char_length(trim(name)) between 1 and 160),
  source_type     public.source_type    not null default 'paste',
  source_filename text,
  storage_path    text,
  vsl_text        text not null check (char_length(vsl_text) >= 200),
  status          public.project_status not null default 'draft',
  analysis        jsonb,
  analysis_model  text,
  analyzed_at     timestamptz,
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index projects_user_idx    on public.projects (user_id, created_at desc);
create index projects_status_idx  on public.projects (status);
create index projects_created_idx on public.projects (created_at desc);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- assets - generated sales pages and quizzes (versioned)
-- ---------------------------------------------------------------------
create table public.assets (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  type              public.asset_type not null,
  version           integer not null default 1,
  title             text,
  code              text not null,
  model             text,
  prompt_tokens     integer,
  completion_tokens integer,
  created_at        timestamptz not null default now()
);

create index assets_project_idx on public.assets (project_id, type, version desc);
create index assets_user_idx    on public.assets (user_id, created_at desc);
create unique index assets_project_type_version_key
  on public.assets (project_id, type, version);

-- Auto-increment version per (project, type)
create or replace function public.set_asset_version()
returns trigger
language plpgsql
as $fn$
begin
  select coalesce(max(a.version), 0) + 1
    into new.version
    from public.assets a
   where a.project_id = new.project_id
     and a.type = new.type;
  return new;
end;
$fn$;

create trigger assets_set_version
  before insert on public.assets
  for each row execute function public.set_asset_version();

-- ---------------------------------------------------------------------
-- audit_logs - every privileged admin action
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references auth.users (id) on delete set null,
  actor_email text,
  action      text not null,
  target_type text,
  target_id   uuid,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_actor_idx   on public.audit_logs (actor_id, created_at desc);

-- =====================================================================
--  Row Level Security
-- =====================================================================
alter table public.profiles   enable row level security;
alter table public.projects   enable row level security;
alter table public.assets     enable row level security;
alter table public.audit_logs enable row level security;

-- profiles ------------------------------------------------------------
create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "profiles: admins read all"
  on public.profiles for select
  to authenticated
  using (public.is_admin());

create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles: admins update all"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- projects ------------------------------------------------------------
create policy "projects: owner reads"
  on public.projects for select
  to authenticated
  using (user_id = auth.uid() and public.is_approved());

create policy "projects: admins read all"
  on public.projects for select
  to authenticated
  using (public.is_admin());

create policy "projects: owner creates"
  on public.projects for insert
  to authenticated
  with check (user_id = auth.uid() and public.is_approved());

create policy "projects: owner updates"
  on public.projects for update
  to authenticated
  using (user_id = auth.uid() and public.is_approved())
  with check (user_id = auth.uid());

create policy "projects: owner deletes"
  on public.projects for delete
  to authenticated
  using (user_id = auth.uid() and public.is_approved());

create policy "projects: admins delete"
  on public.projects for delete
  to authenticated
  using (public.is_admin());

-- assets --------------------------------------------------------------
create policy "assets: owner reads"
  on public.assets for select
  to authenticated
  using (user_id = auth.uid() and public.is_approved());

create policy "assets: admins read all"
  on public.assets for select
  to authenticated
  using (public.is_admin());

create policy "assets: owner deletes"
  on public.assets for delete
  to authenticated
  using (user_id = auth.uid() and public.is_approved());

-- Assets are written exclusively by the edge functions (service_role),
-- so no INSERT/UPDATE policy is granted to end users on purpose.

-- audit_logs ----------------------------------------------------------
create policy "audit_logs: admins read"
  on public.audit_logs for select
  to authenticated
  using (public.is_admin());

-- =====================================================================
--  Admin reporting helpers
-- =====================================================================
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'users_total',     (select count(*) from public.profiles),
    'users_pending',   (select count(*) from public.profiles where status = 'pending'),
    'users_approved',  (select count(*) from public.profiles where status = 'approved'),
    'users_rejected',  (select count(*) from public.profiles where status = 'rejected'),
    'users_suspended', (select count(*) from public.profiles where status = 'suspended'),
    'admins',          (select count(*) from public.profiles where role = 'admin'),
    'signups_7d',      (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'projects_total',  (select count(*) from public.projects),
    'projects_7d',     (select count(*) from public.projects where created_at > now() - interval '7 days'),
    'projects_failed', (select count(*) from public.projects where status = 'failed'),
    'assets_total',    (select count(*) from public.assets),
    'sales_pages',     (select count(*) from public.assets where type = 'sales_page'),
    'quizzes',         (select count(*) from public.assets where type = 'quiz')
  ) into result;

  return result;
end;
$fn$;

revoke execute on function public.admin_dashboard_stats() from public;
grant  execute on function public.admin_dashboard_stats() to authenticated, service_role;

-- Signup / project activity for the last N days (admin chart)
create or replace function public.admin_activity_series(days integer default 30)
returns table (day date, signups bigint, projects bigint)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return query
  with span as (
    select generate_series(
             (current_date - (greatest(days, 1) - 1) * interval '1 day')::date,
             current_date,
             interval '1 day'
           )::date as day
  )
  select s.day,
         (select count(*) from public.profiles p  where p.created_at::date  = s.day),
         (select count(*) from public.projects pr where pr.created_at::date = s.day)
  from span s
  order by s.day;
end;
$fn$;

revoke execute on function public.admin_activity_series(integer) from public;
grant  execute on function public.admin_activity_series(integer) to authenticated, service_role;

-- =====================================================================
--  Bootstrap helper - run once from the Supabase SQL editor:
--    select public.promote_to_admin('you@example.com');
--  Not callable by application users.
-- =====================================================================
create or replace function public.promote_to_admin(user_email text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $fn$
declare
  updated public.profiles;
begin
  update public.profiles
     set role = 'admin',
         status = 'approved',
         approved_at = coalesce(approved_at, now())
   where lower(email) = lower(trim(user_email))
  returning * into updated;

  if updated.id is null then
    raise exception 'No profile found for %', user_email;
  end if;

  return updated;
end;
$fn$;

revoke execute on function public.promote_to_admin(text) from public, anon, authenticated;
grant  execute on function public.promote_to_admin(text) to service_role;

-- =====================================================================
--  Extra foreign keys to public.profiles.
--  projects.user_id / assets.user_id already reference auth.users, but the
--  admin panel needs to embed the owner's profile through PostgREST, which
--  can only follow relationships between exposed schemas.
-- =====================================================================
alter table public.projects
  add constraint projects_user_id_profiles_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

alter table public.assets
  add constraint assets_user_id_profiles_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;
