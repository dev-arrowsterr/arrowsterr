-- Reports, phase 1 (docs/reports.md): saved reports, their versions, and share links that can be live or frozen.
-- Run this once in Supabase → SQL Editor, after 042_pricing_v4.sql. Safe to run again.
--
-- Members read. Editors change and delete. New reports and new links are made by the server only
-- (/api/reports/create and /api/reports/links), because plan limits decide what may be made.

-- ─────────────── reports ───────────────
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  kind text not null default 'client' check (kind in ('client', 'prompts', 'competitors', 'intel')),
  name text not null default 'Client report' check (char_length(name) between 1 and 120),
  doc jsonb not null default '{}'::jsonb,          -- blocks, their order and on/off, the saved AI summary
  range jsonb not null default '{"preset": "last30", "compare": "previous"}'::jsonb,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists reports_workspace_idx on public.reports (workspace_id, updated_at desc);
create index if not exists reports_brand_idx on public.reports (brand_id);
alter table public.reports enable row level security;
drop policy if exists "reports read" on public.reports;
drop policy if exists "reports edit" on public.reports;
drop policy if exists "reports delete" on public.reports;
create policy "reports read" on public.reports for select using (public.has_role(workspace_id, 'viewer'));
create policy "reports edit" on public.reports for update using (public.has_role(workspace_id, 'editor')) with check (public.has_role(workspace_id, 'editor'));
create policy "reports delete" on public.reports for delete using (public.has_role(workspace_id, 'editor'));

-- ─────────────── versions ───────────────
-- A copy of the report before big changes, every 30 minutes of editing, and whenever someone saves one by name.
create table if not exists public.report_versions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text check (name is null or char_length(name) <= 80),
  doc jsonb not null,
  range jsonb not null,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists report_versions_report_idx on public.report_versions (report_id, created_at desc);
alter table public.report_versions enable row level security;
drop policy if exists "report versions read" on public.report_versions;
drop policy if exists "report versions add" on public.report_versions;
drop policy if exists "report versions delete" on public.report_versions;
create policy "report versions read" on public.report_versions for select using (public.has_role(workspace_id, 'viewer'));
create policy "report versions add" on public.report_versions for insert with check (public.has_role(workspace_id, 'editor'));
create policy "report versions delete" on public.report_versions for delete using (public.has_role(workspace_id, 'editor'));

-- ─────────────── share links ───────────────
-- live: the saved report with fresh numbers each time it opens. frozen: a stored snapshot that never changes.
-- The token is long and random. Only /r/<token> reads a link, through the server.
create table if not exists public.report_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  report_id uuid references public.reports (id) on delete cascade,  -- null for links made before saved reports
  brand_id uuid references public.brands (id) on delete cascade,
  mode text not null default 'frozen' check (mode in ('live', 'frozen')),
  snapshot jsonb,                                  -- frozen links only
  password_hash text,                              -- scrypt, made by the server
  expires_at timestamptz,
  revoked_at timestamptz,
  views int not null default 0,
  last_viewed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (mode = 'live' and report_id is not null or mode = 'frozen' and snapshot is not null)
);
-- Whether a link has a password, so the app can show it without reading the hash.
alter table public.report_links add column if not exists locked boolean generated always as (password_hash is not null) stored;
create index if not exists report_links_report_idx on public.report_links (report_id, created_at desc);
create index if not exists report_links_workspace_idx on public.report_links (workspace_id, created_at desc);
alter table public.report_links enable row level security;
drop policy if exists "report links read" on public.report_links;
drop policy if exists "report links edit" on public.report_links;
drop policy if exists "report links delete" on public.report_links;
create policy "report links read" on public.report_links for select using (public.has_role(workspace_id, 'viewer'));
create policy "report links edit" on public.report_links for update using (public.has_role(workspace_id, 'editor')) with check (public.has_role(workspace_id, 'editor'));
create policy "report links delete" on public.report_links for delete using (public.has_role(workspace_id, 'editor'));

-- Links made before this migration keep working: each one becomes a frozen link with the same token.
do $$
begin
  if to_regclass('public.shared_reports') is not null then
    insert into public.report_links (token, workspace_id, brand_id, mode, snapshot, created_by, created_at)
    select token, workspace_id, brand_id, 'frozen', data, created_by, created_at from public.shared_reports
    on conflict (token) do nothing;
  end if;
end $$;

-- Count one view. The server calls this for a link's page; nobody else can.
create or replace function public.report_link_viewed(p_token text) returns void
language sql security definer set search_path = '' as $$
  update public.report_links set views = views + 1, last_viewed_at = now() where token = p_token;
$$;
revoke all on function public.report_link_viewed(text) from public, anon, authenticated;

-- ─────────────── PDFs ───────────────
-- Made by the PDF worker at <workspace>/<report>/<job>.pdf. The server keeps the last 5 per report and hands out
-- short signed download links. Private: only the server reads and writes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-pdfs', 'report-pdfs', false, 52428800, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
