-- Industry Research on the Sources page: the sites, press, subreddits, social accounts, YouTube channels and
-- podcasts the brand's audience uses, from SparkToro. One row per brand, refreshed at most once every 30 days.
-- Run this once in Supabase → SQL Editor, after 038_social.sql.
-- Members of a workspace can read it. Only the server writes.

create table if not exists public.industry_research (
  brand_id uuid primary key references public.brands (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  error text,
  audience text not null default '',          -- the description SparkToro built the audience from
  report_id text,                              -- SparkToro's report
  sections jsonb not null default '{}',        -- section name → list of { name, url, score, reach }
  started_at timestamptz not null default now(),
  updated_at timestamptz                       -- when the last full refresh finished
);

alter table public.industry_research enable row level security;
drop policy if exists "industry research read" on public.industry_research;
create policy "industry research read" on public.industry_research for select using (public.has_role(workspace_id, 'viewer'));
