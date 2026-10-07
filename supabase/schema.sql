-- Arrowsterr database. Paste all of this into Supabase → SQL Editor → Run. Safe to run once on a new project.
-- Workspaces hold brands and runs. People join a workspace with a role:
--   owner  > admin  > editor > viewer
--   owner: everything. admin: manage members and everything below.
--   editor: add brands, edit prompts, run checks. viewer: read only.

create type public.ws_role as enum ('owner', 'admin', 'editor', 'viewer');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text,
  role public.ws_role not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  role public.ws_role not null check (role <> 'owner'),
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  url text not null,
  domain text not null,
  name text not null,
  logo text not null default '',
  category text not null default '',
  prompts text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index brands_workspace_idx on public.brands (workspace_id);

-- One row per run. chats holds every answer's brands, positions, sentiment and sources.
create table public.runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  at timestamptz not null default now(),
  engines text[] not null default '{}',
  chats jsonb not null default '[]',
  created_by uuid references auth.users (id) on delete set null
);
create index runs_brand_at_idx on public.runs (brand_id, at);

-- ─────────────── role helpers ───────────────

create function public.role_rank(r public.ws_role) returns int
language sql immutable set search_path = '' as $$
  select case r when 'owner' then 4 when 'admin' then 3 when 'editor' then 2 else 1 end
$$;

-- True when the signed-in user has at least this role in the workspace.
create function public.has_role(ws uuid, min public.ws_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select public.role_rank(m.role) >= public.role_rank(min)
       from public.workspace_members m
      where m.workspace_id = ws and m.user_id = auth.uid()),
    false)
$$;

-- Make a workspace and add the signed-in user as its owner.
create function public.create_workspace(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ws uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  insert into public.workspaces (name, created_by) values (coalesce(nullif(trim(p_name), ''), 'My workspace'), auth.uid())
  returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, email, role)
  values (ws, auth.uid(), auth.jwt() ->> 'email', 'owner');
  return ws;
end;
$$;

-- Join a workspace from an invite link. The invite must be for the signed-in email.
create function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv public.workspace_invites;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into inv from public.workspace_invites where token = p_token and accepted_at is null;
  if inv.id is null then raise exception 'This invite link is not valid or was already used.'; end if;
  if lower(inv.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'This invite is for %. Sign in with that email to accept it.', inv.email;
  end if;
  insert into public.workspace_members (workspace_id, user_id, email, role)
  values (inv.workspace_id, auth.uid(), auth.jwt() ->> 'email', inv.role)
  on conflict (workspace_id, user_id) do nothing;
  update public.workspace_invites set accepted_at = now() where id = inv.id;
  return inv.workspace_id;
end;
$$;

grant execute on function public.has_role(uuid, public.ws_role) to authenticated;
grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;

-- ─────────────── row level security ───────────────

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.brands enable row level security;
alter table public.runs enable row level security;

-- Workspaces: members see them, admins rename them, only the owner deletes. New ones come from create_workspace().
create policy "ws read" on public.workspaces for select using (public.has_role(id, 'viewer'));
create policy "ws rename" on public.workspaces for update using (public.has_role(id, 'admin')) with check (public.has_role(id, 'admin'));
create policy "ws delete" on public.workspaces for delete using (public.has_role(id, 'owner'));

-- Members: everyone in the workspace sees the list. Admins change roles and remove people, but never the owner.
-- Anyone except the owner can leave. New members come from create_workspace() and accept_invite().
create policy "members read" on public.workspace_members for select using (public.has_role(workspace_id, 'viewer'));
create policy "members change role" on public.workspace_members for update
  using (public.has_role(workspace_id, 'admin') and role <> 'owner')
  with check (public.has_role(workspace_id, 'admin') and role <> 'owner');
create policy "members remove" on public.workspace_members for delete
  using (role <> 'owner' and (public.has_role(workspace_id, 'admin') or user_id = auth.uid()));

-- Invites: admins only.
create policy "invites read" on public.workspace_invites for select using (public.has_role(workspace_id, 'admin'));
create policy "invites create" on public.workspace_invites for insert
  with check (public.has_role(workspace_id, 'admin') and role <> 'owner' and invited_by = auth.uid());
create policy "invites revoke" on public.workspace_invites for delete using (public.has_role(workspace_id, 'admin'));

-- Brands: members see them, editors and up change them.
create policy "brands read" on public.brands for select using (public.has_role(workspace_id, 'viewer'));
create policy "brands add" on public.brands for insert with check (public.has_role(workspace_id, 'editor'));
create policy "brands edit" on public.brands for update using (public.has_role(workspace_id, 'editor')) with check (public.has_role(workspace_id, 'editor'));
create policy "brands delete" on public.brands for delete using (public.has_role(workspace_id, 'editor'));

-- Runs: members see them, editors and up run checks, admins delete history.
create policy "runs read" on public.runs for select using (public.has_role(workspace_id, 'viewer'));
create policy "runs add" on public.runs for insert with check (public.has_role(workspace_id, 'editor') and created_by = auth.uid());
create policy "runs update" on public.runs for update using (public.has_role(workspace_id, 'editor') and created_by = auth.uid());
create policy "runs delete" on public.runs for delete using (public.has_role(workspace_id, 'admin'));

-- A run's brand must live in the same workspace as the run.
create function public.run_brand_matches() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.brands b where b.id = new.brand_id and b.workspace_id = new.workspace_id) then
    raise exception 'Brand is not in this workspace.';
  end if;
  return new;
end;
$$;
create trigger runs_brand_matches before insert or update on public.runs
  for each row execute function public.run_brand_matches();
