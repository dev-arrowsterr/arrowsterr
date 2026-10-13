-- Saved bulk analyses, so each one has its own link (/keywords?bulk=k7f2a9x1) and shows up in Recent runs.
-- Run this once in Supabase → SQL Editor, after 032_oauth.sql.
-- Anyone in the workspace can open a saved run. Editors save and delete them.

create table if not exists public.bulk_runs (
  id text primary key, -- short and random, used in the link
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  site_id uuid references public.sites (id) on delete cascade,
  kind text not null check (kind in ('keywords', 'domains')),
  country text not null,
  count int not null,
  items jsonb not null, -- the list as it was typed
  result jsonb not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists bulk_runs_recent on public.bulk_runs (site_id, kind, created_at desc);
alter table public.bulk_runs enable row level security;

drop policy if exists "bulk runs read" on public.bulk_runs;
drop policy if exists "bulk runs add" on public.bulk_runs;
drop policy if exists "bulk runs delete" on public.bulk_runs;
create policy "bulk runs read" on public.bulk_runs for select using (public.has_role(workspace_id, 'viewer'));
create policy "bulk runs add" on public.bulk_runs for insert with check (public.has_role(workspace_id, 'editor'));
create policy "bulk runs delete" on public.bulk_runs for delete using (public.has_role(workspace_id, 'editor'));
