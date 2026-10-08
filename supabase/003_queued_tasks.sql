-- Cheaper daily runs: ChatGPT, Gemini and AI Overview answers are queued at DataForSEO and collected later.
-- Run this once in Supabase → SQL Editor, after 002_daily_runs_and_limits.sql.
-- queued: DataForSEO tasks still waiting, as [{"id": "...", "engine": "ChatGPT", "prompt": "..."}].
alter table public.runs add column queued jsonb not null default '[]';
