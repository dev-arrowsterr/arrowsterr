import "server-only";
import * as cheerio from "cheerio";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findPages } from "./sitemap";

// The site audit: crawl a website the way a search engine or AI crawler does, then list what to fix.
// Runs as a background job (worker kind "audit"). Results land in site_audits.result.

export const MAX_PAGES = 200;
const UA = "Mozilla/5.0 (compatible; ArrowsterrBot/1.0; +https://arrowsterr.com/)";
const TIMEOUT = 15_000;

/** AI crawlers worth letting in. Blocking them keeps a site out of AI answers. */
export const AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended"];

export type AuditPage = {
  url: string;
  status: number;
  ms: number;
  final?: string;
  title?: string;
  description?: string;
  h1: number;
  canonical?: string;
  noindex?: boolean;
  words: number;
  images: number;
  noAlt: number;
  schema: string[];
  ogImage: boolean;
  links: number;
};

export type Severity = "high" | "medium" | "low";
export type AuditIssue = { id: string; severity: Severity; title: string; why: string; count: number; pages: string[]; play?: string };
export type AuditResult = {
  pages: AuditPage[];
  issues: AuditIssue[];
  found: number;
  sitemap: string | null;
  blockedBots: string[];
  llmsTxt: boolean;
  brokenLinks: { url: string; status: number; from: string }[];
};

async function get(url: string, method: "GET" | "HEAD" = "GET") {
  const t = Date.now();
  try {
    const res = await fetch(url, { method, headers: { "User-Agent": UA, Accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT) });
    const type = res.headers.get("content-type") ?? "";
    const body = method === "GET" && /html|text\/plain/.test(type) ? (await res.text()).slice(0, 2_000_000) : "";
    return { status: res.status, url: res.url, body, ms: Date.now() - t, robots: res.headers.get("x-robots-tag") ?? "", type };
  } catch {
    return { status: 0, url, body: "", ms: Date.now() - t, robots: "", type: "" };
  }
}

const norm = (u: string) => {
  try {
    const x = new URL(u);
    x.hash = "";
    return x.toString().replace(/\/$/, "");
  } catch {
    return u;
  }
};

/** Which AI crawlers robots.txt shuts out of the whole site. */
export function blockedBots(robots: string): string[] {
  const groups: { agents: string[]; rules: string[] }[] = [];
  let cur: { agents: string[]; rules: string[] } | null = null;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || cur.rules.length) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(val.toLowerCase());
    } else if (cur && (key === "disallow" || key === "allow")) cur.rules.push(`${key}:${val}`);
  }
  const shut = (agent: string) => {
    const own = groups.find((g) => g.agents.includes(agent.toLowerCase()));
    const g = own ?? groups.find((x) => x.agents.includes("*"));
    if (!g) return false;
    return g.rules.includes("disallow:/") && !g.rules.some((r) => r === "allow:/");
  };
  return AI_BOTS.filter(shut);
}

/** Read one page's SEO and AI-readiness signals. */
export function readPage(url: string, html: string, status: number, ms: number, final: string, robotsHeader: string): AuditPage & { hrefs: string[] } {
  const $ = cheerio.load(html);
  const host = new URL(url).hostname.replace(/^www\./, "");
  const schema: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      const walk = (n: unknown) => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (n && typeof n === "object") {
          const o = n as Record<string, unknown>;
          if (o["@type"]) schema.push(...[o["@type"]].flat().map(String));
          if (o["@graph"]) walk(o["@graph"]);
        }
      };
      walk(data);
    } catch {
      /* broken JSON-LD counts as none */
    }
  });
  const hrefs: string[] = [];
  $("a[href]").each((_, a) => {
    const h = $(a).attr("href") ?? "";
    if (/^(mailto|tel|javascript):|^#/.test(h)) return;
    try {
      const abs = new URL(h, final || url);
      if (abs.hostname.replace(/^www\./, "") === host && /^https?:$/.test(abs.protocol)) hrefs.push(norm(abs.toString()));
    } catch {
      /* not a link */
    }
  });
  const imgs = $("img");
  let noAlt = 0;
  imgs.each((_, i) => {
    if ($(i).attr("alt") === undefined) noAlt++;
  });
  $("script, style, noscript, nav, footer, header").remove();
  const words = $("body").text().split(/\s+/).filter(Boolean).length;
  const robotsMeta = ($('meta[name="robots"]').attr("content") ?? "") + " " + robotsHeader;
  const canon = $('link[rel="canonical"]').attr("href");
  return {
    url,
    status,
    ms,
    ...(final && norm(final) !== norm(url) ? { final } : {}),
    title: $("title").first().text().trim() || undefined,
    description: $('meta[name="description"]').attr("content")?.trim() || undefined,
    h1: $("h1").length,
    ...(canon ? { canonical: new URL(canon, url).toString() } : {}),
    ...(/noindex/i.test(robotsMeta) ? { noindex: true } : {}),
    words,
    images: imgs.length,
    noAlt,
    schema: [...new Set(schema)],
    ogImage: Boolean($('meta[property="og:image"]').attr("content")),
    links: new Set(hrefs).size,
    hrefs: [...new Set(hrefs)],
  };
}

