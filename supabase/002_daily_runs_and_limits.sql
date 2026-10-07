-- Daily runs and usage limits. Run this once in Supabase → SQL Editor, after schema.sql.

-- ─────────────── limits ───────────────
-- Each workspace has limits. Change them in Supabase → Table Editor → workspaces. Users cannot change them.
alter table public.workspaces
  add column brand_limit int not null default 3,
  add column prompt_limit int not null default 50,
  add column daily_answer_limit int not null default 500;

-- Admins may rename a workspace, but never change its limits.
revoke update on public.workspaces from authenticated, anon;
grant update (name) on public.workspaces to authenticated;

-- AI answers used per workspace per day (UTC).
create table public.usage (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  day date not null,
  answers int not null default 0,
  primary key (workspace_id, day)
);
alter table public.usage enable row level security;
create policy "usage read" on public.usage for select using (public.has_role(workspace_id, 'viewer'));

-- Count one AI answer against today's limit. Returns false when the limit is used up.
-- Signed-in people must be editors. The server's daily job uses the secret key.
create function public.take_answer(p_ws uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare lim int; used int;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and not public.has_role(p_ws, 'editor') then
    raise exception 'You need editor access in this workspace.';
  end if;
  select daily_answer_limit into lim from public.workspaces where id = p_ws;
  if lim is null or lim <= 0 then return false; end if;
  insert into public.usage as u (workspace_id, day, answers) values (p_ws, (now() at time zone 'utc')::date, 1)
  on conflict (workspace_id, day) do update set answers = u.answers + 1 where u.answers < lim
  returning answers into used;
  return used is not null;
end;
$$;
revoke execute on function public.take_answer(uuid) from public, anon;
grant execute on function public.take_answer(uuid) to authenticated;

-- Brand and prompt limits, checked on every save.
create function public.check_brand_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
declare w public.workspaces; n int;
begin
  select * into w from public.workspaces where id = new.workspace_id;
  if tg_op = 'INSERT' then
    select count(*) into n from public.brands where workspace_id = new.workspace_id;
    if n >= w.brand_limit then
      raise exception 'This workspace can track % brands. Remove one first.', w.brand_limit;
    end if;
  end if;
  -- Only block when prompts are added, so a workspace over its limit can still remove some.
  if cardinality(new.prompts) > (case when tg_op = 'UPDATE' then cardinality(old.prompts) else 0 end) then
    select coalesce(sum(cardinality(prompts)), 0) into n from public.brands where workspace_id = new.workspace_id and id <> new.id;
    if n + cardinality(new.prompts) > w.prompt_limit then
      raise exception 'This workspace can track % prompts. % are in use.', w.prompt_limit, n;
    end if;
  end if;
  return new;
end;
$$;
create trigger brands_limits before insert or update on public.brands
  for each row execute function public.check_brand_limits();

-- Each person can make up to 3 workspaces, so limits cannot be dodged with new workspaces.
create or replace function public.create_workspace(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ws uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if (select count(*) from public.workspaces where created_by = auth.uid()) >= 3 then
    raise exception 'You can make up to 3 workspaces.';
  end if;
  insert into public.workspaces (name, created_by) values (coalesce(nullif(trim(p_name), ''), 'My workspace'), auth.uid())
  returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, email, role)
  values (ws, auth.uid(), auth.jwt() ->> 'email', 'owner');
  return ws;
end;
$$;

-- ─────────────── daily runs ───────────────
alter table public.brands add column daily boolean not null default true;

-- source: manual (run from the browser) or daily (run by the server).
-- prompts: the prompts a daily run covers. status: running, done, or limited (stopped at the daily limit).
alter table public.runs
  add column source text not null default 'manual' check (source in ('manual', 'daily')),
  add column prompts text[],
  add column status text not null default 'done' check (status in ('running', 'done', 'limited'));
create index runs_daily_idx on public.runs (status, at) where source = 'daily';

-- People can only add and edit their own manual runs. Daily runs belong to the server.
drop policy "runs add" on public.runs;
drop policy "runs update" on public.runs;
create policy "runs add" on public.runs for insert
  with check (public.has_role(workspace_id, 'editor') and created_by = auth.uid() and source = 'manual' and status = 'done');
create policy "runs update" on public.runs for update
  using (public.has_role(workspace_id, 'editor') and created_by = auth.uid() and source = 'manual')
  with check (public.has_role(workspace_id, 'editor') and created_by = auth.uid() and source = 'manual' and status = 'done');
