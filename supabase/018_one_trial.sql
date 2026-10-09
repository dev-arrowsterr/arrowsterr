-- One free trial per person. Run this once in Supabase → SQL Editor, after 017_stripe.sql.
-- A new workspace's trial ends 14 days after its maker signed up, so making more workspaces
-- (or deleting and remaking one) never starts a fresh trial.

create or replace function public.trial_from_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare joined timestamptz;
begin
  if new.plan <> 'trial' or new.created_by is null then return new; end if;
  select created_at into joined from auth.users where id = new.created_by;
  if joined is not null then
    new.trial_ends_at := least(coalesce(new.trial_ends_at, now() + interval '14 days'), joined + interval '14 days');
  end if;
  return new;
end;
$$;

drop trigger if exists workspaces_one_trial on public.workspaces;
create trigger workspaces_one_trial before insert on public.workspaces for each row execute function public.trial_from_signup();
