-- Leaner plan limits so every plan keeps a healthy margin.
-- Run this once in Supabase → SQL Editor, after 019_plans_v2.sql. The numbers match src/lib/plans.ts.

-- New workspaces start on the trial: 25 prompts checked weekly, 3 seats.
alter table public.workspaces alter column prompt_limit set default 25;
alter table public.workspaces alter column daily_answer_limit set default 180;

-- Existing workspaces move to their plan's new limits. Daily answers = (prompts + Check now per day) × 6 AIs.
update public.workspaces set
  prompt_limit = case plan when 'foundation' then 50 when 'scale' then 50 when 'thrive' then 50 when 'agency' then 120 when 'trial' then 25 else prompt_limit end,
  daily_answer_limit = case plan when 'foundation' then 312 when 'scale' then 330 when 'thrive' then 360 when 'agency' then 900 when 'trial' then 180 else daily_answer_limit end
where plan in ('foundation', 'scale', 'thrive', 'agency', 'trial');
