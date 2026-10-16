-- Outreach, step 1: lists of targets (websites, press, podcasts, YouTube channels, social accounts),
-- their contact emails, and the workspace's do-not-contact list. See docs/outreach.md.
-- Run this once in Supabase → SQL Editor, after 039_industry_research.sql.
-- Members of a workspace can read everything here. Only the server writes, after checking roles.

create table if not exists public.outreach_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete set null,   -- the brand the outreach is for
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists outreach_lists_ws on public.outreach_lists (workspace_id, created_at desc);

create table if not exists public.outreach_targets (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.outreach_lists (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('website', 'press', 'podcast', 'youtube', 'social')),
  name text not null,
  url text,
  domain text,
  email text,
  email_source text check (email_source in ('contact_page', 'site', 'rss', 'manual')),
  email_status text not null default 'pending' check (email_status in ('pending', 'found', 'not_found', 'manual')),
  status text not null default 'new' check (status in ('new', 'drafted', 'scheduled', 'sent', 'replied', 'do_not_contact')),
  added_from text not null default 'manual',                          -- industry, sources, social or manual
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (list_id, kind, name)
);
create index if not exists outreach_targets_list on public.outreach_targets (list_id, created_at);

-- Addresses and whole domains the workspace never emails. Opt-outs and bounces land here.
create table if not exists public.outreach_suppression (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  value text not null,                                                 -- an email address or a domain, lower case
  reason text not null default 'manual',
  created_at timestamptz not null default now(),
  primary key (workspace_id, value)
);

alter table public.outreach_lists enable row level security;
alter table public.outreach_targets enable row level security;
alter table public.outreach_suppression enable row level security;
drop policy if exists "outreach lists read" on public.outreach_lists;
drop policy if exists "outreach targets read" on public.outreach_targets;
drop policy if exists "outreach suppression read" on public.outreach_suppression;
create policy "outreach lists read" on public.outreach_lists for select using (public.has_role(workspace_id, 'viewer'));
create policy "outreach targets read" on public.outreach_targets for select using (public.has_role(workspace_id, 'viewer'));
create policy "outreach suppression read" on public.outreach_suppression for select using (public.has_role(workspace_id, 'viewer'));
