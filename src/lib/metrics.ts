// Numbers for every page, worked out from saved runs. Pure functions, no network.
import { isAnswered, type Chat, type Run } from "./chats";
import { domainOf } from "./sources";

export type Metric = "visibility" | "sentiment" | "position";

export type BrandStat = {
  name: string;
  domain: string | null;
  isYou: boolean;
  visibility: number; // % of answered chats that name the brand
  sentiment: number | null; // average 0 to 100 when named
  position: number | null; // average spot in the list when named
  mentions: number;
};

export type Filter = (c: Chat) => boolean;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const ownsDomain = (d: string, domain: string | null | undefined) => Boolean(domain) && (d === domain || d.endsWith(`.${domain}`));

export function answered(runs: Run[], filter: Filter): Chat[] {
  return runs.flatMap((r) => r.chats).filter((c) => filter(c) && isAnswered(c));
}

/** Every brand named in these chats, plus you even when no answer named you. */
export function brandStats(chats: Chat[], you: { name: string; domain: string }): BrandStat[] {
  const map = new Map<string, { name: string; pos: number[]; sent: number[]; domains: Map<string, number> }>();
  for (const c of chats) {
    for (const b of c.brands) {
      const k = b.name.toLowerCase();
      const row = map.get(k) ?? { name: b.name, pos: [] as number[], sent: [] as number[], domains: new Map<string, number>() };
      row.pos.push(b.position);
      row.sent.push(b.sentiment);
      if (b.domain) row.domains.set(b.domain, (row.domains.get(b.domain) ?? 0) + 1);
      map.set(k, row);
    }
  }
  const rows: BrandStat[] = [...map.values()].map((r) => {
    const isYou = same(r.name, you.name);
    return {
      name: r.name,
      isYou,
      domain: isYou ? you.domain : ([...r.domains.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null),
      mentions: r.pos.length,
      visibility: chats.length ? (r.pos.length / chats.length) * 100 : 0,
      sentiment: avg(r.sent),
      position: avg(r.pos),
    };
  });
  if (!rows.some((r) => r.isYou)) rows.push({ name: you.name, domain: you.domain, isYou: true, mentions: 0, visibility: 0, sentiment: null, position: null });
  return rows.sort((a, b) => b.visibility - a.visibility || b.mentions - a.mentions);
}

export const metricOf = (r: BrandStat | undefined, m: Metric): number | null => (!r ? null : m === "visibility" ? r.visibility : r[m]);

/** Your place among all brands for a metric, like 3 of 14. Lower position is better. */
export function rankOf(rows: BrandStat[], m: Metric): { rank: number; of: number } | null {
  const scored = rows.filter((r) => metricOf(r, m) !== null && (m === "visibility" || r.mentions > 0));
  const you = scored.find((r) => r.isYou);
  if (!you) return null;
  const sorted = [...scored].sort((a, b) => (m === "position" ? metricOf(a, m)! - metricOf(b, m)! : metricOf(b, m)! - metricOf(a, m)!));
  return { rank: sorted.indexOf(you) + 1, of: sorted.length };
}

/** The runs in this window and in the window just before it, oldest first. */
export function splitPeriods(runs: Run[], days: number, now = Date.now()) {
  const span = days * 864e5;
  const t = (r: Run) => new Date(r.at).getTime();
  return { current: runs.filter((r) => t(r) >= now - span), previous: runs.filter((r) => t(r) < now - span && t(r) >= now - 2 * span) };
}

export type Point = { label: string; at: string; values: Record<string, number | null> };

/** One point per day: each brand's metric from that day's answers. */
export function trend(runs: Run[], names: string[], m: Metric, filter: Filter): Point[] {
  const byDay = new Map<string, Chat[]>();
  for (const r of runs) {
    const day = r.at.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), ...r.chats.filter((c) => filter(c) && isAnswered(c))]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([, chats]) => chats.length)
    .map(([day, chats]) => {
      const values: Record<string, number | null> = {};
      for (const n of names) {
        const hits = chats.flatMap((c) => c.brands.filter((b) => same(b.name, n)));
        values[n] =
          m === "visibility"
            ? (chats.filter((c) => c.brands.some((b) => same(b.name, n))).length / chats.length) * 100
            : avg(hits.map((h) => (m === "sentiment" ? h.sentiment : h.position)));
      }
      return { label: new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" }), at: day, values };
    });
}

