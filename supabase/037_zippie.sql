-- Zippie: projects that group chats, knowledge people upload to teach Zippie, and skills.
-- Run this once in Supabase → SQL Editor, after 036_ask.sql.
-- Members of a workspace can read everything here. Only the server writes, after checking roles.

create table if not exists public.ask_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  instructions text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ask_projects_ws on public.ask_projects (workspace_id, updated_at desc);

alter table public.ask_threads add column if not exists project_id uuid references public.ask_projects (id) on delete set null;
create index if not exists ask_threads_project on public.ask_threads (project_id, updated_at desc);

-- Files, pages and notes Zippie reads before it answers. In a project, or for the whole workspace.
create table if not exists public.ask_knowledge (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.ask_projects (id) on delete cascade,
  kind text not null check (kind in ('file', 'url', 'note')),
  name text not null,
  source text not null default '',
  content text not null,
  chars int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ask_knowledge_ws on public.ask_knowledge (workspace_id, created_at desc);

-- Skills: instructions Zippie follows for one kind of task. Built-in ones live in code; a row with
-- builtin set only records whether that one is turned off.
create table if not exists public.ask_skills (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  builtin text,
  name text not null default '',
  description text not null default '',
  instructions text not null default '',
  enabled boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, builtin)
);
create index if not exists ask_skills_ws on public.ask_skills (workspace_id);

alter table public.ask_projects enable row level security;
alter table public.ask_knowledge enable row level security;
alter table public.ask_skills enable row level security;

drop policy if exists "ask projects read" on public.ask_projects;
drop policy if exists "ask knowledge read" on public.ask_knowledge;
drop policy if exists "ask skills read" on public.ask_skills;
create policy "ask projects read" on public.ask_projects for select using (public.has_role(workspace_id, 'viewer'));
create policy "ask knowledge read" on public.ask_knowledge for select using (public.has_role(workspace_id, 'viewer'));
create policy "ask skills read" on public.ask_skills for select using (public.has_role(workspace_id, 'viewer'));
