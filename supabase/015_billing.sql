-- Plans, allowances and the cost ledger. Run this once in Supabase → SQL Editor, after 014_google_analytics.sql.
-- Plan limits live in src/lib/plans.ts. The database stores which plan a workspace is on,
-- counts what it used, and records what each action really cost us.

-- ─────────────── plan on each workspace ───────────────
-- Added once. Workspaces made before billing keep what they had, as "Early access" (legacy).
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'workspaces' and column_name = 'plan') then
    alter table public.workspaces
      add column plan text not null default 'trial'
        check (plan in ('trial', 'foundation', 'scale', 'thrive', 'agency', 'enterprise', 'legacy')),
      add column plan_status text not null default 'trialing'
        check (plan_status in ('trialing', 'active', 'past_due', 'canceled', 'read_only')),
      add column trial_ends_at timestamptz default (now() + interval '14 days'),
      add column period_end timestamptz,
      add column extras jsonb not null default '{}'::jsonb,
      add column stripe_customer_id text,
      add column stripe_subscription_id text;
    update public.workspaces set plan = 'legacy', plan_status = 'active', trial_ends_at = null;
  end if;
end $$;

-- New workspaces start on the 14 day trial, with the trial's limits (see PLANS.trial).
alter table public.workspaces alter column brand_limit set default 1;
alter table public.workspaces alter column prompt_limit set default 20;
alter table public.workspaces alter column daily_answer_limit set default 150;

create index if not exists workspaces_stripe_customer_idx on public.workspaces (stripe_customer_id);

-- Only the server changes a plan (from Stripe), together with the limits the database enforces.
create or replace function public.apply_plan(
  p_ws uuid, p_plan text, p_status text, p_brand_limit int, p_prompt_limit int, p_answer_limit int,
  p_extras jsonb default '{}'::jsonb, p_period_end timestamptz default null, p_trial_ends_at timestamptz default null
) returns void
language sql security definer set search_path = '' as $$
  update public.workspaces set
    plan = p_plan, plan_status = p_status, brand_limit = p_brand_limit, prompt_limit = p_prompt_limit,
    daily_answer_limit = p_answer_limit, extras = coalesce(p_extras, '{}'::jsonb), period_end = p_period_end, trial_ends_at = p_trial_ends_at
  where id = p_ws;
$$;
revoke execute on function public.apply_plan(uuid, text, text, int, int, int, jsonb, timestamptz, timestamptz) from public, anon, authenticated;

-- ─────────────── allowances ───────────────
-- One row per workspace, metric and period: "2026-10" for monthly allowances, "2026-10-09" for daily ones.
create table if not exists public.usage_counters (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  metric text not null,
  period text not null,
  used int not null default 0,
  primary key (workspace_id, metric, period)
);
alter table public.usage_counters enable row level security;
drop policy if exists "usage counters read" on public.usage_counters;
create policy "usage counters read" on public.usage_counters for select using (public.has_role(workspace_id, 'viewer'));

-- Use n of an allowance if it fits under the limit. Returns how many are used after, or -1 when it does not fit.
create or replace function public.take_allowance(p_ws uuid, p_metric text, p_period text, p_limit int, p_n int default 1) returns int
language plpgsql security definer set search_path = '' as $$
declare used_now int;
begin
  if p_limit <= 0 or p_n > p_limit then return -1; end if;
  insert into public.usage_counters as u (workspace_id, metric, period, used) values (p_ws, p_metric, p_period, p_n)
  on conflict (workspace_id, metric, period) do update set used = u.used + p_n where u.used + p_n <= p_limit
  returning used into used_now;
  return coalesce(used_now, -1);
end;
$$;

-- Hand an allowance back, when the action failed or cost nothing (a saved result).
create or replace function public.give_back(p_ws uuid, p_metric text, p_period text, p_n int default 1) returns void
language sql security definer set search_path = '' as $$
  update public.usage_counters set used = greatest(0, used - p_n) where workspace_id = p_ws and metric = p_metric and period = p_period;
$$;
revoke execute on function public.take_allowance(uuid, text, text, int, int) from public, anon, authenticated;
revoke execute on function public.give_back(uuid, text, text, int) from public, anon, authenticated;

-- ─────────────── cost ledger (server only, never shown to customers) ───────────────
create table if not exists public.cost_ledger (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  at timestamptz not null default now(),
  action text not null,
  cost numeric(12, 6) not null,
  parts jsonb not null default '{}'::jsonb
);
alter table public.cost_ledger enable row level security; -- no policies: only the server's secret key can read or write
create index if not exists cost_ledger_ws_at_idx on public.cost_ledger (workspace_id, at desc);

-- Cost per workspace per month, next to its plan. Read it in the SQL Editor to see margin per customer.
create or replace view public.cost_by_workspace with (security_invoker = true) as
  select w.id as workspace_id, w.name, w.plan, date_trunc('month', c.at)::date as month,
         round(sum(c.cost), 2) as cost, count(*) as actions
  from public.cost_ledger c join public.workspaces w on w.id = c.workspace_id
  group by w.id, w.name, w.plan, date_trunc('month', c.at);
revoke all on public.cost_by_workspace from anon, authenticated;
