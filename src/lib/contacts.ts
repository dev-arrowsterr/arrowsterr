// Finding a public contact email for an outreach target. Shared by the server and the tests.
// Rules: only addresses a site or feed publishes itself, never guessed ones. A wrong address costs
// more than a missing one, so anything doubtful is left out.

export type TargetKind = "website" | "press" | "podcast" | "youtube" | "social";
export type Found = { email: string; source: "contact_page" | "site" | "rss" };

const EMAIL = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi;
// Addresses that are never a real inbox for a pitch: tooling, placeholders and file names that look like emails.
const JUNK_DOMAIN = /(^|\.)(example\.(com|org|net)|domain\.com|email\.com|yourdomain\.com|yoursite\.com|sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|godaddy\.com|cloudflare\.com|w3\.org|schema\.org|gravatar\.com)$/i;
const JUNK_LOCAL = /^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|abuse|privacy|legal|dmca|security|unsubscribe|bounce|billing|invoices?|careers|jobs|hr|recruiting|name|your\.?name|user|username|email|test)$/i;
const FILE_TAIL = /\.(png|jpe?g|gif|webp|svg|avif|css|js)$/i;

/** Better inboxes for a pitch come first. */
const RANK: [RegExp, number][] = [
  [/^(editor|editors|editorial|submissions?|pitch|pitches|tips|news|newsroom|stories)$/i, 1],
  [/^(partners?|partnerships?|collab|collaborations?|sponsor|sponsorships?|advertis(e|ing)|ads|media|press|pr)$/i, 2],
  [/^(booking|bookings|guests?|show|podcast|hosts?)$/i, 2],
  [/^(hello|hi|hey|contact|team|info|general|office|mail|inquiries|enquiries)$/i, 3],
  [/^(support|help|sales|customers?|service)$/i, 5],
];
const rankOf = (local: string) => RANK.find(([re]) => re.test(local))?.[1] ?? 4; // a person's own address sits between

/** Cloudflare hides emails on many sites as a hex string. This turns it back into the address. */
export function decodeCfEmail(hex: string): string {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4 || hex.length % 2) return "";
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

const bare = (d: string) => d.toLowerCase().replace(/^www\./, "");
/** True when the address belongs to the site: the same domain, a subdomain, or the site's parent domain. */
export function sameSite(email: string, siteDomain: string): boolean {
  const e = bare(email.split("@")[1] ?? "");
  const s = bare(siteDomain);
  return Boolean(e && s) && (e === s || e.endsWith(`.${s}`) || s.endsWith(`.${e}`));
}

/** Every address a page publishes: mailto links, Cloudflare-protected ones and plain text. Lower case, no repeats, junk removed. */
export function emailsInHtml(html: string): string[] {
  const found: string[] = [];
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) found.push(decodeURIComponent(m[1]));
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) found.push(decodeCfEmail(m[1]));
  for (const m of html.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi)) found.push(decodeCfEmail(m[1]));
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#64;|&#x40;|\s\[at\]\s|\s\(at\)\s/gi, "@").replace(/\s\[dot\]\s|\s\(dot\)\s/gi, ".");
  for (const m of text.matchAll(EMAIL)) found.push(m[0]);
  const seen = new Set<string>();
  return found
    .map((e) => e.trim().toLowerCase().replace(/[.,;:]+$/, ""))
    .filter((e) => {
      const [local, domain] = e.split("@");
      if (!local || !domain || seen.has(e)) return false;
      seen.add(e);
      return new RegExp(`^${EMAIL.source}$`, "i").test(e) && !FILE_TAIL.test(e) && !JUNK_DOMAIN.test(domain) && !JUNK_LOCAL.test(local);
    });
}

/**
 * The best address for a site from what its pages publish. Only the site's own domain counts,
 * except on its contact page, where a personal mailbox (a writer's Gmail) is accepted too.
 */
export function bestEmail(pages: { html: string; contact: boolean }[], siteDomain: string): Found | null {
  const picks: { email: string; contact: boolean; rank: number }[] = [];
  for (const p of pages)
    for (const email of emailsInHtml(p.html)) {
      const own = sameSite(email, siteDomain);
      if (!own && !p.contact) continue;
      picks.push({ email, contact: p.contact, rank: rankOf(email.split("@")[0]) + (own ? 0 : 3) });
    }
  picks.sort((a, b) => a.rank - b.rank || Number(b.contact) - Number(a.contact) || a.email.localeCompare(b.email));
  const top = picks[0];
  return top ? { email: top.email, source: top.contact ? "contact_page" : "site" } : null;
}

/** Links on a page that likely lead to a way to get in touch, on the same site. */
export function contactLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  let host = "";
  try {
    host = bare(new URL(base).hostname);
  } catch {
    return [];
  }
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = m[2].replace(/<[^>]+>/g, " ").trim();
    if (!/contact|about|write for us|write-for-us|contribut|advertis|partner|press|media kit|submit|pitch/i.test(`${m[1]} ${label}`)) continue;
    try {
      const u = new URL(m[1], base);
      if (/^https?:$/.test(u.protocol) && bare(u.hostname) === host) out.add(u.toString().split("#")[0]);
    } catch {}
  }
  return [...out].slice(0, 6);
}

/** The owner email a podcast's RSS feed lists for Apple Podcasts, or its managing editor. */
export function rssOwnerEmail(xml: string): string | null {
  const owner = xml.match(/<itunes:owner>[\s\S]*?<itunes:email>\s*([^<\s]+)\s*<\/itunes:email>/i)?.[1];
  const editor = xml.match(/<managingEditor>\s*([^<\s(]+)/i)?.[1];
  for (const raw of [owner, editor]) {
    const e = emailsInHtml(raw ?? "")[0];
    if (e) return e;
  }
  return null;
}

/** Loose name match for podcast search results: "The Growth Show" matches "Growth Show Podcast". */
export function sameShow(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/\b(the|podcast|show)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // One name inside the other counts only when it is most of the longer name.
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 6 && long.includes(short) && short.length / long.length >= 0.6;
}

/** The newest episodes in a podcast feed: titles and a short summary each, for writing a personal pitch. */
export function rssEpisodes(xml: string, max = 3): { title: string; summary: string }[] {
  const clean = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].slice(0, max).map((m) => ({
    title: clean(m[0].match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? ""),
    summary: clean(m[0].match(/<(?:itunes:summary|description)>([\s\S]*?)<\/(?:itunes:summary|description)>/i)?.[1] ?? "").slice(0, 300),
  })).filter((e) => e.title);
}
