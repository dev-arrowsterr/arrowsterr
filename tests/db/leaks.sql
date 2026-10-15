-- Leak tests. Each check raises an error when someone can see or do what they shouldn't.
-- People: Ann owns Acme, Ed is an editor at Acme, Vi is a viewer at Acme, Cat owns Other.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-000000000000', 'ann@acme.com', now()),
  ('e0000000-0000-0000-0000-000000000000', 'ed@acme.com', now()),
  ('b0000000-0000-0000-0000-000000000000', 'vi@acme.com', now()),
  ('c0000000-0000-0000-0000-000000000000', 'cat@other.com', now());
insert into workspaces (id, name, seat_limit, daily_answer_limit) values
  ('11111111-0000-0000-0000-000000000000', 'Acme', 10, 100),
  ('22222222-0000-0000-0000-000000000000', 'Other', 10, 100);
insert into workspace_members (workspace_id, user_id, email, role) values
  ('11111111-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000000', 'ann@acme.com', 'owner'),
  ('11111111-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000000', 'ed@acme.com', 'editor'),
  ('11111111-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000000', 'vi@acme.com', 'viewer'),
  ('22222222-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-000000000000', 'cat@other.com', 'owner');

-- One row of everything in Acme, and a few in Other.
insert into brands (id, workspace_id, url, domain, name) values
  ('b1000000-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000000', 'https://acme.com', 'acme.com', 'acme-brand'),
  ('b2000000-0000-0000-0000-000000000000', '22222222-0000-0000-0000-000000000000', 'https://other.com', 'other.com', 'other-brand');
insert into sites (id, workspace_id, domain, name) values
  ('51000000-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000000', 'acme.com', 'acme-site'),
  ('52000000-0000-0000-0000-000000000000', '22222222-0000-0000-0000-000000000000', 'other.com', 'other-site');
