import "server-only";
import * as cheerio from "cheerio";
import { answerReady, buildLlmsTxt, robotsFix, robotsVerdicts, speedSummary, titleFromUrl, type LlmsPage } from "./freeChecks";
import { pageFacts } from "./pageFacts";
import { safeFetch, UA } from "./safeFetch";

// The free tools' work (docs/free-tools.md). Every address a visitor types goes through safeFetch.
// None of these call a paid service, so each run costs $0.

const pool = async <T,>(items: T[], n: number, fn: (item: T) => Promise<void>) => {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
};

const bad = (message: string) => Object.assign(new Error(message), { visitor: true });

/** A visitor-facing reason a site couldn't be opened. */
function unreachable(host: string, error?: string) {
  if (/private network/.test(error ?? "")) return bad("That address points to a private network, so it can't be checked.");
  if (/too long/.test(error ?? "")) return bad(`${host} took too long to answer. Try again in a minute.`);
  if (/doesn't exist/.test(error ?? "")) return bad(`${host} doesn't exist. Check the spelling.`);
  return bad(`${host} couldn't be reached. Check the address and try again.`);
}

/** Open a page the visitor typed. When https can't connect, try http once. */
async function reach(url: string, opts: Parameters<typeof safeFetch>[1] = {}) {
  let r = await safeFetch(url, opts);
  if (r.status === 0 && url.startsWith("https://") && !/private network|doesn't exist/.test(r.error ?? "")) {
    const plain = await safeFetch(`http://${url.slice(8)}`, opts);
    if (plain.status > 0) r = plain;
  }
  if (r.status === 0) throw unreachable(new URL(url).hostname, r.error);
  return r;
}

/** The site's own address: https, then http, with or without www. Throws a visitor-facing error when none answer. */
async function home(domain: string) {
  for (const base of [`https://${domain}/`, `https://www.${domain}/`, `http://${domain}/`]) {
    const r = await safeFetch(base, { timeout: 12_000 });
    if (r.status > 0) return r;
  }
  throw unreachable(domain);
}

async function robotsOf(origin: string) {
  const r = await safeFetch(`${origin}/robots.txt`, { accept: "text/plain,*/*", timeout: 10_000, maxBytes: 500_000 });
  const isText = r.ok && !/<html[\s>]/i.test(r.body.slice(0, 500));
  return { found: isText, url: `${origin}/robots.txt`, text: isText ? r.body : null, status: r.status };
}

// ─────────────── AI Crawler Checker ───────────────

const BOT_UA: Record<string, string> = {
  GPTBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
  ClaudeBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  PerplexityBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
};

export async function crawlers(domain: string) {
  const page = await home(domain);
  const origin = new URL(page.url).origin;
  const robots = await robotsOf(origin);
  const verdicts = robotsVerdicts(robots.text);
  // A firewall can block AI bots even when robots.txt lets them in. Ask for the homepage as each one and compare.
  const firewall: Record<string, number> = {};
  await Promise.all(
    Object.entries(BOT_UA).map(async ([bot, ua]) => {
      const r = await safeFetch(page.url, { ua, timeout: 10_000, maxBytes: 50_000 });
      firewall[bot] = r.status;
    }),
  );
  const llms = await safeFetch(`${origin}/llms.txt`, { accept: "text/plain,*/*", timeout: 8_000, maxBytes: 200_000 });
  const llmsTxt = llms.ok && !/<html[\s>]/i.test(llms.body.slice(0, 500)) && llms.body.trim().length > 0;
  return {
    result: {
      domain,
      origin,
      robots: { found: robots.found, url: robots.url },
      bots: verdicts.map((v) => {
        const status = firewall[v.bot];
        const firewalled = status !== undefined && page.status >= 200 && page.status < 400 && (status === 0 || status === 401 || status === 403 || status === 429 || status >= 500);
        return { ...v, firewall: firewalled ? status : null };
      }),
      fix: robotsFix(verdicts),
      llmsTxt,
    },
    cost: 0,
  };
}

// ─────────────── llms.txt Generator ───────────────

const locs = (xml: string) => [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&").trim());

/** Pages from the site's sitemaps (robots.txt Sitemap lines, then the usual addresses), one index level down. */
async function sitemapPages(origin: string, robots: string | null): Promise<string[]> {
  const host = new URL(origin).hostname.replace(/^www\./, "");
  const starts = [...new Set([...(robots ?? "").matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]).concat([`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`]))].slice(0, 5);
  const urls: string[] = [];
  for (const s of starts) {
    const r = await safeFetch(s, { accept: "application/xml,text/xml,*/*", timeout: 10_000, maxBytes: 5_000_000 });
    if (!r.ok || !/<(urlset|sitemapindex)[\s>]/i.test(r.body)) continue;
    if (/<sitemapindex[\s>]/i.test(r.body)) {
      const children = locs(r.body).filter((u) => !/image|video|author|tag|category/i.test(u)).slice(0, 8);
      for (const c of children) {
        const cr = await safeFetch(c, { accept: "application/xml,text/xml,*/*", timeout: 10_000, maxBytes: 5_000_000 });
        if (cr.ok) urls.push(...locs(cr.body));
        if (urls.length > 2000) break;
      }
    } else urls.push(...locs(r.body));
    if (urls.length) break;
  }
  return [...new Set(urls)].filter((u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "") === host && !/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|xml)$/i.test(u);
    } catch {
      return false;
    }
  });
}

