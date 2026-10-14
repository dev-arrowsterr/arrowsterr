-- Ask Arrowsterr: chat threads, site audits, and changes it proposes to a connected CMS.
-- Run this once in Supabase → SQL Editor, after 035_notifications.sql.
-- Members of a workspace can read everything here. Only the server writes, after checking roles.

create table if not exists public.ask_threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null default 'New chat',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ask_threads_ws on public.ask_threads (workspace_id, updated_at desc);

-- Every turn as Claude sees it (content blocks, tool calls and results), plus the plain text people see.
create table if not exists public.ask_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.ask_threads (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null,
  text text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ask_messages_thread on public.ask_messages (thread_id, id);

-- A crawl of a website: every page's SEO and AI-readiness checks, and the issues found.
create table if not exists public.site_audits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  domain text not null,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  step text not null default 'Starting',
  pages int not null default 0,
  score int,
  result jsonb not null default '{}'::jsonb,
  error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists site_audits_ws on public.site_audits (workspace_id, created_at desc);

-- A batch of proposed edits to one CMS connection. Nothing goes live until someone approves it.
create table if not exists public.change_sets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  connection_id uuid references public.cms_connections (id) on delete set null,
  thread_id uuid references public.ask_threads (id) on delete set null,
  play text not null,
  title text not null,
  options jsonb not null default '{}'::jsonb,
  status text not null default 'preparing' check (status in ('preparing', 'ready', 'applying', 'applied', 'partly', 'failed', 'undone')),
  step text not null default '',
  error text,
  created_by uuid references auth.users (id) on delete set null,
  applied_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
create index if not exists change_sets_ws on public.change_sets (workspace_id, created_at desc);

-- One edit to one field of one page or image, with what it was before, so it can be undone.
create table if not exists public.changes (
  id bigint generated always as identity primary key,
  change_set_id uuid not null references public.change_sets (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'page', 'media')),
  target_id text not null,
  url text,
  label text not null default '',
  field text not null check (field in ('alt', 'meta', 'schema', 'faq', 'links', 'content')),
  before jsonb,
  after jsonb not null,
  note text not null default '',
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'applied', 'failed', 'undone')),
  error text,
  applied_at timestamptz
);
create index if not exists changes_set on public.changes (change_set_id, id);

alter table public.ask_threads enable row level security;
alter table public.ask_messages enable row level security;
alter table public.site_audits enable row level security;
alter table public.change_sets enable row level security;
alter table public.changes enable row level security;

drop policy if exists "ask threads read" on public.ask_threads;
drop policy if exists "ask messages read" on public.ask_messages;
drop policy if exists "site audits read" on public.site_audits;
drop policy if exists "change sets read" on public.change_sets;
drop policy if exists "changes read" on public.changes;
create policy "ask threads read" on public.ask_threads for select using (public.has_role(workspace_id, 'viewer'));
create policy "ask messages read" on public.ask_messages for select using (public.has_role(workspace_id, 'viewer'));
create policy "site audits read" on public.site_audits for select using (public.has_role(workspace_id, 'viewer'));
create policy "change sets read" on public.change_sets for select using (public.has_role(workspace_id, 'viewer'));
create policy "changes read" on public.changes for select using (public.has_role(workspace_id, 'viewer'));