// ─────────────── sources ───────────────

export type SourceType = "You" | "Competitor" | "UGC" | "Reviews" | "Editorial" | "Reference" | "Corporate";
export const SOURCE_TYPES: SourceType[] = ["You", "Competitor", "UGC", "Reviews", "Editorial", "Reference", "Corporate"];

const UGC = ["reddit.com", "quora.com", "youtube.com", "x.com", "twitter.com", "facebook.com", "linkedin.com", "medium.com", "tiktok.com", "instagram.com", "pinterest.com", "substack.com", "stackexchange.com", "stackoverflow.com", "github.com", "producthunt.com", "news.ycombinator.com", "discord.com", "threads.net"];
const REVIEWS = ["g2.com", "capterra.com", "trustpilot.com", "yelp.com", "tripadvisor.com", "getapp.com", "softwareadvice.com", "trustradius.com", "clutch.co", "sitejabber.com", "glassdoor.com", "bbb.org", "consumerreports.org", "goodfirms.co", "designrush.com", "upcity.com"];
const REFERENCE = ["wikipedia.org", "wikihow.com", "britannica.com", "investopedia.com", "gov", "edu", "who.int", "nih.gov"];
const EDITORIAL_HINTS = /(news|times|post|journal|magazine|mag|daily|review|reviews|blog|guide|insider|wired|verge|techcrunch|forbes|cnet|zdnet|pcmag|techradar|tomsguide|engadget|businessinsider|nytimes|wsj|bbc|cnn|guardian|reuters|bloomberg|fortune|inc|entrepreneur|fastcompany|hubspot\.com\/blog|nerdwallet|buzzfeed|vogue|elle|gq|wirecutter|healthline|webmd|allrecipes|eater|timeout|thrillist|lonelyplanet)/;

const matches = (d: string, list: string[]) => list.some((x) => d === x || d.endsWith(`.${x}`) || (!x.includes(".") && d.endsWith(`.${x}`)));

export function sourceType(domain: string, you: string, competitorDomains: Set<string>): SourceType {
  if (ownsDomain(domain, you)) return "You";
  if ([...competitorDomains].some((c) => ownsDomain(domain, c))) return "Competitor";
  if (matches(domain, UGC)) return "UGC";
  if (matches(domain, REVIEWS)) return "Reviews";
  if (matches(domain, REFERENCE)) return "Reference";
  if (EDITORIAL_HINTS.test(domain)) return "Editorial";
  return "Corporate";
}

export type DomainRow = { domain: string; type: SourceType; used: number; citations: number; avgCitations: number; chats: number };
export type UrlRow = { url: string; title: string | null; domain: string; type: SourceType; used: number; chats: number; prompts: string[] };

export function competitorDomains(stats: BrandStat[]): Set<string> {
  return new Set(stats.filter((s) => !s.isYou && s.domain).map((s) => s.domain!));
}