insert into runs (workspace_id, brand_id) values ('11111111-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000');
insert into answers (workspace_id, brand_id, engine, prompt, text) values ('11111111-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000', 'chatgpt', 'acme-prompt', 'acme-answer');
insert into daily_metrics (brand_id, workspace_id, day, engine, named) values ('b1000000-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000000', current_date, 'chatgpt', 'acme');
insert into docs (workspace_id, site_id) values ('11111111-0000-0000-0000-000000000000', '51000000-0000-0000-0000-000000000000');
insert into calendar_items (workspace_id, site_id, keyword) values ('11111111-0000-0000-0000-000000000000', '51000000-0000-0000-0000-000000000000', 'acme-keyword');
insert into keyword_runs (workspace_id, site_id) values ('11111111-0000-0000-0000-000000000000', '51000000-0000-0000-0000-000000000000');
insert into shared_reports (workspace_id, data) values ('11111111-0000-0000-0000-000000000000', '{"name":"acme-report"}');
insert into report_styles (workspace_id, style) values ('11111111-0000-0000-0000-000000000000', '{}');
insert into notification_prefs (workspace_id, user_id) values ('11111111-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000000');
insert into workspace_invites (workspace_id, email, role) values ('11111111-0000-0000-0000-000000000000', 'new@acme.com', 'editor');
insert into usage (workspace_id, day) values ('11111111-0000-0000-0000-000000000000', current_date);
insert into usage_counters (workspace_id, metric, period) values ('11111111-0000-0000-0000-000000000000', 'answers', '2026-10');
insert into ask_threads (id, workspace_id) values ('a1000000-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000000');
insert into ask_messages (thread_id, workspace_id, role, content) values ('a1000000-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000000', 'user', '"acme-question"');
insert into ask_projects (workspace_id, name) values ('11111111-0000-0000-0000-000000000000', 'acme-project');
insert into ask_knowledge (workspace_id, kind, name, content) values ('11111111-0000-0000-0000-000000000000', 'note', 'acme-note', 'acme-secret-plan');
insert into ask_skills (workspace_id) values ('11111111-0000-0000-0000-000000000000');
insert into site_audits (workspace_id, domain) values ('11111111-0000-0000-0000-000000000000', 'acme.com');
insert into bulk_runs (id, workspace_id, kind, country, count, items, result) values ('acme-bulk', '11111111-0000-0000-0000-000000000000', 'keywords', 'us', 1, '[]', '{}');
insert into task_purchases (id, workspace_id, tasks, amount) values ('acme-pack', '11111111-0000-0000-0000-000000000000', 10, 100);
insert into change_sets (id, workspace_id, play, title) values ('c5000000-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000000', 'alt', 'acme-changes');
insert into changes (change_set_id, workspace_id, target_type, target_id, field, after) values ('c5000000-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000000', 'post', '1', 'alt', '"x"');
-- Server-only tables: secrets, the queue, billing and logs. Nobody signed in may read these.
insert into cms_connections (workspace_id, kind, name, config) values ('11111111-0000-0000-0000-000000000000', 'wordpress', 'acme-blog', '{"password":"wp-secret"}');
insert into gsc_connections (site_id, workspace_id, refresh_token) values ('51000000-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000000', 'gsc-secret');
insert into ga4_connections (brand_id, workspace_id, refresh_token) values ('b1000000-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000000', 'ga4-secret');
insert into api_keys (workspace_id, name, prefix, hash) values ('11111111-0000-0000-0000-000000000000', 'acme-key', 'arw_x', 'hash-secret');
insert into integrations (workspace_id, slack_webhook) values ('11111111-0000-0000-0000-000000000000', 'https://hooks.slack.com/services/secret');
insert into webhooks (workspace_id, url, event) values ('11111111-0000-0000-0000-000000000000', 'https://hooks.zapier.com/secret', '*');
insert into jobs (kind, workspace_id, payload) values ('check', '11111111-0000-0000-0000-000000000000', '{}');
insert into cost_ledger (workspace_id, action, cost) values ('11111111-0000-0000-0000-000000000000', 'check', 1);
insert into email_log (workspace_id, kind, period) values ('11111111-0000-0000-0000-000000000000', 'weekly', '2026-10');
insert into oauth_clients (id, name, redirect_uris) values ('client-1', 'acme-client', '{https://x.example}');
insert into oauth_codes (hash, client_id, redirect_uri, code_challenge, workspace_id, user_id, expires_at) values ('code-secret', 'client-1', 'https://x.example', 'c', '11111111-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000000', now() + interval '1 minute');
insert into stripe_events (id, type) values ('evt_1', 'invoice.paid');
insert into keyword_cache (key, data) values ('acme-kw', '{}');
insert into shared_answers (engine, prompt_key, day, answer) values ('chatgpt', 'k', current_date, '{}');
insert into rate_buckets (key, minute) values ('anthropic', date_trunc('minute', now()));

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'LEAK TEST FAILED: %', what; end if;
end $$;
create function pg_temp.fails(sql text, what text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'LEAK TEST FAILED: % (it worked)', what;
exception when others then
  if sqlerrm like 'LEAK TEST FAILED%' then raise; end if;
end $$;
create function pg_temp.as_user(uid text, email text default '') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  perform set_config('request.jwt.claim.email', email, false);
end $$;
-- How many rows of each workspace table the current person can read for a workspace, by table.
create function pg_temp.visible(ws uuid) returns table (tbl text, n bigint) language plpgsql as $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c join pg_tables p on p.tablename = c.table_name and p.schemaname = 'public'
    where c.table_schema = 'public' and c.column_name = 'workspace_id' order by 1
  loop
    begin
      execute format('select count(*) from public.%I where workspace_id = $1', t) using ws into n;
    exception when insufficient_privilege then
      n := 0;
    end;
    tbl := t;
    return next;
  end loop;
end $$;
grant execute on function pg_temp.visible(uuid) to anon, authenticated;
-- Tables only the server reads. The app's signed-in users and visitors must see nothing in them.
create temp table server_only (tbl text);
insert into server_only values ('cms_connections'), ('gsc_connections'), ('ga4_connections'), ('api_keys'), ('integrations'), ('webhooks'), ('jobs'),
  ('cost_ledger'), ('email_log'), ('oauth_codes'), ('oauth_clients'), ('stripe_events'), ('keyword_cache'), ('shared_answers'), ('rate_buckets'), ('snapshots');
grant select on server_only to anon, authenticated;
create function pg_temp.server_rows() returns table (tbl text, n bigint) language plpgsql as $$
declare t text;
begin
  for t in select s.tbl from server_only s loop
    begin
      execute format('select count(*) from public.%I', t) into n;
    exception when insufficient_privilege then
      n := 0;
    end;
    tbl := t;
    return next;
  end loop;
end $$;
grant execute on function pg_temp.server_rows() to anon, authenticated;

-- Nobody signed in ------------------------------------------------------------------------------
select pg_temp.as_user('');
set role anon;
select pg_temp.check(not exists (select 1 from pg_temp.visible('11111111-0000-0000-0000-000000000000') where n > 0),
  'A visitor reads Acme data: ' || (select string_agg(tbl, ', ') from pg_temp.visible('11111111-0000-0000-0000-000000000000') where n > 0));
select pg_temp.check(not exists (select 1 from pg_temp.server_rows() where n > 0), 'A visitor reads a server-only table: ' || (select string_agg(tbl, ', ') from pg_temp.server_rows() where n > 0));
select pg_temp.check((select count(*) from workspaces) = 0, 'A visitor lists workspaces');
select pg_temp.fails($$select take_answer('11111111-0000-0000-0000-000000000000')$$, 'A visitor spends Acme''s answers');
reset role;

-- Cat (owner of another workspace) -----------------------------------------------------------------
select pg_temp.as_user('c0000000-0000-0000-0000-000000000000', 'cat@other.com');
set role authenticated;
select pg_temp.check(not exists (select 1 from pg_temp.visible('11111111-0000-0000-0000-000000000000') where n > 0),
  'Cat reads Acme data in: ' || (select string_agg(tbl, ', ') from pg_temp.visible('11111111-0000-0000-0000-000000000000') where n > 0));
select pg_temp.check(not exists (select 1 from pg_temp.server_rows() where n > 0), 'Cat reads a server-only table: ' || (select string_agg(tbl, ', ') from pg_temp.server_rows() where n > 0));
select pg_temp.check((select count(*) from workspaces) = 1, 'Cat sees another workspace');
select pg_temp.check(not exists (select 1 from profiles where id <> auth.uid()), 'Cat reads profiles of people outside her workspace');
select pg_temp.check(not has_role('11111111-0000-0000-0000-000000000000', 'viewer'), 'Cat has a role at Acme');
select pg_temp.fails($$select take_answer('11111111-0000-0000-0000-000000000000')$$, 'Cat spends Acme''s answers');
select pg_temp.fails($$insert into brands (workspace_id, url, domain, name) values ('11111111-0000-0000-0000-000000000000', 'https://x.com', 'x.com', 'x')$$, 'Cat adds a brand to Acme');
select pg_temp.fails($$insert into workspace_members (workspace_id, user_id, email, role) values ('11111111-0000-0000-0000-000000000000', auth.uid(), 'cat@other.com', 'owner')$$, 'Cat makes herself an Acme owner');
select pg_temp.fails($$insert into workspace_invites (workspace_id, email, role) values ('11111111-0000-0000-0000-000000000000', 'cat2@other.com', 'admin')$$, 'Cat invites people to Acme');
select pg_temp.fails($$insert into runs (workspace_id, brand_id) values ('22222222-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000')$$, 'Cat runs a check on Acme''s brand from her own workspace');
select pg_temp.fails($$select accept_invite((select token from workspace_invites limit 1))$$, 'Cat accepts an invite meant for someone else');
update workspaces set name = 'hacked' where id = '11111111-0000-0000-0000-000000000000';
delete from brands where workspace_id = '11111111-0000-0000-0000-000000000000';
update sites set name = 'hacked' where workspace_id = '11111111-0000-0000-0000-000000000000';
reset role;
select pg_temp.check((select name from workspaces where id = '11111111-0000-0000-0000-000000000000') = 'Acme', 'Cat renamed Acme');
select pg_temp.check(exists (select 1 from brands where name = 'acme-brand'), 'Cat deleted an Acme brand');
select pg_temp.check(exists (select 1 from sites where name = 'acme-site'), 'Cat changed an Acme site');

-- Vi (viewer at Acme) -----------------------------------------------------------------------------
select pg_temp.as_user('b0000000-0000-0000-0000-000000000000', 'vi@acme.com');
set role authenticated;
select pg_temp.check((select n from pg_temp.visible('11111111-0000-0000-0000-000000000000') where tbl = 'brands') = 1, 'Vi can''t read her own workspace''s brands');
select pg_temp.check(not exists (select 1 from pg_temp.visible('22222222-0000-0000-0000-000000000000') where n > 0), 'Vi reads Other''s data');
select pg_temp.check(not exists (select 1 from pg_temp.server_rows() where n > 0), 'Vi reads a server-only table: ' || (select string_agg(tbl, ', ') from pg_temp.server_rows() where n > 0));
select pg_temp.check(not exists (select 1 from workspace_invites), 'Vi (a viewer) reads invites and their links');
select pg_temp.fails($$insert into brands (workspace_id, url, domain, name) values ('11111111-0000-0000-0000-000000000000', 'https://x.com', 'x.com', 'vi-brand')$$, 'Vi (a viewer) adds a brand');
select pg_temp.fails($$select take_answer('11111111-0000-0000-0000-000000000000')$$, 'Vi (a viewer) spends AI answers');
select pg_temp.fails($$insert into workspace_members (workspace_id, user_id, email, role) values ('11111111-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-000000000000', 'cat@other.com', 'admin')$$, 'Vi (a viewer) adds a member');
update workspace_members set role = 'owner' where user_id = auth.uid();
delete from brands;
update workspaces set name = 'vi-was-here';
reset role;
select pg_temp.check((select role from workspace_members where user_id = 'b0000000-0000-0000-0000-000000000000') = 'viewer', 'Vi made herself an owner');
select pg_temp.check(exists (select 1 from brands where name = 'acme-brand'), 'Vi (a viewer) deleted a brand');
select pg_temp.check((select name from workspaces where id = '11111111-0000-0000-0000-000000000000') = 'Acme', 'Vi (a viewer) renamed the workspace');

-- Ed (editor at Acme) -----------------------------------------------------------------------------
select pg_temp.as_user('e0000000-0000-0000-0000-000000000000', 'ed@acme.com');
set role authenticated;
select pg_temp.check(not exists (select 1 from pg_temp.server_rows() where n > 0), 'Ed reads a server-only table: ' || (select string_agg(tbl, ', ') from pg_temp.server_rows() where n > 0));
select pg_temp.fails($$insert into workspace_members (workspace_id, user_id, email, role) values ('11111111-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-000000000000', 'cat@other.com', 'viewer')$$, 'Ed (an editor) adds a member');
update workspace_members set role = 'owner' where user_id = auth.uid();
delete from workspaces where id = '11111111-0000-0000-0000-000000000000';
reset role;
select pg_temp.check((select role from workspace_members where user_id = 'e0000000-0000-0000-0000-000000000000') = 'editor', 'Ed made himself an owner');
select pg_temp.check(exists (select 1 from workspaces where id = '11111111-0000-0000-0000-000000000000'), 'Ed (an editor) deleted the workspace');

-- Ann (owner of Acme) -----------------------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-000000000000', 'ann@acme.com');
set role authenticated;
select pg_temp.check((select count(*) from workspaces) = 1, 'Ann can''t see Acme, or sees Other');
select pg_temp.check(not exists (select 1 from pg_temp.visible('22222222-0000-0000-0000-000000000000') where n > 0), 'Ann reads Other''s data');
select pg_temp.check(not exists (select 1 from pg_temp.server_rows() where n > 0), 'Ann (an owner) reads a server-only table: ' || (select string_agg(tbl, ', ') from pg_temp.server_rows() where n > 0));
select pg_temp.check(exists (select 1 from workspace_invites), 'Ann (an owner) can''t see her invites');
select pg_temp.fails($$select add_usage('11111111-0000-0000-0000-000000000000', 'answers', '2026-10', -100)$$, 'Ann resets her own usage');
select pg_temp.fails($$select apply_plan('11111111-0000-0000-0000-000000000000', 'scale', 'active', 999, 999, 999, '{}', now() + interval '1 year', null)$$, 'Ann gives herself a paid plan');
select pg_temp.fails($$select * from claim_jobs('x', 10, 60, null)$$, 'Ann claims queued jobs');
select pg_temp.fails($$select take_rate('anthropic', 999999, -1000)$$, 'Ann changes the shared rate limits');
reset role;

\o
\pset tuples_only on
select 'All leak tests passed';
