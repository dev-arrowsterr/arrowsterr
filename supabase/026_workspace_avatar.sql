-- A picture for each workspace. Null means use the first brand's logo.
-- Run this once in Supabase → SQL Editor, after 025_snapshots.sql.

alter table public.workspaces add column if not exists avatar text;
