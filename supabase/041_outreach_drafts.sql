-- Outreach, step 2b: one email draft per target, written by Zippie for a purpose and edited by people.
-- Run this once in Supabase → SQL Editor, after 040_outreach.sql.

alter table public.outreach_targets add column if not exists draft_status text not null default 'none' check (draft_status in ('none', 'pending', 'ready', 'failed'));
alter table public.outreach_targets add column if not exists draft_purpose text;
alter table public.outreach_targets add column if not exists draft_note text;     -- what the person asked the email to offer
alter table public.outreach_targets add column if not exists draft_subject text;
alter table public.outreach_targets add column if not exists draft_body text;
alter table public.outreach_targets add column if not exists draft_why text;      -- what Zippie used to make it personal
alter table public.outreach_targets add column if not exists draft_error text;
alter table public.outreach_targets add column if not exists drafted_at timestamptz;
