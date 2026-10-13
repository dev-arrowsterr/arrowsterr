-- Notification emails: each person picks which ones they get, per workspace.
-- Run this once in Supabase → SQL Editor, after 034_settings.sql.
-- No row means every email is on.

create table if not exists public.notification_prefs (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  weekly boolean not null default true, -- Monday summary
  alerts boolean not null default true, -- visibility drops and competitors overtaking
  jobs boolean not null default true,   -- Content Plan and brief finished or failed
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
alter table public.notification_prefs enable row level security;

drop policy if exists "prefs read" on public.notification_prefs;
drop policy if exists "prefs add" on public.notification_prefs;
drop policy if exists "prefs edit" on public.notification_prefs;
create policy "prefs read" on public.notification_prefs for select using (user_id = auth.uid());
create policy "prefs add" on public.notification_prefs for insert with check (user_id = auth.uid() and public.has_role(workspace_id, 'viewer'));
create policy "prefs edit" on public.notification_prefs for update using (user_id = auth.uid()) with check (user_id = auth.uid());
