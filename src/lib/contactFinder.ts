import "server-only";
import { resolveMx } from "node:dns/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bestEmail, contactLinks, rssOwnerEmail, sameShow, type Found, type TargetKind } from "./contacts";
import { finish, type Job } from "./jobs";
import { normalizeSite } from "./site";

// The contact job: find a public email for one outreach target and save it.
// Websites and press: the homepage plus its contact, about and "write for us" pages.
// Podcasts: the owner email in the show's RSS feed, found through Apple's free podcast search.
// YouTube channels and social accounts publish no reliable email, so people add those by hand.

const UA = "Mozilla/5.0 (compatible; ArrowsterrBot/1.0; +https://arrowsterr.com)";
const GUESSES = ["/contact", "/contact-us", "/about", "/about-us", "/write-for-us", "/advertise"];

/** A page's HTML, or "" when it can't be read. Only public sites, and the redirect must stay public too. */
async function page(url: string, accept = "text/html,*/*"): Promise<string> {
  if (!normalizeSite(url)) return "";
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: accept }, redirect: "follow", signal: AbortSignal.timeout(12_000) });
    if (!res.ok || !normalizeSite(res.url || url)) return "";
    return (await res.text()).slice(0, 1_500_000);
  } catch {
    return "";
  }
}

/** True when the address's domain can receive mail. */
async function takesMail(email: string): Promise<boolean> {
  try {
    const mx = await resolveMx(email.split("@")[1]);
    return mx.length > 0;
  } catch {
    return false;
  }
}

async function forSite(url: string): Promise<Found | null> {
  const site = normalizeSite(url);
  if (!site) return null;
  const home = await page(url.startsWith("http") ? url : site.url);
  const pages = [{ html: home, contact: false }];
  const links = [...new Set([...contactLinks(home, site.url), ...GUESSES.map((p) => site.url + p)])].slice(0, 6);
  for (const link of links) {
    const html = await page(link);
    if (html) pages.push({ html, contact: /contact|write|contribut|advertis|partner|press|submit|pitch/i.test(link) });
    const hit = bestEmail(pages, site.domain);
    if (hit && hit.source === "contact_page") break; // a contact page answer is as good as it gets
  }
  return bestEmail(pages, site.domain);
}

async function forPodcast(name: string): Promise<Found | null> {
  try {
    const res = await fetch(`https://itunes.apple.com/search?media=podcast&limit=5&term=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(12_000) });
    const data = (await res.json()) as { results?: { collectionName?: string; feedUrl?: string }[] };
    const show = (data.results ?? []).find((r) => r.feedUrl && r.collectionName && sameShow(r.collectionName, name));
    if (!show?.feedUrl) return null;
    const email = rssOwnerEmail(await page(show.feedUrl, "application/rss+xml,application/xml,text/xml,*/*"));
    return email ? { email, source: "rss" } : null;
  } catch {
    return null;
  }
}

type Target = { id: string; kind: TargetKind; name: string; url: string | null; email_status: string };

/** Find and save one target's email. Never overwrites an address someone typed in. */
export async function contact(db: SupabaseClient, job: Job) {
  const { targetId } = job.payload as { targetId: string };
  const { data } = await db.from("outreach_targets").select("id, kind, name, url, email_status").eq("id", targetId).maybeSingle();
  const t = data as Target | null;
  if (!t || t.email_status === "manual") return finish(job.id);

  let found: Found | null = null;
  if (t.kind === "website" || t.kind === "press") found = t.url ? await forSite(t.url) : null;
  else if (t.kind === "podcast") found = await forPodcast(t.name);
  if (found && !(await takesMail(found.email))) found = null;

  const { error } = await db
    .from("outreach_targets")
    .update(found ? { email: found.email, email_source: found.source, email_status: "found", updated_at: new Date().toISOString() } : { email_status: "not_found", updated_at: new Date().toISOString() })
    .eq("id", t.id)
    .neq("email_status", "manual");
  if (error) throw new Error(error.message);
  await finish(job.id);
}
