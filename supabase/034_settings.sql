-- Settings: profile photos, workspace time zone, AI context, and joining by email domain.
-- Run this once in Supabase → SQL Editor, after 033_bulk_runs.sql.

-- ─────────────── profiles ───────────────
-- A person's name and photo, seen by the people they share a workspace with.
-- The photo lives here because a photo in the sign-in data makes every request heavy.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) <= 120),
  avatar text check (char_length(avatar) <= 200000), -- a small data: image
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "profiles read" on public.profiles;
drop policy if exists "profiles add" on public.profiles;
drop policy if exists "profiles edit" on public.profiles;
create policy "profiles read" on public.profiles for select using (
  id = auth.uid()
  or exists (
    select 1 from public.workspace_members a
    join public.workspace_members b on b.workspace_id = a.workspace_id
    where a.user_id = auth.uid() and b.user_id = profiles.id
  )
);
create policy "profiles add" on public.profiles for insert with check (id = auth.uid());
create policy "profiles edit" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- ─────────────── workspace settings ───────────────
alter table public.workspaces add column if not exists timezone text;
-- What the AI should know about the business and how it should write: { about, audience, voice, avoid }.
alter table public.workspaces add column if not exists ai_settings jsonb not null default '{}'::jsonb;
-- People who sign up with an email at this domain join the workspace on their own.
alter table public.workspaces add column if not exists allowed_domain text;
alter table public.workspaces add column if not exists join_role public.ws_role not null default 'viewer';

do $$ begin
  alter table public.workspaces add constraint workspaces_join_role check (join_role in ('viewer', 'editor'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.workspaces add constraint workspaces_allowed_domain check (allowed_domain is null or allowed_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$');
exception when duplicate_object then null; end $$;

-- ─────────────── join by email domain ───────────────
-- Adds the signed-in person to every workspace that allows their email domain.
-- A workspace counts only when one of its owners or admins has an email at that same domain,
-- so nobody can pull in people from a company they are not part of. Full workspaces are skipped.
create or replace function public.join_by_domain() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  em text;
  dom text;
  ws record;
  first uuid;
begin
  if auth.uid() is null then return null; end if;
  select lower(u.email) into em from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
  if em is null or position('@' in em) = 0 then return null; end if;
  dom := split_part(em, '@', 2);
  -- Shared email services never count, or anyone with a Gmail address could walk in.
  if dom = any (array['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','msn.com','yahoo.com','ymail.com','icloud.com','me.com','mac.com','aol.com','proton.me','protonmail.com','gmx.com','gmx.de','mail.com','zoho.com','yandex.com','yandex.ru','qq.com','163.com','hey.com','fastmail.com','web.de','orange.fr','free.fr','libero.it']) then
    return null;
  end if;
  for ws in
    select w.id, w.join_role from public.workspaces w
    where w.allowed_domain = dom
      and exists (
        select 1 from public.workspace_members m
        where m.workspace_id = w.id and m.role in ('owner', 'admin') and lower(split_part(m.email, '@', 2)) = dom
      )
      and not exists (select 1 from public.workspace_members m where m.workspace_id = w.id and m.user_id = auth.uid())
    order by w.created_at
  loop
    begin
      insert into public.workspace_members (workspace_id, user_id, email, role) values (ws.id, auth.uid(), em, ws.join_role);
      first := coalesce(first, ws.id);
    exception when others then
      null; -- no free seat
    end;
  end loop;
  return first;
end;
$$;
grant execute on function public.join_by_domain() to authenticated;
