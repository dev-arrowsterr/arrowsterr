// Shared by the server and the browser: markets, stages and the shape of a keyword.
import type { BusinessType } from "./db";

export type Stage = "bofu" | "mofu" | "tofu";
export const STAGES: { id: Stage; label: string; long: string }[] = [
  { id: "bofu", label: "BOFU", long: "Bottom of funnel · ready to buy" },
  { id: "mofu", label: "MOFU", long: "Middle of funnel · comparing options" },
  { id: "tofu", label: "TOFU", long: "Top of funnel · learning" },
];
export const PER_STAGE = 40;

/** One keyword with its Google numbers. trend is the last 12 months, oldest first. */
export type Keyword = {
  keyword: string;
  volume: number | null;
  kd: number | null;
  cpc: number | null;
  intent: string | null;
  trend: number[];
  serp: string[];
  rank?: number | null;
  url?: string | null;
  etv?: number | null; // estimated monthly visits this ranking brings
};

/** A keyword from Agentic Keyword Research. group joins keywords one page can rank for. competitor: a rival that ranks for it. */
export type AgentKeyword = Keyword & { stage: Stage; theme: string; group: number; lowData?: boolean; competitor?: string | null };
export type AgentGroup = { id: number; primary: string; stage: Stage; theme: string; keywords: string[]; volume: number };
/** An article already on the site that ranks low or not at all, and the keyword to aim it at. */
export type AgentUpdate = Keyword & { stage: Stage; theme: string; page: string };
/** Answers from the plan questionnaire. Every field is optional, so older runs and empty answers still work. */
export type PlanBrief = {
  goal?: "leads" | "traffic" | "ai" | "authority";
  funnel?: "balanced" | "bofu" | "mofu" | "tofu";
  size?: 30 | 60 | 120;
  difficulty?: "easy" | "mixed" | "hard";
  formats?: string[];
  focus?: string;
  audience?: string;
  avoid?: string;
  rivals?: string;
  updates?: boolean;
  perWeek?: number;
  start?: string;
};
export const GOALS: Record<NonNullable<PlanBrief["goal"]>, string> = {
  leads: "More leads and sales",
  traffic: "More search traffic",
  ai: "Get cited by AI answers",
  authority: "Own a topic",
};
export const FORMATS = ["Blog posts", "How-to guides", "Comparisons", "Alternatives", "Best-of lists", "Landing pages", "Case studies", "Glossary pages"];

/** How many keywords each stage gets for a plan size and funnel focus. */
export function stageCounts(b: PlanBrief | undefined): Record<Stage, number> {
  const total = b?.size ?? PER_STAGE * 3;
  const weights: Record<NonNullable<PlanBrief["funnel"]>, [number, number, number]> = {
    balanced: [1, 1, 1],
    bofu: [2, 1, 1],
    mofu: [1, 2, 1],
    tofu: [1, 1, 2],
  };
  const [w1, w2, w3] = weights[b?.funnel ?? "balanced"];
  const sum = w1 + w2 + w3;
  const bofu = Math.round((total * w1) / sum);
  const mofu = Math.round((total * w2) / sum);
  return { bofu, mofu, tofu: Math.max(0, total - bofu - mofu) };
}

export type AgentResult = {
  brief?: PlanBrief;
  themes?: string[];
  keywords?: AgentKeyword[];
  groups?: AgentGroup[];
  updates?: AgentUpdate[];
  sitemap?: { source: string | null; pages: number; articles: number; ranking: number };
  competitors?: { domain: string; keywords: number }[];
  approved?: string[];
  banked?: boolean; // the plan's rows were copied into the Topic Bank
  cost?: number;
};

/** A page on the site, from its sitemap. */
export type SitePage = { url: string; article: boolean };

/** Google location and language for each market we offer. */
export const MARKETS: Record<string, { location: number; language: string }> = {
  "United States": { location: 2840, language: "en" },
  "United Kingdom": { location: 2826, language: "en" },
  Canada: { location: 2124, language: "en" },
  Australia: { location: 2036, language: "en" },
  Germany: { location: 2276, language: "de" },
  France: { location: 2250, language: "fr" },
  Spain: { location: 2724, language: "es" },
  Netherlands: { location: 2528, language: "nl" },
  India: { location: 2356, language: "en" },
  Singapore: { location: 2702, language: "en" },
  Vietnam: { location: 2704, language: "vi" },
  Japan: { location: 2392, language: "ja" },
  Brazil: { location: 2076, language: "pt" },
  Mexico: { location: 2484, language: "es" },
  Global: { location: 2840, language: "en" },
};
export const marketOf = (country?: string) => MARKETS[country ?? ""] ?? MARKETS["United States"];

