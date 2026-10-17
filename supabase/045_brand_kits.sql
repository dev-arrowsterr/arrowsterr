-- Brand Kits (docs/reports.md, section 31): the logo, colors, fonts and voice the agent learns from a website.
-- One kit for the workspace itself (key 'workspace'), plus one per client brand (key = the brand's id).
-- Run this once in Supabase → SQL Editor, after 044_free_tools.sql. Safe to run again.
--
-- Members read. Editors learn, change and delete. The kit is learned during onboarding and in Settings → Brand Kit.

create table if not exists public.brand_kits (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  key text not null,                                -- 'workspace', or the client brand's id
  brand_id uuid references public.brands (id) on delete cascade,
  website text,
  kit jsonb not null,                               -- see BrandKit in src/lib/brandKit.ts
  learned_at timestamptz,
  confirmed_at timestamptz,                         -- when someone said the kit looks right
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, key),
  check ((key = 'workspace' and brand_id is null) or (brand_id is not null and key = brand_id::text))
);
alter table public.brand_kits enable row level security;
drop policy if exists "brand kit read" on public.brand_kits;
drop policy if exists "brand kit add" on public.brand_kits;
drop policy if exists "brand kit edit" on public.brand_kits;
drop policy if exists "brand kit delete" on public.brand_kits;
create policy "brand kit read" on public.brand_kits for select using (public.has_role(workspace_id, 'viewer'));
create policy "brand kit add" on public.brand_kits for insert with check (public.has_role(workspace_id, 'editor'));
create policy "brand kit edit" on public.brand_kits for update using (public.has_role(workspace_id, 'editor')) with check (public.has_role(workspace_id, 'editor'));
create policy "brand kit delete" on public.brand_kits for delete using (public.has_role(workspace_id, 'editor'));

-- A white label style saved before Brand Kits becomes the workspace kit, once.
insert into public.brand_kits (workspace_id, key, website, kit, learned_at, confirmed_at, updated_by, updated_at)
select
  s.workspace_id,
  'workspace',
  s.website,
  jsonb_build_object(
    'name', coalesce(s.style ->> 'agency', ''),
    'logo', coalesce(s.style ->> 'logo', ''),
    'footer', coalesce(s.style ->> 'footer', ''),
    'colors', jsonb_build_object(
      'primary', coalesce(s.style #>> '{theme,accent}', s.style ->> 'color'),
      'secondary', s.style #>> '{theme,accent2}',
      'ink', s.style #>> '{theme,ink}',
      'text', s.style #>> '{theme,text}',
      'muted', s.style #>> '{theme,muted}',
      'paper', s.style #>> '{theme,paper}',
      'surface', s.style #>> '{theme,surface}',
      'line', s.style #>> '{theme,line}'
    ),
    'fonts', jsonb_build_object('heading', s.style #>> '{theme,heading}', 'body', s.style #>> '{theme,body}'),
    'radius', s.style #> '{theme,radius}'
  ),
  s.updated_at,
  s.updated_at,
  s.updated_by,
  s.updated_at
from public.report_styles s
where coalesce(s.style ->> 'agency', '') <> '' or coalesce(s.style ->> 'logo', '') <> ''
on conflict (workspace_id, key) do nothing;
