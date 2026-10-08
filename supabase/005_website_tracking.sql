-- Website analytics with Umami. Run this once in Supabase → SQL Editor, after 004_topics_and_profile.sql.
-- umami_website_id: the brand's website in Umami. site_platform: how the site is built (wordpress, shopify ...).
-- install_token: the private link a user can send to their web person to install the snippet.
alter table public.brands
  add column umami_website_id text,
  add column site_platform text,
  add column install_token text unique;
