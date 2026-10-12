-- The agency's white label report style, saved once per workspace so every teammate and device gets it.
-- Run this in Supabase → SQL Editor, after 030_trial_7_days.sql. Safe to run again.
create table if not exists public.report_styles (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  style jsonb not null,
  website text,
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.report_styles enable row level security;
drop policy if exists "report style read" on public.report_styles;
drop policy if exists "report style add" on public.report_styles;
drop policy if exists "report style edit" on public.report_styles;
create policy "report style read" on public.report_styles for select using (public.has_role(workspace_id, 'viewer'));
create policy "report style add" on public.report_styles for insert with check (public.has_role(workspace_id, 'editor'));
create policy "report style edit" on public.report_styles for update using (public.has_role(workspace_id, 'editor')) with check (public.has_role(workspace_id, 'editor'));
