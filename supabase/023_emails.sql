-- Emails the app sends on its own (tasks running low, trial ending), each once per workspace and period.
-- Run this once in Supabase → SQL Editor, after 022_tasks.sql.

create table if not exists public.email_log (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null,
  period text not null,
  sent_at timestamptz not null default now(),
  primary key (workspace_id, kind, period)
);
alter table public.email_log enable row level security; -- no policies: only the server writes it
