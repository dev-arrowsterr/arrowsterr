-- Google Search Console. Run this once in Supabase → SQL Editor, after 007_briefs_and_pages.sql.
-- gsc_connections holds each website's Google sign-in, encrypted. It has no policies on purpose:
-- only the server, with the secret key, can read it. Nobody in the browser ever sees the token.
create table if not exists public.gsc_connections (
  site_id uuid primary key references public.sites (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  refresh_token text not null,
  email text,
  connected_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.gsc_connections enable row level security;

-- Which Search Console property the website uses, and the Google account that connected it. Safe to show.
alter table public.sites
  add column if not exists gsc_property text,
  add column if not exists gsc_email text;
