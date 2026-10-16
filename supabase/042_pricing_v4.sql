-- Pricing v4 (docs/pricing-v4.md): a Free forever plan, brand caps below Agency, and trials that drop to Free.
-- Run this once in Supabase → SQL Editor, after 041_outreach_drafts.sql.
-- Plans and their limits live in src/lib/plans.ts. These columns are the copy the database enforces
-- (check_brand_limits and the seat trigger), so new trials start with the trial's limits.

alter table public.workspaces alter column brand_limit set default 3;
alter table public.workspaces alter column prompt_limit set default 25;
alter table public.workspaces alter column seat_limit set default 3;
alter table public.workspaces alter column daily_answer_limit set default 180;

-- Trials running now get the trial's limits. Brands and prompts over them are kept, never deleted.
update public.workspaces
set brand_limit = 3, prompt_limit = 25, seat_limit = greatest(seat_limit, 3), daily_answer_limit = 180
where plan = 'trial';
