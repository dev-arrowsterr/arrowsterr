-- Publishing details for each draft: meta title, meta description, slug, featured image and FAQ schema,
-- and the CMS connections a workspace publishes to.
-- Run this once in Supabase → SQL Editor, after 020_leaner_plans.sql.

alter table public.docs add column if not exists meta jsonb not null default '{}'::jsonb;
