-- Research: websites, keyword research runs and the content calendar.
-- Run this once in Supabase → SQL Editor, after 005_website_tracking.sql.

-- One row per website a workspace does SEO research for. Each brand gets one automatically.
-- profile: {"businessType": "saas", "products": "...", "customers": "...", "features": "...", "country": "United States"}
create table public.sites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid unique references public.brands (id) on delete cascade,
  domain text not null,
  name text not null,
  profile jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (workspace_id, domain)
);

-- One row per Agentic Keyword Research run. result holds the keywords while they wait for review.
create table public.keyword_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  step text not null default '',
  error text,
  result jsonb not null default '{}',
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index keyword_runs_site_idx on public.keyword_runs (site_id, created_at desc);

-- One row per planned page. keyword is the main keyword; secondary are the others the same page can rank for.
create table public.calendar_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  keyword text not null,
  secondary text[] not null default '{}',
  stage text check (stage in ('bofu', 'mofu', 'tofu')),
  theme text,
  volume int,
  difficulty int,
  intent text,
  cpc numeric,
  status text not null default 'planned' check (status in ('planned', 'brief', 'writing', 'published')),
  due_date date,
  owner text,
  url text,
  notes text,
  source text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (site_id, keyword)
);
create index calendar_items_site_idx on public.calendar_items (site_id, due_date);

alter table public.sites enable row level security;
alter table public.keyword_runs enable row level security;
alter table public.calendar_items enable row level security;

create policy "sites read" on public.sites for select using (public.has_role(workspace_id, 'viewer'));
create policy "sites add" on public.sites for insert with check (public.has_role(workspace_id, 'editor'));
create policy "sites edit" on public.sites for update using (public.has_role(workspace_id, 'editor')) with check (public.has_role(workspace_id, 'editor'));
create policy "sites delete" on public.sites for delete using (public.has_role(workspace_id, 'editor'));

create policy "keyword runs read" on public.keyword_runs for select using (public.has_role(workspace_id, 'viewer'));
create policy "keyword runs add" on public.keyword_runs for insert with check (public.has_role(workspace_id, 'editor'));
create policy "keyword runs edit" on public.keyword_runs for update using (public.has_role(workspace_id, 'editor')) with check (public.has_role(workspace_id, 'editor'));
create policy "keyword runs delete" on public.keyword_runs for delete using (public.has_role(workspace_id, 'editor'));

create policy "calendar read" on public.calendar_items for select using (public.has_role(workspace_id, 'viewer'));
create policy "calendar add" on public.calendar_items for insert with check (public.has_role(workspace_id, 'editor'));
create policy "calendar edit" on public.calendar_items for update using (public.has_role(workspace_id, 'editor')) with check (public.has_role(workspace_id, 'editor'));
create policy "calendar delete" on public.calendar_items for delete using (public.has_role(workspace_id, 'editor'));
