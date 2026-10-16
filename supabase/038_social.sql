-- Social listening: posts about a brand and the competitors AI names most (docs/social-listening.md).
-- Run this once in Supabase → SQL Editor, after 037_zippie.sql.
-- Members of a workspace can read mentions. Only the server writes them.

-- off: listening turned off for this brand. picks: the competitors an editor chose (null or missing means automatic).
alter table public.brands add column if not exists listen jsonb not null default '{}';
-- The last day (UTC) the brand's listening started, so it runs once a day.
alter table public.brands add column if not exists listened_on date;

create table if not exists public.mentions (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  name text not null,                        -- the brand or competitor the post is about
  is_you boolean not null default false,
  source text not null,                      -- reddit, x, linkedin, youtube, quora, medium, producthunt, tiktok, hn, news
  url text not null,
  title text not null default '',
  snippet text not null default '',
  author text,                               -- r/subreddit, @handle, or the HN user
  posted_at timestamptz,
  found_at timestamptz not null default now(),
  sentiment smallint check (sentiment between 0 and 100), -- toward the named brand
  kind text check (kind in ('question', 'complaint', 'praise', 'comparison', 'news', 'other')),
  unique (brand_id, name, url)
);
create index if not exists mentions_brand_found on public.mentions (brand_id, found_at desc);

alter table public.mentions enable row level security;
drop policy if exists "mentions read" on public.mentions;
create policy "mentions read" on public.mentions for select using (public.has_role(workspace_id, 'viewer'));
