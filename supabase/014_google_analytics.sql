-- Google Analytics 4. Run this once in Supabase → SQL Editor, after 013_calendar_columns.sql.
-- ga4_connections holds each brand's Google sign-in, encrypted. It has no policies on purpose:
-- only the server, with the secret key, can read it. Nobody in the browser ever sees the token.
create table if not exists public.ga4_connections (
  brand_id uuid primary key references public.brands (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  refresh_token text not null,
  email text,
  connected_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.ga4_connections enable row level security;

-- Which GA4 property the brand uses, and the Google account that connected it. Safe to show.
alter table public.brands
  add column if not exists ga4_property text,
  add column if not exists ga4_property_name text,
  add column if not exists ga4_email text;
