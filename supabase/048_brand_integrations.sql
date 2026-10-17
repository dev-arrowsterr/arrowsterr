-- Per brand and per workspace (docs/content-v2.md): each brand publishes to its own sites and has its own
-- Slack channel and alert size. The workspace keeps the Slack connection and the default alert size.
-- Run this once in Supabase → SQL Editor, after 047_brand_voice.sql. Safe to run again.
--
-- Both tables hold secrets (CMS keys, Slack webhooks), so they have no policies: only the server reads them.

-- ─────────────── publishing sites per brand ───────────────
alter table public.cms_connections add column if not exists brand_id uuid references public.brands (id) on delete cascade;
-- True for a site this migration gave to the workspace's first brand. It turns false once an admin moves
-- the site or dismisses the notice, so the notice shows once.
alter table public.cms_connections add column if not exists backfilled boolean not null default false;
create index if not exists cms_connections_brand on public.cms_connections (brand_id);

-- Sites from before brands had their own go to the workspace's first brand.
update public.cms_connections c
set brand_id = (select b.id from public.brands b where b.workspace_id = c.workspace_id order by b.created_at, b.id limit 1),
    backfilled = true
where c.brand_id is null
  and exists (select 1 from public.brands b where b.workspace_id = c.workspace_id);

-- A site's brand must live in the same workspace as the site. A site with no brand yet is allowed
-- (a workspace that had sites before its first brand).
create or replace function public.cms_brand_matches() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.brand_id is not null and not exists (select 1 from public.brands b where b.id = new.brand_id and b.workspace_id = new.workspace_id) then
    raise exception 'Brand is not in this workspace.';
  end if;
  return new;
end;
$$;
drop trigger if exists cms_connections_brand_matches on public.cms_connections;
create trigger cms_connections_brand_matches before insert or update on public.cms_connections
  for each row execute function public.cms_brand_matches();

-- ─────────────── Slack channel and alert size per brand ───────────────
-- Empty fields fall back to the workspace's row in integrations.
-- slack_channel is the incoming-webhook address for the brand's channel: each Slack webhook posts to one channel.
create table if not exists public.brand_settings (
  brand_id uuid primary key references public.brands (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  slack_channel text,
  alert_points int check (alert_points between 1 and 50),
  updated_at timestamptz not null default now()
);
create index if not exists brand_settings_ws on public.brand_settings (workspace_id);
alter table public.brand_settings enable row level security;

drop trigger if exists brand_settings_brand_matches on public.brand_settings;
create trigger brand_settings_brand_matches before insert or update on public.brand_settings
  for each row execute function public.run_brand_matches();
