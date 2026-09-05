-- =====================================================================
--  Admin-editable prompts
--
--  The code ships the default prompt for every generator. This table holds
--  ONLY the administrator's overrides, so:
--    * editing a prompt needs no deploy,
--    * deleting the row restores the shipped default instantly,
--    * and an empty table behaves exactly like the code alone.
--
--  Writes go through the admin-prompts edge function (service role), which
--  is why no INSERT/UPDATE policy is granted to end users.
-- =====================================================================

create table if not exists public.prompt_overrides (
  id               text primary key,
  system_prompt    text,
  user_prompt      text,
  model            text,
  temperature      numeric(3, 2),
  max_tokens       integer,
  reasoning_effort text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users (id) on delete set null,

  constraint prompt_overrides_id_known
    check (id in ('analysis', 'sales_page', 'quiz', 'product', 'ad_creative')),
  constraint prompt_overrides_temperature_range
    check (temperature is null or (temperature >= 0 and temperature <= 2)),
  constraint prompt_overrides_max_tokens_range
    check (max_tokens is null or (max_tokens between 500 and 64000)),
  constraint prompt_overrides_effort_known
    check (
      reasoning_effort is null
      or reasoning_effort in ('', 'none', 'low', 'medium', 'high', 'xhigh')
    )
);

comment on table public.prompt_overrides is
  'Administrator overrides for generator prompts. Absent row = use the default compiled into the edge function.';

alter table public.prompt_overrides enable row level security;

create trigger prompt_overrides_set_updated_at
  before update on public.prompt_overrides
  for each row execute function public.set_updated_at();

-- Admins may read them in the panel; all writes go through the edge function.
create policy "prompt_overrides: admins read"
  on public.prompt_overrides for select
  to authenticated
  using (public.is_admin());