/** Links on the homepage, for sites with no sitemap. */
function homeLinks(html: string, base: string): string[] {
  const $ = cheerio.load(html);
  const host = new URL(base).hostname;
  const out: string[] = [];
  $("a[href]").each((_, a) => {
    try {
      const u = new URL($(a).attr("href")!, base);
      u.hash = "";
      if (u.hostname === host && /^https?:$/.test(u.protocol)) out.push(u.toString());
    } catch {
      // Not a link.
    }
  });
  return [...new Set(out)];
}

export async function llms(domain: string) {
  const page = await home(domain);
  const origin = new URL(page.url).origin;
  const $ = cheerio.load(page.body);
  const name = ($('meta[property="og:site_name"]').attr("content") || $("title").text().split(/[|·–—-]/)[0] || domain).trim();
  const summary = ($('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "").trim();
  const robots = await robotsOf(origin);
  let urls = await sitemapPages(origin, robots.text);
  const source = urls.length ? "sitemap" : "homepage links";
  if (!urls.length) urls = homeLinks(page.body, page.url);
  // Shortest addresses first: they are usually the main pages.
  urls = [page.url, ...urls.sort((a, b) => new URL(a).pathname.length - new URL(b).pathname.length)];
  // Open the first 40 pages for their real titles and descriptions, within about 25 seconds.
  const opened = new Map<string, LlmsPage>();
  const until = Date.now() + 25_000;
  await pool(urls.slice(0, 40), 8, async (u) => {
    if (Date.now() > until) return;
    const r = await safeFetch(u, { timeout: 8_000, maxBytes: 400_000 });
    if (!r.ok) return;
    const p = cheerio.load(r.body);
    opened.set(u, { url: u, title: (p("title").first().text() || p("h1").first().text()).replace(/\s+/g, " ").trim(), description: (p('meta[name="description"]').attr("content") ?? "").trim() || undefined });
  });
  // "Pricing | Acme" reads better as "Pricing" in a list of Acme's pages.
  const suffix = new RegExp(`\\s*[|·–—-]\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  const pages: LlmsPage[] = urls.map((u) => {
    const p = opened.get(u);
    return p ? { ...p, title: p.title.replace(suffix, "") || p.title } : { url: u, title: titleFromUrl(u) };
  });
  const text = buildLlmsTxt({ name, summary, url: origin }, pages);
  return { result: { domain, origin, source, pages: urls.length, text }, cost: 0 };
}

// ─────────────── AI Answer-Ready Checker ───────────────

export async function answer(url: string) {
  const r = await reach(url, { timeout: 15_000 });
  if (!r.ok) throw bad(`That page answered with an error (${r.status}). Check the address.`);
  if (!/<html|<body|<p[\s>]/i.test(r.body.slice(0, 20000))) throw bad("That address isn't a web page.");
  const robots = await robotsOf(new URL(r.url).origin);
  const path = new URL(r.url).pathname;
  const aiBlocked = robotsVerdicts(robots.text, path)
    .filter((v) => v.purpose === "search" && v.verdict === "blocked")
    .map((v) => v.bot);
  const facts = pageFacts(r.body, r.url, aiBlocked);
  const graded = answerReady(facts);
  return {
    result: { url: r.url, title: facts.title, words: facts.words, score: graded.score, ease: graded.ease, checks: graded.checks.map((c) => ({ id: c.id, label: c.label, pass: c.pass, detail: c.detail, fix: c.fix })) },
    cost: 0,
  };
}

// ─────────────── Domain Authority Checker ───────────────

export async function authority(domain: string) {
  const key = process.env.OPR_API_KEY?.trim();
  const [opr, tranco] = await Promise.all([
    key
      ? fetch(`https://openpagerank.com/api/v1.0/getPageRank?domains%5B0%5D=${encodeURIComponent(domain)}`, { headers: { "API-OPR": key }, signal: AbortSignal.timeout(10_000) })
          .then((r) => r.json() as Promise<{ response?: { status_code?: number; page_rank_decimal?: number | string | null; rank?: string | number | null }[] }>)
          .then((d) => d.response?.[0] ?? null)
          .catch(() => null)
      : Promise.resolve(null),
    fetch(`https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(domain)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? (r.json() as Promise<{ ranks?: { date: string; rank: number }[] }>) : null))
      .catch(() => null),
  ]);
  const pr = opr && opr.status_code === 200 && opr.page_rank_decimal !== null && opr.page_rank_decimal !== undefined ? Number(opr.page_rank_decimal) : null;
  const ranks = (tranco?.ranks ?? []).filter((x) => typeof x.rank === "number").sort((a, b) => a.date.localeCompare(b.date));
  const latest = ranks.at(-1) ?? null;
  if (!key) console.warn("Free tool authority: OPR_API_KEY is not set, so only the Tranco rank is shown.");
  return {
    result: {
      domain,
      authority: pr === null || Number.isNaN(pr) ? null : Math.round(pr * 10),
      linkRank: opr?.rank ? Number(opr.rank) : null,
      popularity: latest ? { rank: latest.rank, date: latest.date, trend: ranks.slice(-30).map((x) => ({ date: x.date, rank: x.rank })) } : null,
    },
    cost: 0,
  };
}

// ─────────────── Page Speed Checker ───────────────

export async function speed(url: string, strategy: "mobile" | "desktop") {
  // Reach the page once first, so an address on a private network is refused before Google is asked about it.
  const first = await reach(url, { method: "GET", timeout: 12_000, maxBytes: 20_000 });
  const q = new URLSearchParams({ url: first.url, strategy, category: "performance" });
  const key = process.env.PAGESPEED_API_KEY?.trim();
  if (key) q.set("key", key);
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: AbortSignal.timeout(70_000) });
  const data = (await res.json().catch(() => ({}))) as Parameters<typeof speedSummary>[0] & { error?: { message?: string } };
  if (!res.ok) {
    if (res.status === 429) {
      if (!key) console.error("Free tool speed: Google refuses calls without PAGESPEED_API_KEY.");
      throw bad("The speed test is busy. Try again in a minute.");
    }
    throw bad(data.error?.message?.replace(/^Lighthouse returned error: /, "") ? "That page couldn't be tested." : `The speed test answered ${res.status}.`);
  }
  return { result: { url: first.url, strategy, ...speedSummary(data) }, cost: 0 };
}

// ─────────────── Broken Link and Redirect Checker ───────────────

const MAX_PAGES = 25;
const MAX_LINKS = 250;

export async function links(url: string) {
  const start = await reach(url, { timeout: 15_000 });
  const host = new URL(start.url).hostname;
  const until = Date.now() + 50_000;
  const pages = new Map<string, string>(); // page url -> html
  const queue = [start.url];
  const from = new Map<string, string>(); // link -> first page it was found on
  pages.set(start.url, start.body);
  // Crawl the same site, breadth first.
  while (queue.length && pages.size < MAX_PAGES && Date.now() < until) {
    const batch = queue.splice(0, 6);
    await Promise.all(
      batch.map(async (u) => {
        const html = pages.get(u) ?? (await safeFetch(u, { timeout: 10_000, maxBytes: 2_000_000 })).body;
        pages.set(u, html);
        const $ = cheerio.load(html);
        $("a[href]").each((_, a) => {
          const h = $(a).attr("href") ?? "";
          if (/^(mailto|tel|javascript|data):|^#/.test(h)) return;
          try {
            const abs = new URL(h, u);
            abs.hash = "";
            if (!/^https?:$/.test(abs.protocol)) return;
            const s = abs.toString();
            if (!from.has(s)) from.set(s, u);
            if (abs.hostname === host && !pages.has(s) && !queue.includes(s) && pages.size + queue.length < MAX_PAGES && !/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3)$/i.test(abs.pathname)) queue.push(s);
          } catch {
            // Not a link.
          }
        });
      }),
    );
  }
  const all = [...from.keys()].slice(0, MAX_LINKS);
  const results: { url: string; from: string; status: number; chain: { url: string; status: number }[]; final: string; internal: boolean; error?: string }[] = [];
  await pool(all, 8, async (u) => {
    if (Date.now() > until + 15_000) return;
    let r = await safeFetch(u, { method: "HEAD", timeout: 8_000 });
    // Some servers refuse HEAD. Ask again with GET before calling a link broken.
    if (r.status === 0 || r.status === 403 || r.status === 405 || r.status === 501) {
      const g = await safeFetch(u, { method: "GET", timeout: 10_000, maxBytes: 20_000 });
      if (g.status !== 0 || r.status === 0) r = g;
    }
    results.push({ url: u, from: from.get(u)!, status: r.status, chain: r.chain, final: r.url, internal: new URL(u).hostname === host, ...(r.error ? { error: r.error } : {}) });
  });
  const broken = results.filter((x) => x.status === 0 || x.status >= 400).sort((a, b) => Number(b.internal) - Number(a.internal));
  const redirects = results.filter((x) => x.chain.length > 0 && x.status > 0 && x.status < 400).sort((a, b) => b.chain.length - a.chain.length);
  return {
    result: {
      url: start.url,
      pages: pages.size,
      checked: results.length,
      found: from.size,
      broken: broken.slice(0, 100).map((x) => ({ url: x.url, from: x.from, status: x.status, error: x.error ?? null, internal: x.internal })),
      redirects: redirects.slice(0, 100).map((x) => ({ url: x.url, from: x.from, hops: x.chain.length, chain: x.chain.map((c) => c.status), final: x.final, internal: x.internal })),
    },
    cost: 0,
  };
}

