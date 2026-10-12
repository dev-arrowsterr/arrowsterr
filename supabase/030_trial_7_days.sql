-- The free trial is 7 days. Run this once in Supabase → SQL Editor, after 029_brief_started.sql.
-- New workspaces get 7 days, counted from when their maker signed up (see 018_one_trial.sql).
-- Trials already running keep the end date they have.

alter table public.workspaces alter column trial_ends_at set default (now() + interval '7 days');

create or replace function public.trial_from_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare joined timestamptz;
begin
  if new.plan <> 'trial' or new.created_by is null then return new; end if;
  select created_at into joined from auth.users where id = new.created_by;
  if joined is not null then
    new.trial_ends_at := least(coalesce(new.trial_ends_at, now() + interval '7 days'), joined + interval '7 days');
  end if;
  return new;
end;
$$;
