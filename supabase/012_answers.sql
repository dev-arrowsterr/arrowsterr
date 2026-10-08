-- Full AI answers, one row per model per prompt per check. Run this once in Supabase → SQL Editor, after 011_shared_reports.sql.
-- Runs keep only the brands and sources, so the dashboard loads fast. The full text lives here and loads when you open a prompt.
create table if not exists public.answers (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  run_id uuid references public.runs (id) on delete cascade,
  at timestamptz not null default now(),
  engine text not null,
  prompt text not null,
  text text not null
);
create index if not exists answers_prompt_idx on public.answers (brand_id, prompt, at desc);
alter table public.answers enable row level security;
create policy "answers read" on public.answers for select using (public.has_role(workspace_id, 'viewer'));
create policy "answers add" on public.answers for insert with check (public.has_role(workspace_id, 'editor'));
