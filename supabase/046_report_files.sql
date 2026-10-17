-- Reports, rebuilt (docs/reports.md, section 32): every page's Download PDF makes a file, Reports keeps them,
-- and schedules email them. Run this once in Supabase → SQL Editor, after 045_brand_kits.sql. Safe to run again.
--
-- Members read. Files are made by the server only (/api/files), because the plan decides the design.
-- Editors delete files and manage schedules.

-- ─────────────── files ───────────────
create table if not exists public.report_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete set null,
  page text not null,                               -- prompts, competitors, sources, ...
  title text not null check (char_length(title) between 1 and 160),
  design text not null default 'arrowsterr' check (design in ('arrowsterr', 'brand')),
  params jsonb not null default '{}'::jsonb,        -- days, topic, model; keyword, domain, country on research pages
  snapshot jsonb not null,                          -- the numbers, frozen when the file was made
  status text not null default 'making' check (status in ('making', 'ready', 'failed')),
  pdf_path text,
  error text,
  source text not null default 'download' check (source in ('download', 'schedule')),
  schedule_id uuid,
  job_id bigint,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists report_files_workspace_idx on public.report_files (workspace_id, created_at desc);
alter table public.report_files enable row level security;
drop policy if exists "report files read" on public.report_files;
drop policy if exists "report files delete" on public.report_files;
create policy "report files read" on public.report_files for select using (public.has_role(workspace_id, 'viewer'));
create policy "report files delete" on public.report_files for delete using (public.has_role(workspace_id, 'editor'));

-- ─────────────── schedules ───────────────
create table if not exists public.report_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  pages text[] not null,
  design text not null default 'arrowsterr' check (design in ('arrowsterr', 'brand')),
  params jsonb not null default '{}'::jsonb,
  cadence text not null check (cadence in ('weekly', 'monthly')),
  weekday smallint check (weekday between 0 and 6),   -- weekly: 0 is Sunday
  monthday smallint check (monthday between 1 and 28), -- monthly
  hour smallint not null default 9 check (hour between 0 and 23),
  timezone text not null default 'UTC',
  recipients text[] not null,
  subject text,
  active boolean not null default true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists report_schedules_due_idx on public.report_schedules (next_run_at) where active;
alter table public.report_schedules enable row level security;
drop policy if exists "report schedules read" on public.report_schedules;
drop policy if exists "report schedules add" on public.report_schedules;
drop policy if exists "report schedules edit" on public.report_schedules;
drop policy if exists "report schedules delete" on public.report_schedules;
create policy "report schedules read" on public.report_schedules for select using (public.has_role(workspace_id, 'viewer'));
create policy "report schedules add" on public.report_schedules for insert with check (public.has_role(workspace_id, 'editor'));
create policy "report schedules edit" on public.report_schedules for update using (public.has_role(workspace_id, 'editor')) with check (public.has_role(workspace_id, 'editor'));
create policy "report schedules delete" on public.report_schedules for delete using (public.has_role(workspace_id, 'editor'));

-- ─────────────── sends ───────────────
-- One row per schedule per due time, so a retry never sends twice.
create table if not exists public.report_sends (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.report_schedules (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  due_at timestamptz not null,
  status text not null default 'working' check (status in ('working', 'sent', 'failed')),
  file_ids uuid[] not null default '{}',
  error text,
  attempts smallint not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (schedule_id, due_at)
);
alter table public.report_sends enable row level security;
drop policy if exists "report sends read" on public.report_sends;
create policy "report sends read" on public.report_sends for select using (public.has_role(workspace_id, 'viewer'));
