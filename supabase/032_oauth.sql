-- Sign in with Arrowsterr from AI apps (Claude.ai connectors, ChatGPT, Cursor) over OAuth 2.1.
-- Run this once in Supabase → SQL Editor, after 031_report_style.sql.
-- Apps register themselves, the person approves a workspace, and the app gets an API key as its access token.
-- Only the server touches these tables, so row level security is on with no policies.

create table if not exists public.oauth_clients (
  id text primary key,
  name text not null,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);
alter table public.oauth_clients enable row level security;

create table if not exists public.oauth_codes (
  hash text primary key, -- sha256 of the code; the code itself is never stored
  client_id text not null references public.oauth_clients (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);
alter table public.oauth_codes enable row level security;

-- The key an app gets, and the refresh token that renews it.
alter table public.api_keys add column if not exists refresh_hash text unique;
alter table public.api_keys add column if not exists client_id text references public.oauth_clients (id) on delete set null;
alter table public.api_keys add column if not exists created_by uuid references auth.users (id) on delete set null;