/** Run a few at a time. */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

/** Turn the crawled pages into a ranked list of issues. */
export function issuesOf(pages: AuditPage[], site: { blockedBots: string[]; llmsTxt: boolean; brokenLinks: AuditResult["brokenLinks"] }): AuditIssue[] {
  const ok = pages.filter((p) => p.status >= 200 && p.status < 300);
  const list = (f: (p: AuditPage) => boolean) => ok.filter(f).map((p) => p.url);
  const dupes = (key: (p: AuditPage) => string | undefined) => {
    const seen = new Map<string, string[]>();
    for (const p of ok) {
      const k = key(p)?.toLowerCase();
      if (k) seen.set(k, [...(seen.get(k) ?? []), p.url]);
    }
    return [...seen.values()].filter((v) => v.length > 1).flat();
  };
  const out: AuditIssue[] = [];
  const add = (id: string, severity: Severity, title: string, why: string, pagesHit: string[], play?: string) => {
    if (pagesHit.length) out.push({ id, severity, title, why, count: pagesHit.length, pages: pagesHit.slice(0, 50), ...(play ? { play } : {}) });
  };
  if (site.blockedBots.length) out.push({ id: "ai_bots_blocked", severity: "high", title: `robots.txt blocks ${site.blockedBots.join(", ")}`, why: "These AI crawlers can't read your site, so their answers can't cite it.", count: site.blockedBots.length, pages: [] });
  add("broken_pages", "high", "Pages that return an error", "Search engines and AI crawlers drop pages that fail to load.", pages.filter((p) => p.status === 0 || p.status >= 400).map((p) => p.url));
  if (site.brokenLinks.length) out.push({ id: "broken_links", severity: "high", title: "Links to pages that don't exist", why: "Broken links waste crawl time and send readers to dead ends.", count: site.brokenLinks.length, pages: [...new Set(site.brokenLinks.map((b) => b.from))].slice(0, 50) });
  add("missing_title", "high", "Pages without a title", "The title is the first thing Google and AI read about a page.", list((p) => !p.title));
  add("missing_description", "medium", "Pages without a meta description", "Search results and AI tools fall back to random text from the page.", list((p) => !p.description), "meta");
  add("missing_alt", "medium", "Images without alt text", "Alt text tells Google Images, screen readers and AI tools what an image shows.", list((p) => p.noAlt > 0), "alt");
  add("no_schema", "medium", "Pages without structured data", "Schema helps Google and AI tools understand what a page is and who wrote it.", list((p) => !p.schema.length), "schema");
  add("missing_h1", "medium", "Pages without a main heading (H1)", "The H1 tells readers and crawlers what the page is about.", list((p) => p.h1 === 0));
  add("duplicate_title", "medium", "Pages that share a title", "Pages with the same title compete with each other.", dupes((p) => p.title));
  add("noindex", "medium", "Pages hidden from search (noindex)", "These pages can't show up on Google. Check that this is on purpose.", list((p) => Boolean(p.noindex)));
  add("long_title", "low", "Titles longer than 60 characters", "Long titles get cut off in search results.", list((p) => (p.title?.length ?? 0) > 60), "meta");
  add("long_description", "low", "Meta descriptions longer than 160 characters", "Long descriptions get cut off in search results.", list((p) => (p.description?.length ?? 0) > 160), "meta");
  add("duplicate_description", "low", "Pages that share a meta description", "Each page should describe itself.", dupes((p) => p.description), "meta");
  add("no_share_image", "low", "Pages without a share image", "Without og:image, links shared on LinkedIn or Slack show no picture.", list((p) => !p.ogImage));
  add("multiple_h1", "low", "Pages with more than one H1", "One main heading per page is clearer for crawlers.", list((p) => p.h1 > 1));
  add("canonical_elsewhere", "low", "Pages that point their canonical to another URL", "Google may index the other URL instead. Check that this is on purpose.", list((p) => Boolean(p.canonical && norm(p.canonical) !== norm(p.final ?? p.url))));
  add("thin", "low", "Pages with under 300 words", "Thin pages rarely rank or get cited.", list((p) => p.words < 300));
  add("slow", "low", "Pages slower than 3 seconds to respond", "Slow pages get crawled less and lose readers.", list((p) => p.ms > 3000));
  if (!site.llmsTxt) out.push({ id: "no_llms_txt", severity: "low", title: "No llms.txt file", why: "llms.txt gives AI tools a short map of your most useful pages. It's new and optional, but cheap to add.", count: 1, pages: [] });
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count);
}

