-- Shared keyword data cache. Run this once in Supabase → SQL Editor, after 008_search_console.sql.
-- Keyword numbers and Google results are the same for every customer, so the first search
-- pays DataForSEO and everyone after reads it free until it expires.
-- No policies on purpose: only the server, with the secret key, reads and writes it.
create table if not exists public.keyword_cache (
  key text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.keyword_cache enable row level security;