/** Funnel stage from Google's search intent, for keywords added by hand. */
export function stageFromIntent(intent: string | null): Stage | null {
  if (intent === "transactional" || intent === "commercial") return "bofu";
  if (intent === "informational") return "tofu";
  return null;
}

/** Search patterns for each stage, by business type. */
export const PATTERNS: Record<Stage, Record<BusinessType, string>> = {
  bofu: {
    saas: `"best X software", "X software for [industry or team]", "X tool", "X platform", "[competitor] alternatives", "[competitor] vs [competitor]", "X pricing", "X software free trial"`,
    service: `"X agency", "X services", "X company", "hire X", "X consultant", "best X agency for [industry]", "X cost", "X pricing", "outsource X"`,
    ecommerce: `"buy X", "best X for [need]", "X for sale", "X reviews", "cheap X", "X under [price]", "[brand] X", "X online"`,
    local: `"X near me", "X in [city]", "best X in [city]", "X cost in [city]", "emergency X", "24 hour X", "affordable X [city]"`,
    marketplace: `"find X", "hire X", "book X", "best X platform", "X marketplace", "X for rent", "X directory"`,
    other: `"best X", "X for [need]", "X pricing", "X cost", "X alternatives", "buy X", "hire X"`,
  },
  mofu: {
    saas: `"how to choose X software", "X features", "X software comparison", "X vs Y" (approaches, not brands), "X examples", "X template", "X checklist", "is X worth it", "types of X software", "X for small business"`,
    service: `"how to choose a X agency", "X agency vs in-house", "what does a X agency do", "X pricing models", "X proposal", "questions to ask a X", "X results", "is X worth it"`,
    ecommerce: `"how to choose X", "X buying guide", "X vs Y" (product types), "types of X", "X size guide", "X materials", "is X worth it", "X for beginners"`,
    local: `"how to choose a X", "what does a X cost", "X vs Y" (service types), "signs you need a X", "questions to ask a X", "how long does X take"`,
    marketplace: `"how to choose a X", "what to look for in a X", "X vs Y", "X rates", "X checklist", "is X safe"`,
    other: `"how to choose X", "X vs Y", "types of X", "X features", "is X worth it", "X checklist"`,
  },
  tofu: {
    saas: `"what is X", "how to X", "X best practices", "X tips", "X strategy", "X examples", "X metrics", "X statistics", "why X matters"`,
    service: `"what is X", "how to X", "X tips", "X strategy", "X mistakes", "X trends", "X statistics", "X guide"`,
    ecommerce: `"how to X", "X ideas", "how to use X", "how to clean X", "X care", "X tips", "what is X", "X benefits"`,
    local: `"how to X", "X tips", "why X", "how often X", "X problems", "diy X", "X signs"`,
    marketplace: `"how to X", "X tips", "X ideas", "what is X", "X guide", "X trends"`,
    other: `"what is X", "how to X", "X tips", "X ideas", "X guide", "why X"`,
  },
};

// ─────────────── planning logic (pure, tested) ───────────────

const SHARED_URLS = 3; // keywords with this many top-10 results in common belong on one page

/** Best keywords first, taking turns across themes so every theme is covered. */
export function pick<T extends Keyword & { theme: string }>(cands: T[], n: number, themes: string[]): T[] {
  const score = (k: Keyword) => (k.volume ?? 0) / ((k.kd ?? 30) + 10);
  const byTheme = new Map(themes.map((t) => [t, cands.filter((c) => c.theme === t).sort((a, b) => score(b) - score(a))]));
  const out: T[] = [];
  while (out.length < n && [...byTheme.values()].some((l) => l.length)) for (const l of byTheme.values()) if (l.length && out.length < n) out.push(l.shift()!);
  return out;
}

