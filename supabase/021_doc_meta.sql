-- Publishing details for each draft: meta title, meta description, slug, featured image and FAQ schema,
-- and the CMS connections a workspace publishes to.
-- Run this once in Supabase → SQL Editor, after 020_leaner_plans.sql.

alter table public.docs add column if not exists meta jsonb not null default '{}'::jsonb;

-- CMS connections. The keys inside config are secrets: no policies, so only the server (service role) reads them.
create table if not exists public.cms_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('wordpress','webflow','shopify','hubspot','ghost')),
  name text not null,
  config jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cms_connections_ws on public.cms_connections(workspace_id);
alter table public.cms_connections enable row level security;
