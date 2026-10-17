-- Free tools on arrowsterr.com (docs/free-tools.md): every run, its saved result and what it cost.
-- Run this once in Supabase → SQL Editor, after 043_reports.sql. Safe to run again.
--
-- Only the server reads and writes it: row level security is on with no policies.
-- A run with a result is reused for the same tool and input until it is older than the tool's save time.
-- ip_hash is a salted hash of the visitor's address. The address itself is never stored.

create table if not exists public.free_runs (
  id bigint generated always as identity primary key,
  tool text not null,
  key text not null,
  ip_hash text not null,
  result jsonb,
  cost numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists free_runs_lookup_idx on public.free_runs (tool, key, created_at desc);
create index if not exists free_runs_visitor_idx on public.free_runs (ip_hash, created_at desc);
create index if not exists free_runs_day_idx on public.free_runs (created_at desc);
alter table public.free_runs enable row level security;
