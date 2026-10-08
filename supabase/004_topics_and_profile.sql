-- Topic-based tracking. Run this once in Supabase → SQL Editor, after 003_queued_tasks.sql.
-- profile: what the business sells and to whom, from the onboarding questions.
-- topics: [{"name": "reputation management software", "prompts": ["...", "..."]}]
-- prompts stays as the flat list every run uses, kept in step with topics by the app.
alter table public.brands
  add column profile jsonb not null default '{}',
  add column topics jsonb not null default '[]';
