-- Client reports you can share by link. Run this once in Supabase → SQL Editor, after 010_writer.sql.
-- Each row is a frozen copy of a report. Anyone with the link can view it; the token is long and random.
create table if not exists public.shared_reports (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete cascade,
  data jsonb not null,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists shared_reports_brand_idx on public.shared_reports (brand_id, created_at desc);
alter table public.shared_reports enable row level security;
create policy "shared reports read" on public.shared_reports for select using (public.has_role(workspace_id, 'viewer'));
create policy "shared reports add" on public.shared_reports for insert with check (public.has_role(workspace_id, 'editor'));
create policy "shared reports delete" on public.shared_reports for delete using (public.has_role(workspace_id, 'editor'));
