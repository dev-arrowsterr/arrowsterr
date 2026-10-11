-- A SERP analysis for each Content Plan piece: Google's top 10 read once and reused by the brief.
-- Run this once in Supabase → SQL Editor, after 026_workspace_avatar.sql.

alter table public.calendar_items add column if not exists serp jsonb;
alter table public.calendar_items add column if not exists serp_at timestamptz;
