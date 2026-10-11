-- Pictures in Agentic Writer drafts. Files live at <workspace id>/<doc id>/<file> in a public bucket,
-- so a published article can show them. Editors of the workspace upload and delete; anyone can view.
-- Run this once in Supabase → SQL Editor, after 027_serp.sql.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('doc-images', 'doc-images', true, 10485760, array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "doc images read" on storage.objects;
create policy "doc images read" on storage.objects for select using (bucket_id = 'doc-images');

drop policy if exists "doc images add" on storage.objects;
create policy "doc images add" on storage.objects for insert to authenticated
  with check (bucket_id = 'doc-images' and public.has_role(((storage.foldername(name))[1])::uuid, 'editor'));

drop policy if exists "doc images delete" on storage.objects;
create policy "doc images delete" on storage.objects for delete to authenticated
  using (bucket_id = 'doc-images' and public.has_role(((storage.foldername(name))[1])::uuid, 'editor'));
