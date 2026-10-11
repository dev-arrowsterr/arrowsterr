-- When a content brief started, so the app can tell a stuck brief from a slow one.
-- Run this once in Supabase → SQL Editor, after 028_doc_images.sql.

alter table public.calendar_items add column if not exists brief_started_at timestamptz;