/** Sites cited in answers. used = % of answers that cite the site. avgCitations = links per answer that cites it. */
export function domainRows(chats: Chat[], you: string, comp: Set<string>): DomainRow[] {
  const map = new Map<string, { chats: number; citations: number }>();
  for (const c of chats) {
    const counts = new Map<string, number>();
    for (const s of c.sources) {
      const d = s.domain || domainOf(s.url);
      if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    for (const [d, n] of counts) {
      const row = map.get(d) ?? { chats: 0, citations: 0 };
      row.chats++;
      row.citations += n;
      map.set(d, row);
    }
  }
  return [...map.entries()]
    .map(([domain, r]) => ({
      domain,
      type: sourceType(domain, you, comp),
      chats: r.chats,
      citations: r.citations,
      used: chats.length ? (r.chats / chats.length) * 100 : 0,
      avgCitations: r.citations / r.chats,
    }))
    .sort((a, b) => b.chats - a.chats || b.citations - a.citations);
}

/** One address per page: no #fragment (like text highlights), no trailing slash, no www. */
export function pageKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** A page title without the site name tacked on the end, like " - Momos" or " | Acme". */
export const cleanTitle = (t: string) => t.replace(/\s+[-|–—]\s+[^-|–—]{1,40}$/, "").trim();

/** Cited pages. The same page cited with different #fragments or a trailing slash counts once. */
export function urlRows(chats: Chat[], you: string, comp: Set<string>): UrlRow[] {
  const map = new Map<string, { url: string; title: string | null; domain: string; chats: Set<number>; prompts: Set<string> }>();
  chats.forEach((c, ci) => {
    for (const s of c.sources) {
      const key = pageKey(s.url);
      const row = map.get(key) ?? { url: s.url.split("#")[0], title: s.title, domain: s.domain || domainOf(s.url), chats: new Set<number>(), prompts: new Set<string>() };
      row.chats.add(ci);
      row.prompts.add(c.prompt);
      if (!row.title && s.title) row.title = s.title;
      map.set(key, row);
    }
  });
  let rows = [...map.values()].map((r) => ({
    url: r.url,
    title: r.title,
    domain: r.domain,
    type: sourceType(r.domain, you, comp),
    chats: r.chats.size,
    used: chats.length ? (r.chats.size / chats.length) * 100 : 0,
    prompts: [...r.prompts],
  }));
  // Your own pages: merge pages that share a title, so one article shows once.
  const own = new Map<string, UrlRow>();
  rows = rows.filter((r) => {
    if (r.type !== "You" || !r.title) return true;
    const k = cleanTitle(r.title).toLowerCase();
    const first = own.get(k);
    if (!first) {
      own.set(k, r);
      return true;
    }
    first.chats += r.chats;
    first.used += r.used;
    first.prompts = [...new Set([...first.prompts, ...r.prompts])];
    return false;
  });
  return rows.sort((a, b) => b.chats - a.chats);
}

export type DomainGroup = { domain: string; type: SourceType; used: number; chats: number; pages: UrlRow[] };

/** Cited pages grouped by site. used = % of answers that cite any page on the site. */
export function urlGroups(urls: UrlRow[], domains: DomainRow[]): DomainGroup[] {
  const byDomain = new Map<string, UrlRow[]>();
  for (const u of urls) byDomain.set(u.domain, [...(byDomain.get(u.domain) ?? []), u]);
  return [...byDomain.entries()]
    .map(([domain, pages]) => {
      const d = domains.find((x) => x.domain === domain);
      return { domain, type: pages[0].type, used: d?.used ?? 0, chats: d?.chats ?? 0, pages };
    })
    .sort((a, b) => b.chats - a.chats);
}

/** Share of all citations by site type. */
export function typeShares(rows: DomainRow[]): { type: SourceType; share: number }[] {
  const total = rows.reduce((n, r) => n + r.citations, 0) || 1;
  return SOURCE_TYPES.map((type) => ({ type, share: (rows.filter((r) => r.type === type).reduce((n, r) => n + r.citations, 0) / total) * 100 }));
}

// ─────────────── prompts ───────────────

export type EngineCell = { engine: string; status: "named" | "missed" | "error" | "none"; position: number | null };
export type PromptRow = {
  prompt: string;
  topic: string;
  answers: number;
  visibility: number | null;
  position: number | null;
  sentiment: number | null;
  latest: EngineCell[]; // from the most recent run that asked it
  topBrands: { name: string; domain: string | null; count: number; isYou: boolean }[];
  sources: { domain: string; count: number; urls: { url: string; title: string | null; count: number }[] }[];
  latestAt: string | null;
};

export function promptRows(runs: Run[], topics: { name: string; prompts: string[] }[], engines: string[], you: string, filter: Filter): PromptRow[] {
  const sorted = [...runs].sort((a, b) => a.at.localeCompare(b.at));
  return topics.flatMap((t) =>
    t.prompts.map((prompt) => {
      const all = sorted.flatMap((r) => r.chats.filter((c) => c.prompt === prompt && filter(c)).map((c) => ({ c, at: r.at })));
      const ok = all.filter((x) => isAnswered(x.c));
      const mine = ok.map((x) => x.c.brands.find((b) => same(b.name, you))).filter(Boolean) as { position: number; sentiment: number }[];
      const lastRun = [...sorted].reverse().find((r) => r.chats.some((c) => c.prompt === prompt && filter(c)));
      const latest: EngineCell[] = engines.map((engine) => {
        const c = lastRun?.chats.find((x) => x.prompt === prompt && x.engine === engine);
        if (!c) return { engine, status: "none", position: null };
        if (!isAnswered(c)) return { engine, status: "error", position: null };
        const m = c.brands.find((b) => same(b.name, you));
        return { engine, status: m ? "named" : "missed", position: m?.position ?? null };
      });
      const brands = new Map<string, { count: number; domain: string | null }>();
      for (const x of ok)
        for (const b of x.c.brands) {
          const row = brands.get(b.name) ?? { count: 0, domain: null };
          row.count++;
          row.domain ??= b.domain ?? null;
          brands.set(b.name, row);
        }
      const doms = new Map<string, { count: number; urls: Map<string, { title: string | null; count: number }> }>();
      for (const x of ok) {
        const seen = new Set<string>();
        for (const src of x.c.sources) {
          const d = src.domain || domainOf(src.url);
          const row = doms.get(d) ?? { count: 0, urls: new Map() };
          if (!seen.has(d)) row.count++;
          seen.add(d);
          const u = row.urls.get(src.url) ?? { title: src.title, count: 0 };
          u.count++;
          row.urls.set(src.url, u);
          doms.set(d, row);
        }
      }
      return {
        prompt,
        topic: t.name,
        answers: ok.length,
        visibility: ok.length ? (mine.length / ok.length) * 100 : null,
        position: avg(mine.map((m) => m.position)),
        sentiment: avg(mine.map((m) => m.sentiment)),
        latest,
        latestAt: lastRun?.at ?? null,
        topBrands: [...brands.entries()].map(([name, r]) => ({ name, domain: r.domain, count: r.count, isYou: same(name, you) })).sort((a, b) => b.count - a.count).slice(0, 10),
        sources: [...doms.entries()]
          .map(([domain, r]) => ({
            domain,
            count: r.count,
            urls: [...r.urls.entries()].map(([url, u]) => ({ url, title: u.title, count: u.count })).sort((a, b) => b.count - a.count),
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10),
      };
    }),
  );
}

// ─────────────── one competitor ───────────────

export type CompetitorDetail = {
  byEngine: { engine: string; them: number | null; you: number | null }[];
  byTopic: { topic: string; them: number | null; you: number | null }[];
  gaps: { prompt: string; topic: string; them: number; you: number }[]; // prompts where they show up more than you
  domains: { domain: string; count: number }[]; // sites cited in answers that name them
};

export function competitorDetail(chats: Chat[], name: string, you: string, engines: string[], topics: { name: string; prompts: string[] }[]): CompetitorDetail {
  const share = (list: Chat[], n: string) => (list.length ? (list.filter((c) => c.brands.some((b) => same(b.name, n))).length / list.length) * 100 : null);
  const topicOf = new Map(topics.flatMap((t) => t.prompts.map((p) => [p, t.name] as const)));
  const prompts = [...new Set(chats.map((c) => c.prompt))];
  const doms = new Map<string, number>();
  for (const c of chats) if (c.brands.some((b) => same(b.name, name))) for (const d of new Set(c.sources.map((s) => s.domain))) doms.set(d, (doms.get(d) ?? 0) + 1);
  return {
    byEngine: engines.map((engine) => {
      const list = chats.filter((c) => c.engine === engine);
      return { engine, them: share(list, name), you: share(list, you) };
    }),
    byTopic: topics.map((t) => {
      const list = chats.filter((c) => t.prompts.includes(c.prompt));
      return { topic: t.name, them: share(list, name), you: share(list, you) };
    }),
    gaps: prompts
      .map((p) => {
        const list = chats.filter((c) => c.prompt === p);
        return { prompt: p, topic: topicOf.get(p) ?? "", them: share(list, name) ?? 0, you: share(list, you) ?? 0 };
      })
      .filter((g) => g.them > g.you)
      .sort((a, b) => b.them - b.you - (a.them - a.you))
      .slice(0, 10),
    domains: [...doms.entries()].map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count).slice(0, 8),
  };
}
