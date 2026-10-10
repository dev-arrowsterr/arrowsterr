-- Slack alerts, API keys and webhooks (for Zapier and custom tools). Pro and up.
-- Run this once in Supabase → SQL Editor, after 023_emails.sql.
-- These tables hold secrets, so they have no policies: only the server (service role) reads them.

create table if not exists public.integrations (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  slack_webhook text,
  alert_points int not null default 5, -- a change in AI visibility this big, in points, sends an alert
  updated_at timestamptz not null default now()
);
alter table public.integrations enable row level security;

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  prefix text not null, -- the first characters, to tell keys apart; the key itself is never stored
  hash text not null unique, -- sha256 of the key
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists api_keys_ws on public.api_keys (workspace_id);
alter table public.api_keys enable row level security;

create table if not exists public.webhooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  url text not null,
  event text not null, -- one event name, or * for all
  source text not null default 'api', -- zapier, api
  created_at timestamptz not null default now()
);
create index if not exists webhooks_ws on public.webhooks (workspace_id);
alter table public.webhooks enable row level security;
