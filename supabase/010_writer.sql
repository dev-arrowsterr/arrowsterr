-- Writer's Workspace. Run this once in Supabase → SQL Editor, after 009_keyword_cache.sql.
-- docs: drafts written in Arrowsterr, one per page, often started from a content brief.
-- sites.guideline: the brand guideline the AI builds from the website's homepage.
create table if not exists public.docs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  calendar_item_id uuid unique references public.calendar_items (id) on delete set null,
  title text not null default 'Untitled',
  content jsonb not null default '{}',
  words int not null default 0,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists docs_site_idx on public.docs (site_id, updated_at desc);
alter table public.docs enable row level security;
create policy "docs read" on public.docs for select using (public.has_role(workspace_id, 'viewer'));
create policy "docs add" on public.docs for insert with check (public.has_role(workspace_id, 'editor'));
create policy "docs edit" on public.docs for update using (public.has_role(workspace_id, 'editor')) with check (public.has_role(workspace_id, 'editor'));
create policy "docs delete" on public.docs for delete using (public.has_role(workspace_id, 'editor'));

alter table public.sites
  add column if not exists guideline jsonb,
  add column if not exists guideline_at timestamptz;
