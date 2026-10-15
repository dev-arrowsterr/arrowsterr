-- Longer retries: a failed job now tries 8 times over about 7 hours (the waits live in src/lib/retryPolicy.ts),
-- so an outage of a few hours loses nothing. Plus a way to run dead jobs again.
-- Run this once in Supabase → SQL Editor, after 037_zippie.sql.

alter table public.jobs alter column max_attempts set default 8;
-- Jobs already waiting get the longer schedule too. One-shot jobs (1 or 2 tries on purpose) keep theirs.
update public.jobs set max_attempts = 8 where status in ('queued', 'running') and max_attempts = 6;

-- Run dead jobs again from the start, for example after an outage or after adding credit.
-- select retry_dead_jobs();                      every dead job from the last 2 days
-- select retry_dead_jobs('check', '6 hours');    only daily checks that died in the last 6 hours
create or replace function public.retry_dead_jobs(p_kind text default null, p_since interval default interval '2 days')
returns int language sql security definer set search_path = '' as $$
  with moved as (
    update public.jobs set status = 'queued', attempts = 0, run_at = now(), locked_by = null, locked_until = null, finished_at = null
    where status = 'dead' and finished_at >= now() - p_since and (p_kind is null or kind = p_kind)
    returning 1
  )
  select count(*)::int from moved;
$$;
revoke execute on function public.retry_dead_jobs(text, interval) from public, anon, authenticated;
