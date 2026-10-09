-- New plan limits: shared prompts, unlimited brands, weekly or daily checks, tracked-visit caps.
-- Run this once in Supabase → SQL Editor, after 018_one_trial.sql. The numbers match src/lib/plans.ts.

-- New workspaces start on the trial: 50 prompts, 3 seats, any number of brands.
alter table public.workspaces alter column brand_limit set default 1000;
alter table public.workspaces alter column prompt_limit set default 50;
alter table public.workspaces alter column daily_answer_limit set default 330;
alter table public.workspaces alter column seat_limit set default 3;

-- Existing workspaces move to their plan's new limits.
update public.workspaces set
  brand_limit = 1000,
  prompt_limit = case plan when 'foundation' then 50 when 'scale' then 100 when 'thrive' then 100 when 'agency' then 250 when 'enterprise' then 1000 when 'trial' then 50 else greatest(prompt_limit, 50) end,
  seat_limit = case plan when 'foundation' then 1 when 'scale' then 3 when 'thrive' then 5 when 'agency' then 15 when 'enterprise' then 1000 when 'trial' then 3 else greatest(seat_limit, 15) end,
  daily_answer_limit = case plan when 'foundation' then 312 when 'scale' then 630 when 'thrive' then 750 when 'agency' then 2100 when 'enterprise' then 9000 when 'trial' then 330 else greatest(daily_answer_limit, 600) end;

-- Add to a counter without a limit check, and return the new total. Used for tracked visits,
-- which are counted in batches and stopped once the plan's monthly number is reached.
create or replace function public.add_usage(p_ws uuid, p_metric text, p_period text, p_n int) returns int
language sql security definer set search_path = '' as $$
  insert into public.usage_counters as u (workspace_id, metric, period, used) values (p_ws, p_metric, p_period, p_n)
  on conflict (workspace_id, metric, period) do update set used = u.used + p_n
  returning used;
$$;
revoke execute on function public.add_usage(uuid, text, text, int) from public, anon, authenticated;