/** 0 to 100: the share of pages each issue hits, weighted by how much it matters. */
export function scoreOf(issues: AuditIssue[], pages: number) {
  const w = { high: 15, medium: 7, low: 2 };
  const siteWide = new Set(["ai_bots_blocked", "no_llms_txt", "broken_links"]);
  const penalty = issues.reduce((n, i) => n + w[i.severity] * (siteWide.has(i.id) ? 1 : Math.min(1, i.count / Math.max(1, pages))), 0);
  return Math.max(0, Math.round(100 - penalty));
}

/** Crawl the site and save the audit. */
export async function runAudit(db: SupabaseClient, auditId: string, domain: string) {
  const step = (s: string, extra: Record<string, unknown> = {}) => db.from("site_audits").update({ step: s, ...extra }).eq("id", auditId);
  try {
    await step("Finding your pages");
    const base = `https://${domain}`;
    const [{ source, pages: listed }, robots, llms] = await Promise.all([findPages(domain), get(`${base}/robots.txt`), get(`${base}/llms.txt`)]);
    const urls = [...new Set([base, ...listed.map((p) => p.url)].map(norm))].slice(0, MAX_PAGES);
    const pages: (AuditPage & { hrefs: string[] })[] = [];
    let done = 0;
    await pool(urls, 6, async (url) => {
      const r = await get(url);
      pages.push(r.body ? readPage(url, r.body, r.status, r.ms, r.url, r.robots) : { url, status: r.status, ms: r.ms, h1: 0, words: 0, images: 0, noAlt: 0, schema: [], ogImage: false, links: 0, hrefs: [] });
      if (++done % 10 === 0) await step(`Reading pages: ${done} of ${urls.length}`, { pages: done });
    });

    await step("Checking links");
    const crawled = new Set(pages.flatMap((p) => [norm(p.url), ...(p.final ? [norm(p.final)] : [])]));
    const from = new Map<string, string>();
    for (const p of pages) for (const h of p.hrefs) if (!crawled.has(h) && !from.has(h) && !/\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4)$/i.test(h)) from.set(h, p.url);
    const brokenLinks: AuditResult["brokenLinks"] = [];
    await pool([...from.keys()].slice(0, 120), 6, async (u) => {
      let r = await get(u, "HEAD");
      if (r.status === 405 || r.status === 0) r = await get(u);
      if (r.status >= 400) brokenLinks.push({ url: u, status: r.status, from: from.get(u)! });
    });
    for (const p of pages) if (p.status >= 400 || p.status === 0) for (const q of pages) if (q.hrefs.includes(norm(p.url))) brokenLinks.push({ url: p.url, status: p.status, from: q.url });

    const site = { blockedBots: robots.status === 200 ? blockedBots(robots.body) : [], llmsTxt: llms.status === 200 && llms.body.length > 20 && !/<html/i.test(llms.body), brokenLinks: brokenLinks.slice(0, 200) };
    const clean: AuditPage[] = pages.map(({ hrefs, ...p }) => (void hrefs, p)).sort((a, b) => a.url.localeCompare(b.url));
    const issues = issuesOf(clean, site);
    const result: AuditResult = { pages: clean, issues, found: listed.length, sitemap: source, ...site };
    await db.from("site_audits").update({ status: "done", step: "Done", pages: clean.length, score: scoreOf(issues, clean.length), result, finished_at: new Date().toISOString() }).eq("id", auditId);
  } catch (e) {
    await db.from("site_audits").update({ status: "failed", error: e instanceof Error ? e.message : String(e), finished_at: new Date().toISOString() }).eq("id", auditId);
  }
}
