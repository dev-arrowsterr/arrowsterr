-- Stripe billing, seat limits and billing-date resets. Run this once in Supabase → SQL Editor, after 016_queue.sql.
-- Stripe tells the server about every change (POST /api/billing/webhook), and the server writes it here.

-- ─────────────── billing on each workspace ───────────────
alter table public.workspaces add column if not exists seat_limit int not null default 3;
alter table public.workspaces add column if not exists billing_anchor timestamptz;  -- monthly allowances reset on this day of the month
alter table public.workspaces add column if not exists billing_interval text;       -- month or year
alter table public.workspaces add column if not exists cancel_at timestamptz;       -- set when a plan is canceled to end later

update public.workspaces set seat_limit = 15 where plan = 'legacy' and seat_limit = 3;
update public.workspaces set billing_anchor = created_at where billing_anchor is null;
alter table public.workspaces alter column billing_anchor set default now();
create unique index if not exists workspaces_stripe_sub_idx on public.workspaces (stripe_subscription_id) where stripe_subscription_id is not null;

-- Each Stripe event is handled once, even when Stripe sends it again.
create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  at timestamptz not null default now()
);
alter table public.stripe_events enable row level security; -- no policies: server only

-- ─────────────── seats ───────────────
-- Members plus open invites can never be more than the plan's seats.
create or replace function public.check_seats() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim int; members int; open_invites int;
begin
  select seat_limit into lim from public.workspaces where id = new.workspace_id;
  if lim is null then return new; end if;
  select count(*) into members from public.workspace_members where workspace_id = new.workspace_id;
  if tg_table_name = 'workspace_members' then
    -- An invite already holds its seat, so joining only needs a free member spot.
    if members > 0 and members >= lim then
      raise exception 'This workspace uses all % seats on its plan. Boost the plan to add people.', lim;
    end if;
  else
    select count(*) into open_invites from public.workspace_invites where workspace_id = new.workspace_id and accepted_at is null;
    if members + open_invites >= lim then
      raise exception 'This workspace uses all % seats on its plan. Boost the plan to add people.', lim;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists members_seats on public.workspace_members;
create trigger members_seats before insert on public.workspace_members for each row execute function public.check_seats();
drop trigger if exists invites_seats on public.workspace_invites;
create trigger invites_seats before insert on public.workspace_invites for each row execute function public.check_seats();
