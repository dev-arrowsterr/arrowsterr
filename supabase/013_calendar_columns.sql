-- Custom columns in the Content calendar. Run this once in Supabase → SQL Editor, after 012_answers.sql.
-- The column names live on the website's profile. Each row keeps its values here.
alter table public.calendar_items add column if not exists extra jsonb not null default '{}'::jsonb;
