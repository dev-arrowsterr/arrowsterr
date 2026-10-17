-- Article research, steps 1 to 3 (docs/content-v2.md, "How one article is made").
-- Run this once in Supabase → SQL Editor, after 046_report_files.sql. Safe to run again.
--
-- One run per calendar item: Google's top 10 with People Also Ask and AI Overview, the pages read in Chromium
-- on the Fly worker, and the AI engines' answers with their cited links. Each step saves its output here,
-- so a retried job starts where it stopped and never pays twice.
-- Members read. Only the server writes (the article_research job and /api/research/render-*).

-- ─────────────── runs ───────────────
create table if not exists public.article_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete set null,
  item_id uuid not null references public.calendar_items (id) on delete cascade,
  keyword text not null,
  question text,                                    -- the keyword as a question, asked to the AI engines
  status text not null default 'queued' check (status in ('queued', 'searching', 'reading', 'waiting', 'done', 'failed')),
  step text not null default 'serp' check (step in ('serp', 'pages', 'ai', 'reading', 'done')),
  error text,
  serp_at timestamptz,                              -- step 1 saved: never call DataForSEO again for this run
  organic jsonb not null default '[]'::jsonb,       -- the top 10, saved with serp_at; article_serp is built from it
  paa jsonb not null default '[]'::jsonb,           -- People Also Ask: [{question, answer, url}]
  ai_overview jsonb,                                -- {shown, text, sources: [{url, title, domain}]}
  engines text[],                                   -- the engines step 3 asks, fixed on first try
  ai_at timestamptz,                                -- step 3 saved and its links queued
  rounds int not null default 0,                    -- times the run waited because fewer than 5 pages were read
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists article_runs_item_idx on public.article_runs (item_id, created_at desc);
-- One open run per item, so a double click or a retried start never pays twice.
create unique index if not exists article_runs_open_idx on public.article_runs (item_id) where status in ('queued', 'searching', 'reading', 'waiting');

-- ─────────────── step 1: search results ───────────────
create table if not exists public.article_serp (
  run_id uuid not null references public.article_runs (id) on delete cascade,
  position int not null,
  url text not null,
  title text,
  snippet text,
  domain text,
  primary key (run_id, position)
);

-- ─────────────── step 2 and 3: pages read in Chromium ───────────────
-- skip_reason: robots, private, blocked (401/403, a login) and not_needed are final; failed, timeout and empty are tried again
-- in a later round when fewer than 5 pages were read.
create table if not exists public.article_pages (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.article_runs (id) on delete cascade,
  url text not null,
  source text not null check (source in ('serp', 'ai')),
  position int,                                     -- rank in Google for serp pages
  status text not null default 'queued' check (status in ('queued', 'rendering', 'done', 'skipped')),
  skip_reason text check (skip_reason in ('robots', 'private', 'blocked', 'failed', 'timeout', 'empty', 'not_needed')),
  final_url text,
  title text,
  headings jsonb not null default '[]'::jsonb,      -- [{level, text}]
  body text,                                        -- capped at 60,000 characters
  word_count int,
  tables jsonb not null default '[]'::jsonb,        -- [[["cell", ...], ...], ...]
  published_at timestamptz,
  error text,
  locked_by text,
  locked_until timestamptz,
  attempts int not null default 0,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, url)
);
create index if not exists article_pages_ready_idx on public.article_pages (created_at) where status = 'queued';
create index if not exists article_pages_lease_idx on public.article_pages (locked_until) where status = 'rendering';

-- ─────────────── step 3: AI answers ───────────────
create table if not exists public.article_ai_answers (
  run_id uuid not null references public.article_runs (id) on delete cascade,
  engine text not null,
  question text not null,
  answer text,
  cited jsonb not null default '[]'::jsonb,         -- [{url, title, domain}]
  error text,
  created_at timestamptz not null default now(),
  primary key (run_id, engine)
);

-- ─────────────── who sees what ───────────────
alter table public.article_runs enable row level security;
alter table public.article_serp enable row level security;
alter table public.article_pages enable row level security;
alter table public.article_ai_answers enable row level security;

drop policy if exists "article runs read" on public.article_runs;
drop policy if exists "article serp read" on public.article_serp;
drop policy if exists "article pages read" on public.article_pages;
drop policy if exists "article answers read" on public.article_ai_answers;
create policy "article runs read" on public.article_runs for select using (public.has_role(workspace_id, 'viewer'));
create policy "article serp read" on public.article_serp for select
  using (exists (select 1 from public.article_runs r where r.id = run_id and public.has_role(r.workspace_id, 'viewer')));
create policy "article pages read" on public.article_pages for select
  using (exists (select 1 from public.article_runs r where r.id = run_id and public.has_role(r.workspace_id, 'viewer')));
create policy "article answers read" on public.article_ai_answers for select
  using (exists (select 1 from public.article_runs r where r.id = run_id and public.has_role(r.workspace_id, 'viewer')));

-- ─────────────── the worker's lease ───────────────
-- Take the next page to read. Two workers never get the same page, and a page whose worker died comes back
-- after its lease, up to 3 tries. Only pages of open runs are handed out.
create or replace function public.lease_article_page(p_worker text, p_lease_seconds int default 60)
returns setof public.article_pages language sql security definer set search_path = '' as $$
  update public.article_pages p set status = 'rendering', attempts = p.attempts + 1, locked_by = p_worker,
    locked_until = now() + make_interval(secs => p_lease_seconds)
  where p.id = (
    select q.id from public.article_pages q
    join public.article_runs r on r.id = q.run_id
    where r.status in ('searching', 'reading', 'waiting')
      and (q.status = 'queued' or (q.status = 'rendering' and q.locked_until < now() and q.attempts < 3))
    order by q.created_at, q.id
    limit 1
    for update of q skip locked
  )
  returning p.*;
$$;
revoke execute on function public.lease_article_page(text, int) from public, anon, authenticated;
