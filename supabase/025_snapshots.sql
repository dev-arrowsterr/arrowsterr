-- Free AI Snapshot on arrowsterr.com: one row per snapshot, for caching and fair-use limits.
-- Run this once in Supabase → SQL Editor, after 024_integrations.sql.

create table if not exists public.snapshots (
  id bigint generated always as identity primary key,
  domain text not null,
  ip_hash text not null,
  result jsonb,
  created_at timestamptz not null default now()
);
create index if not exists snapshots_domain on public.snapshots (domain, created_at desc);
create index if not exists snapshots_ip on public.snapshots (ip_hash, created_at desc);
alter table public.snapshots enable row level security; -- no policies: only the server reads and writes it
