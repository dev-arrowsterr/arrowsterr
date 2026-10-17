-- Agentic Writer: a brief, then a draft, for each topic imported from the Editorial Calendar.
-- Run this once in Supabase → SQL Editor, after 049_article_research.sql. Safe to run again.
--
-- writer_briefs: one brief per topic. The writer_brief job waits for the article research (049), then writes
--   the brief with Claude: outline, sources, FAQs, internal links and the interactive modules to build.
--   Editors approve it through /api/agentic-writer; an approved brief is locked.
-- writer_drafts: one draft per topic, written from the approved brief by the writer_draft job, section by section.
--   Each step saves its output here, so a retried job never pays twice. The finished draft is a row in docs
--   (010_writer.sql), so the plain editor, Export and Publish work on it as on any article.
-- Drafts count against the plan: the month a draft was first made in is saved in period. Regenerate keeps it.
-- Members read. Only the server writes.

-- ─────────────── briefs ───────────────
create table if not exists public.writer_briefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  item_id uuid not null unique references public.calendar_items (id) on delete cascade,
  research_run_id uuid references public.article_runs (id) on delete set null,
  keyword text not null,
  status text not null default 'generating' check (status in ('generating', 'ready', 'approved', 'failed')),
  step text not null default 'research' check (step in ('research', 'writing', 'done')),
  brief jsonb,                                      -- see WriterBrief in src/lib/writerBrief.ts
  notes text not null default '' check (char_length(notes) <= 4000), -- the person's notes for the draft
  note text check (char_length(note) <= 300),       -- the one-line note of the last Regenerate
  version int not null default 1,                   -- goes up on Regenerate; an older job stops
  error text,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists writer_briefs_brand_idx on public.writer_briefs (brand_id, updated_at desc);
create index if not exists writer_briefs_site_idx on public.writer_briefs (site_id, updated_at desc);

-- ─────────────── drafts ───────────────
create table if not exists public.writer_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  item_id uuid not null unique references public.calendar_items (id) on delete cascade,
  brief_id uuid not null references public.writer_briefs (id) on delete cascade,
  doc_id uuid references public.docs (id) on delete set null,
  status text not null default 'generating' check (status in ('generating', 'ready', 'failed')),
  step text not null default 'sections' check (step in ('sections', 'check', 'modules', 'save', 'done')),
  version int not null default 1,
  note text check (char_length(note) <= 300),       -- the one-line note of the last Regenerate
  sections jsonb not null default '[]'::jsonb,      -- each written section, saved as it lands
  checked jsonb,                                    -- the sections after the check cut unsupported claims
  check_at timestamptz,
  modules jsonb not null default '[]'::jsonb,       -- each planned module: built, retried once, or dropped
  period text not null,                             -- the plan month this draft counted in
  words int not null default 0,
  error text,
  started_at timestamptz not null default now(),
  ready_at timestamptz,                             -- when the job last wrote the doc; a later docs.updated_at is a hand edit
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists writer_drafts_quota_idx on public.writer_drafts (brand_id, period);
create index if not exists writer_drafts_site_idx on public.writer_drafts (site_id, updated_at desc);

-- ─────────────── who sees what ───────────────
alter table public.writer_briefs enable row level security;
alter table public.writer_drafts enable row level security;
drop policy if exists "writer briefs read" on public.writer_briefs;
drop policy if exists "writer drafts read" on public.writer_drafts;
create policy "writer briefs read" on public.writer_briefs for select using (public.has_role(workspace_id, 'viewer'));
create policy "writer drafts read" on public.writer_drafts for select using (public.has_role(workspace_id, 'viewer'));

-- ─────────────── the month's drafts ───────────────
-- Make a brand's draft for one topic if the month has room. Two clicks at once wait for each other on the lock,
-- so the 11th draft is refused even when two start together. Returns the draft and what happened:
--   created  a new draft, counted in p_period
--   exists   the topic already has a draft (Regenerate it instead; nothing is counted)
--   full     the brand used the month's drafts
create or replace function public.writer_take_draft(
  p_workspace uuid, p_brand uuid, p_site uuid, p_item uuid, p_brief uuid, p_period text, p_limit int, p_user uuid default null
) returns table (draft_id uuid, outcome text) language plpgsql security definer set search_path = '' as $$
declare
  n int;
  found uuid;
begin
  perform pg_advisory_xact_lock(hashtext('writer_draft:' || coalesce(p_brand::text, p_site::text)));
  select d.id into found from public.writer_drafts d where d.item_id = p_item;
  if found is not null then
    return query select found, 'exists'::text;
    return;
  end if;
  select count(*) into n from public.writer_drafts d
    where d.period = p_period and (case when p_brand is null then d.site_id = p_site else d.brand_id = p_brand end);
  if n >= p_limit then
    return query select null::uuid, 'full'::text;
    return;
  end if;
  insert into public.writer_drafts (workspace_id, brand_id, site_id, item_id, brief_id, period, created_by)
    values (p_workspace, p_brand, p_site, p_item, p_brief, p_period, p_user)
    returning id into found;
  return query select found, 'created'::text;
end;
$$;
revoke execute on function public.writer_take_draft(uuid, uuid, uuid, uuid, uuid, text, int, uuid) from public, anon, authenticated;
