-- The job queue, shared AI answers, rate limits and daily numbers. Run this once in Supabase → SQL Editor, after 015_billing.sql.
-- Workers (POST /api/worker) claim jobs from this table. Two workers never get the same job, a crashed
-- worker's job comes back after its lease ends, and failed jobs retry with a growing wait.
-- Everything here is server-only: no policies, and the functions are closed to signed-in users.

-- ─────────────── jobs ───────────────
create table if not exists public.jobs (
  id bigint generated always as identity primary key,
  kind text not null,                       -- schedule, check, brief, plan, rollup
  key text unique,                          -- optional: the same key is only queued once
  workspace_id uuid references public.workspaces (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'dead')),
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null default 6,
  locked_until timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.jobs enable row level security;
create index if not exists jobs_ready_idx on public.jobs (run_at) where status = 'queued';
create index if not exists jobs_lease_idx on public.jobs (locked_until) where status = 'running';
create index if not exists jobs_kind_idx on public.jobs (kind, status);

-- Add a job. With a key, a second add of the same key does nothing. Returns the job id, or null when it already existed.
create or replace function public.enqueue_job(p_kind text, p_payload jsonb, p_workspace uuid default null, p_key text default null, p_run_at timestamptz default now(), p_max_attempts int default 6)
returns bigint language sql security definer set search_path = '' as $$
  insert into public.jobs (kind, key, workspace_id, payload, run_at, max_attempts)
  values (p_kind, p_key, p_workspace, coalesce(p_payload, '{}'::jsonb), coalesce(p_run_at, now()), p_max_attempts)
  on conflict (key) do nothing
  returning id;
$$;

-- Take up to p_limit ready jobs for one worker. Jobs whose lease ran out (a worker died) are taken again.
create or replace function public.claim_jobs(p_worker text, p_limit int default 10, p_lease_seconds int default 300, p_kinds text[] default null)
returns setof public.jobs language sql security definer set search_path = '' as $$
  update public.jobs j set status = 'running', attempts = j.attempts + 1, locked_by = p_worker,
    locked_until = now() + make_interval(secs => p_lease_seconds)
  where j.id in (
    select id from public.jobs
    where ((status = 'queued' and run_at <= now()) or (status = 'running' and locked_until < now()))
      and (p_kinds is null or kind = any (p_kinds))
    order by run_at
    limit p_limit
    for update skip locked
  )
  returning j.*;
$$;

create or replace function public.finish_job(p_id bigint) returns void
language sql security definer set search_path = '' as $$
  update public.jobs set status = 'done', finished_at = now(), locked_until = null where id = p_id;
$$;

-- Put a job back to run later: to wait on something (p_count = false, no attempt used), or after an error.
-- After max_attempts errors it is marked dead and kept for a look.
create or replace function public.retry_job(p_id bigint, p_error text, p_seconds int, p_payload jsonb default null, p_count boolean default true)
returns void language sql security definer set search_path = '' as $$
  update public.jobs set
    status = case when p_count and attempts >= max_attempts then 'dead' else 'queued' end,
    attempts = case when p_count then attempts else greatest(0, attempts - 1) end,
    run_at = now() + make_interval(secs => p_seconds),
    last_error = p_error,
    payload = coalesce(p_payload, payload),
    locked_until = null,
    finished_at = case when p_count and attempts >= max_attempts then now() else null end
  where id = p_id;
$$;

-- Old finished jobs are not needed. The worker calls this now and then.
create or replace function public.prune_jobs() returns void
language sql security definer set search_path = '' as $$
  delete from public.jobs where status = 'done' and finished_at < now() - interval '3 days';
  delete from public.jobs where status = 'dead' and finished_at < now() - interval '30 days';
$$;

-- ─────────────── runs fill in one answer at a time ───────────────
alter table public.runs add column if not exists expected int;

-- Add one chat to a run without losing a chat another worker adds at the same moment.
-- Returns true when this was the last one, and marks the run done.
create or replace function public.append_chat(p_run uuid, p_chat jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare total int; want int;
begin
  update public.runs set chats = chats || jsonb_build_array(p_chat)
  where id = p_run
  returning jsonb_array_length(chats), expected into total, want;
  if want is not null and total >= want then
    update public.runs set status = case when exists (
      select 1 from jsonb_array_elements(chats) c where c->>'error' like 'Daily limit reached%') then 'limited' else 'done' end
    where id = p_run and status = 'running';
    return found;
  end if;
  return false;
end;
$$;

-- ─────────────── shared answers ───────────────
-- An AI's answer to a prompt on a day is the same for every customer who tracks that prompt.
-- It is asked once and read by every brand that tracks it; only the brand reading runs per brand.
create table if not exists public.shared_answers (
  engine text not null,
  prompt_key text not null,                 -- the prompt, lowercased with spaces tidied
  market text not null default 'default',
  day date not null,
  answer jsonb not null,                    -- { text, sources, shown, organic, queries }
  created_at timestamptz not null default now(),
  primary key (engine, prompt_key, market, day)
);
alter table public.shared_answers enable row level security;
create index if not exists shared_answers_day_idx on public.shared_answers (day);

-- ─────────────── rate limits per AI provider ───────────────
-- A fixed one-minute window per key, shared by every worker. Returns true when the call may go ahead.
create table if not exists public.rate_buckets (
  key text not null,
  minute timestamptz not null,
  used int not null default 0,
  primary key (key, minute)
);
alter table public.rate_buckets enable row level security;

create or replace function public.take_rate(p_key text, p_per_minute int, p_n int default 1) returns boolean
language plpgsql security definer set search_path = '' as $$
declare m timestamptz := date_trunc('minute', now()); got int;
begin
  insert into public.rate_buckets as b (key, minute, used) values (p_key, m, p_n)
  on conflict (key, minute) do update set used = b.used + p_n where b.used + p_n <= p_per_minute
  returning used into got;
  if random() < 0.01 then delete from public.rate_buckets where minute < now() - interval '10 minutes'; end if;
  return got is not null;
end;
$$;

-- ─────────────── daily numbers ───────────────
-- One row per brand, day, AI and named brand: how often it was named, its average spot and sentiment.
-- Filled when a daily run finishes. Dashboards and reports can read these instead of every answer.
create table if not exists public.daily_metrics (
  brand_id uuid not null references public.brands (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  day date not null,
  engine text not null,
  named text not null,                      -- the brand named in answers ('' for the row that counts answers)
  is_you boolean not null default false,
  answers int not null default 0,           -- answered chats that day on that AI
  mentions int not null default 0,          -- answers that named this brand
  position_sum numeric not null default 0,
  sentiment_sum numeric not null default 0,
  primary key (brand_id, day, engine, named)
);
alter table public.daily_metrics enable row level security;
drop policy if exists "daily metrics read" on public.daily_metrics;
create policy "daily metrics read" on public.daily_metrics for select using (public.has_role(workspace_id, 'viewer'));
create index if not exists daily_metrics_brand_day_idx on public.daily_metrics (brand_id, day);

revoke execute on function public.enqueue_job(text, jsonb, uuid, text, timestamptz, int) from public, anon, authenticated;
revoke execute on function public.claim_jobs(text, int, int, text[]) from public, anon, authenticated;
revoke execute on function public.finish_job(bigint) from public, anon, authenticated;
revoke execute on function public.retry_job(bigint, text, int, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.prune_jobs() from public, anon, authenticated;
revoke execute on function public.append_chat(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.take_rate(text, int, int) from public, anon, authenticated;
