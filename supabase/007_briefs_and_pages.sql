-- Sitemap pages, page updates and content briefs. Run this once in Supabase → SQL Editor, after 006_research.sql.
-- sites.pages: the website's cleaned sitemap, as [{"url": "...", "article": true}].
-- calendar_items.action: "new" for a page to write, "update" for an existing page that ranks low.
-- calendar_items.brief: the content brief and the Google results analysis behind it.
alter table public.sites
  add column pages jsonb not null default '[]',
  add column pages_at timestamptz;

alter table public.calendar_items
  add column action text not null default 'new' check (action in ('new', 'update')),
  add column current_url text,
  add column current_rank int,
  add column brief jsonb,
  add column brief_status text check (brief_status in ('running', 'done', 'failed')),
  add column brief_error text,
  add column brief_at timestamptz;
