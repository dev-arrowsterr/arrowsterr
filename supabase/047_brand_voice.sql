-- Brand Voice (docs/content-v2.md): how each brand writes, distilled from 3 to 5 of its best pages or pasted text.
-- Every article is written from it. Run this once in Supabase → SQL Editor, after 046_report_files.sql. Safe to run again.
--
-- Members read. Editors distill, change and delete.

create table if not exists public.brand_voices (
  brand_id uuid primary key references public.brands (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  sample_urls text[] not null default '{}' check (cardinality(sample_urls) <= 5),
  sample_text text not null default '' check (char_length(sample_text) <= 30000),
  voice jsonb,                                      -- see BrandVoice in src/lib/brandVoice.ts; null before the first distill
  distilled_at timestamptz,
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
create index if not exists brand_voices_ws on public.brand_voices (workspace_id);

alter table public.brand_voices enable row level security;
drop policy if exists "brand voice read" on public.brand_voices;
drop policy if exists "brand voice add" on public.brand_voices;
drop policy if exists "brand voice edit" on public.brand_voices;
drop policy if exists "brand voice delete" on public.brand_voices;
create policy "brand voice read" on public.brand_voices for select using (public.has_role(workspace_id, 'viewer'));
create policy "brand voice add" on public.brand_voices for insert with check (public.has_role(workspace_id, 'editor'));
create policy "brand voice edit" on public.brand_voices for update using (public.has_role(workspace_id, 'editor')) with check (public.has_role(workspace_id, 'editor'));
create policy "brand voice delete" on public.brand_voices for delete using (public.has_role(workspace_id, 'editor'));

-- The brand must live in the same workspace as the row (same check as runs).
drop trigger if exists brand_voices_brand_matches on public.brand_voices;
create trigger brand_voices_brand_matches before insert or update on public.brand_voices
  for each row execute function public.run_brand_matches();
