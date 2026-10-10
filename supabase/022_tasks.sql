-- Task plans: a Free forever plan, tasks counted each month, and task packs that never expire.
-- Run this once in Supabase → SQL Editor, after 021_doc_meta.sql.

-- The Free plan.
alter table public.workspaces drop constraint if exists workspaces_plan_check;
alter table public.workspaces add constraint workspaces_plan_check
  check (plan in ('free', 'trial', 'foundation', 'scale', 'thrive', 'agency', 'enterprise', 'legacy'));

-- Tasks bought in packs. Used only after the month's plan tasks run out.
alter table public.workspaces add column if not exists task_credits int not null default 0;

-- Use n tasks: the month's plan tasks first, then pack tasks. Returns how many came from packs, or -1 if not enough.
create or replace function public.take_tasks(p_ws uuid, p_period text, p_limit int, p_n int) returns int
language plpgsql security definer set search_path = '' as $$
declare used_now int; room int; from_pack int; left_after int;
begin
  insert into public.usage_counters (workspace_id, metric, period, used) values (p_ws, 'tasks', p_period, 0)
  on conflict (workspace_id, metric, period) do nothing;
  select used into used_now from public.usage_counters where workspace_id = p_ws and metric = 'tasks' and period = p_period for update;
  room := greatest(0, p_limit - used_now);
  from_pack := greatest(0, p_n - room);
  if from_pack > 0 then
    update public.workspaces set task_credits = task_credits - from_pack where id = p_ws and task_credits >= from_pack returning task_credits into left_after;
    if left_after is null then return -1; end if;
  end if;
  update public.usage_counters set used = used + (p_n - from_pack) where workspace_id = p_ws and metric = 'tasks' and period = p_period;
  return from_pack;
end;
$$;

-- Hand tasks back when an action failed or cost nothing.
create or replace function public.give_back_tasks(p_ws uuid, p_period text, p_plan_n int, p_pack_n int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.usage_counters set used = greatest(0, used - p_plan_n) where workspace_id = p_ws and metric = 'tasks' and period = p_period;
  if p_pack_n > 0 then update public.workspaces set task_credits = task_credits + p_pack_n where id = p_ws; end if;
end;
$$;

-- Add a bought pack. Each Stripe payment counts once.
create table if not exists public.task_purchases (
  id text primary key, -- the Stripe Checkout session
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  tasks int not null,
  amount int not null, -- cents
  at timestamptz not null default now()
);
alter table public.task_purchases enable row level security;
drop policy if exists task_purchases_read on public.task_purchases;
create policy task_purchases_read on public.task_purchases for select using (public.has_role(workspace_id, 'viewer'));

create or replace function public.add_task_pack(p_id text, p_ws uuid, p_tasks int, p_amount int) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.task_purchases (id, workspace_id, tasks, amount) values (p_id, p_ws, p_tasks, p_amount);
  update public.workspaces set task_credits = task_credits + p_tasks where id = p_ws;
  return true;
exception when unique_violation then
  return false;
end;
$$;

revoke execute on function public.take_tasks(uuid, text, int, int) from public, anon, authenticated;
revoke execute on function public.give_back_tasks(uuid, text, int, int) from public, anon, authenticated;
revoke execute on function public.add_task_pack(text, uuid, int, int) from public, anon, authenticated;