/** Union keywords whose top 10 results share enough pages. */
export function groupBySerp(list: AgentKeyword[], serps: Map<string, string[]>): AgentGroup[] {
  const parent = list.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < list.length; i++) {
    const a = new Set(serps.get(list[i].keyword) ?? []);
    if (!a.size) continue;
    for (let j = i + 1; j < list.length; j++) {
      const shared = (serps.get(list[j].keyword) ?? []).filter((u) => a.has(u)).length;
      if (shared >= SHARED_URLS) parent[root(j)] = root(i);
    }
  }
  const groups = new Map<number, AgentKeyword[]>();
  list.forEach((k, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), k]));
  return [...groups.values()].map((ks, id) => {
    const sorted = [...ks].sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1));
    for (const k of ks) k.group = id;
    return { id, primary: sorted[0].keyword, stage: sorted[0].stage, theme: sorted[0].theme, keywords: sorted.map((k) => k.keyword), volume: ks.reduce((n, k) => n + (k.volume ?? 0), 0) };
  });
}

/** Dates (YYYY-MM-DD) for `count` posts at `perWeek` a week, on weekdays, from `start`. */
export function slots(start: Date, perWeek: number, count: number): string[] {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const out: string[] = [];
  const monday = new Date(start);
  monday.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const offsets = Array.from({ length: Math.min(Math.max(perWeek, 1), 5) }, (_, i) => Math.floor((i * 5) / Math.min(Math.max(perWeek, 1), 5)));
  for (let week = 0; out.length < count && week < 520; week++)
    for (const o of offsets) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + week * 7 + o);
      if (d >= start && out.length < count) out.push(iso(d));
    }
  return out;
}

// ─────────────── keyword report (Semrush-style overview) ───────────────

export type KwSummary = {
  keyword: string;
  volume: number | null;
  kd: number | null;
  cpc: number | null;
  competition: number | null;
  intent: string | null;
  otherIntents: string[];
  trend: { month: string; volume: number }[];
  serp: string[];
  results: number | null;
  core: string | null;
};
/** volume adds up the rows loaded (20 in a report, up to 1,000 in "See all"). */
export type KwList = { total: number; volume: number; rows: KwSummary[] };
export type KwCluster = { name: string; volume: number; count: number; keywords: string[] };
export type SerpRow = { rank: number; url: string; domain: string; title: string; sitelinks: boolean; traffic: number | null; keywords: number | null; aiCited: boolean };
export type KwSerp = {
  features: string[];
  ads: number;
  results: number | null;
  aio: { shown: boolean; cites: { domain: string; url: string; title: string }[] };
  local: { title: string; domain: string; rating: number | null }[];
  rows: SerpRow[];
};
export type KeywordReport = {
  keyword: string;
  country: string;
  device: "desktop" | "mobile";
  overview: KwSummary | null;
  byCountry: { country: string; volume: number | null }[];
  variations: KwList;
  questions: KwList;
  clusters: KwCluster[];
  serp: KwSerp | null;
  cost: number;
  cached: boolean;
};

/** Group keywords into topics by their core keyword, biggest first. Keywords without one stand alone. */
export function clustersOf(rows: KwSummary[], seed: string, max = 6): KwCluster[] {
  const groups = new Map<string, KwSummary[]>();
  for (const r of rows) {
    const head = (r.core || r.keyword).toLowerCase();
    if (head === seed.toLowerCase()) continue;
    groups.set(head, [...(groups.get(head) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([name, ks]) => ({ name, count: ks.length, volume: ks.reduce((n, k) => n + (k.volume ?? 0), 0), keywords: ks.map((k) => k.keyword) }))
    .sort((a, b) => b.count - a.count || b.volume - a.volume)
    .slice(0, max);
}

// ─────────────── domain research ───────────────

export type DomainReport = {
  domain: string;
  scope?: "domain" | "subdomain" | "subfolder" | "url";
  country: string;
  overview: { keywords: number; traffic: number; top3: number; top10: number; top20: number; top100: number; newKw: number; lostKw: number } | null;
  keywords: Keyword[];
  more?: boolean;
  pages: { url: string; keywords: number; traffic: number; top: string }[];
  competitors: { domain: string; shared: number; keywords: number; traffic: number }[];
  cost: number;
  cached: boolean;
};

/** Group a domain's ranking keywords by page, most traffic first. */
export function pagesOf(rows: Keyword[]) {
  const by = new Map<string, Keyword[]>();
  for (const r of rows) if (r.url) by.set(r.url, [...(by.get(r.url) ?? []), r]);
  return [...by.entries()]
    .map(([url, ks]) => ({
      url,
      keywords: ks.length,
      traffic: Math.round(ks.reduce((n, k) => n + (k.etv ?? 0), 0)),
      top: [...ks].sort((a, b) => (b.etv ?? 0) - (a.etv ?? 0))[0].keyword,
    }))
    .sort((a, b) => b.traffic - a.traffic || b.keywords - a.keywords);
}
