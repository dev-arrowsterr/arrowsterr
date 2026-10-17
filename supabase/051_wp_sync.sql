-- WordPress sync (docs/content-v2.md, Publish). Run this once in Supabase → SQL Editor, after 048_brand_integrations.sql.
-- Safe to run again.
--
-- One row per article and publishing site: the WordPress post it became, its address and its state on the site
-- as last read back. Publishing again updates that post, never a new one. A post deleted in WordPress shows as
-- deleted, and only then can the article be published again as a new post.
-- Members read. Only the server writes (/api/cms and the wp_publish job).

create table if not exists public.doc_publications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  doc_id uuid not null references public.docs (id) on delete cascade,
  connection_id uuid not null references public.cms_connections (id) on delete cascade,
  kind text not null default 'wordpress' check (kind in ('wordpress')),
  remote_id text,                       -- the WordPress post id
  url text,                             -- the post's link
  remote_status text check (remote_status in ('draft', 'pending', 'private', 'future', 'publish', 'trash', 'deleted')),
  remote_modified timestamptz,          -- modified_gmt, as last read from WordPress
  pushed_modified timestamptz,          -- modified_gmt right after Arrowsterr's last write: a later one means it was edited in WordPress
  mode text check (mode in ('draft', 'publish', 'schedule')),
  scheduled_for timestamptz,            -- with mode 'schedule'
  options jsonb not null default '{}'::jsonb, -- slug, category, tags, meta title and description, featured image
  media jsonb not null default '{}'::jsonb,   -- image address → WordPress media id, so publishing again never uploads twice
  creating_since timestamptz,           -- set just before a new post is created, cleared once its id is saved
  locked_until timestamptz,             -- one publish at a time per article and site
  last_error text,
  pushed_at timestamptz,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (doc_id, connection_id)
);
create index if not exists doc_publications_ws on public.doc_publications (workspace_id);
create index if not exists doc_publications_conn on public.doc_publications (connection_id);
alter table public.doc_publications enable row level security;
drop policy if exists "doc publications read" on public.doc_publications;
create policy "doc publications read" on public.doc_publications for select using (public.has_role(workspace_id, 'viewer'));

-- The article and the site must be in the same workspace as the row.
create or replace function public.doc_publication_matches() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.docs d where d.id = new.doc_id and d.workspace_id = new.workspace_id)
     or not exists (select 1 from public.cms_connections c where c.id = new.connection_id and c.workspace_id = new.workspace_id) then
    raise exception 'Article and site must be in this workspace.';
  end if;
  return new;
end;
$$;
drop trigger if exists doc_publications_matches on public.doc_publications;
create trigger doc_publications_matches before insert or update of workspace_id, doc_id, connection_id on public.doc_publications
  for each row execute function public.doc_publication_matches();

-- Take the row for one publish. False while another publish of the same article to the same site runs.
create or replace function public.lock_publication(p_id uuid, p_seconds int default 120) returns boolean
language sql security definer set search_path = '' as $$
  with t as (
    update public.doc_publications set locked_until = now() + make_interval(secs => p_seconds)
    where id = p_id and (locked_until is null or locked_until < now())
    returning 1
  )
  select exists (select 1 from t);
$$;
revoke execute on function public.lock_publication(uuid, int) from public, anon, authenticated;

-- Posts sent to WordPress before this migration (docs.meta.published) become rows, so publishing again updates them.
insert into public.doc_publications (workspace_id, doc_id, connection_id, remote_id, url, remote_status, mode, pushed_at)
select d.workspace_id, d.id, c.id, p->>'id', nullif(p->>'url', ''),
       case when (p->>'live')::boolean then 'publish' else 'draft' end,
       case when (p->>'live')::boolean then 'publish' else 'draft' end,
       coalesce((p->>'at')::timestamptz, now())
from public.docs d
cross join lateral jsonb_array_elements(case when jsonb_typeof(d.meta->'published') = 'array' then d.meta->'published' else '[]'::jsonb end) p
join public.cms_connections c on c.id::text = p->>'connectionId' and c.workspace_id = d.workspace_id and c.kind = 'wordpress'
where coalesce(p->>'id', '') <> ''
on conflict (doc_id, connection_id) do nothing;
