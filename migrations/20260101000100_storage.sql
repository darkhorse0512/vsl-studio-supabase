-- =====================================================================
--  Storage: original VSL uploads (txt / pdf)
--  Private bucket. Objects are namespaced by user id:
--      vsl-uploads/<user_id>/<project_uuid>-<filename>
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vsl-uploads',
  'vsl-uploads',
  false,
  20971520, -- 20 MB
  array['text/plain', 'application/pdf', 'text/markdown', 'application/octet-stream']
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "vsl uploads: owner reads"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'vsl-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );

create policy "vsl uploads: admins read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'vsl-uploads' and public.is_admin());

create policy "vsl uploads: owner writes"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'vsl-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );

create policy "vsl uploads: owner deletes"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'vsl-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
