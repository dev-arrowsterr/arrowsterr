-- Brand guidelines (docs/content-v2.md, Brand): each brand's written rules, links and up to 10 reference files,
-- on the Brand page next to the Tone of voice and the Brand Kit. The Agentic Writer reads them through
-- loadBrandContext in src/lib/brandContext.ts. Run this once in Supabase → SQL Editor, after 049_article_research.sql.
-- Safe to run again.
--
-- Members read. Editors write, upload and delete.

create table if not exists public.brand_guidelines (
  brand_id uuid primary key references public.brands (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 50000),
  links text[] not null default '{}' check (cardinality(links) <= 20),
  files jsonb not null default '[]'::jsonb check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) <= 10), -- [{ name, path, size, type, uploaded_at }], see src/lib/brandGuidelines.ts
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
create index if not exists brand_guidelines_ws on public.brand_guidelines (workspace_id);

alter table public.brand_guidelines enable row level security;
drop policy if exists "brand guidelines read" on public.brand_guidelines;
drop policy if exists "brand guidelines add" on public.brand_guidelines;
drop policy if exists "brand guidelines edit" on public.brand_guidelines;
drop policy if exists "brand guidelines delete" on public.brand_guidelines;
create policy "brand guidelines read" on public.brand_guidelines for select using (public.has_role(workspace_id, 'viewer'));
create policy "brand guidelines add" on public.brand_guidelines for insert with check (public.has_role(workspace_id, 'editor'));
create policy "brand guidelines edit" on public.brand_guidelines for update using (public.has_role(workspace_id, 'editor')) with check (public.has_role(workspace_id, 'editor'));
create policy "brand guidelines delete" on public.brand_guidelines for delete using (public.has_role(workspace_id, 'editor'));

-- The brand must live in the same workspace as the row (same check as runs).
drop trigger if exists brand_guidelines_brand_matches on public.brand_guidelines;
create trigger brand_guidelines_brand_matches before insert or update on public.brand_guidelines
  for each row execute function public.run_brand_matches();

-- ─────────────── Reference files ───────────────
-- At <workspace id>/<brand id>/<file> in a private bucket, 10 MB each. Members read through short signed links;
-- editors upload and delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand-files', 'brand-files', false, 10485760, array[
  'application/pdf', 'text/plain', 'text/markdown', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'
])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "brand files read" on storage.objects;
create policy "brand files read" on storage.objects for select to authenticated
  using (bucket_id = 'brand-files' and public.has_role(((storage.foldername(name))[1])::uuid, 'viewer'));
drop policy if exists "brand files add" on storage.objects;
create policy "brand files add" on storage.objects for insert to authenticated
  with check (bucket_id = 'brand-files' and public.has_role(((storage.foldername(name))[1])::uuid, 'editor'));
drop policy if exists "brand files delete" on storage.objects;
create policy "brand files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'brand-files' and public.has_role(((storage.foldername(name))[1])::uuid, 'editor'));

-- ─────────────── Import to Agentic Writer ───────────────
-- Write now (week 1) kept extra.write_queued_at; importing now sets extra.in_writer_at (src/lib/writerImport.ts).
-- Pieces queued the old way count as imported, once.
update public.calendar_items
set extra = extra || jsonb_build_object('in_writer_at', extra ->> 'write_queued_at')
where extra ? 'write_queued_at' and not extra ? 'in_writer_at';
