import "server-only";
import { call } from "./dataforseo";
import type { Keyword } from "./research";

// Keyword numbers from DataForSEO Labs, and Google's top 10 results for grouping keywords into pages.

export type Market = { location: number; language: string };
export type Mode = "ideas" | "phrase" | "related" | "site" | "ranked" | "competitors";

type Info = {
  keyword?: string;
  keyword_info?: { search_volume?: number | null; cpc?: number | null; monthly_searches?: { year: number; month: number; search_volume: number | null }[] | null };
  keyword_properties?: { keyword_difficulty?: number | null };
  search_intent_info?: { main_intent?: string | null };
  serp_info?: { serp_item_types?: string[] | null };
};
type Item = Info & { keyword_data?: Info; ranked_serp_element?: { serp_item?: { rank_group?: number; url?: string; etv?: number } } };

/** Money spent on DataForSEO in one request, added up across calls. */
export class Spend {
  total = 0;
  add(tasks: { cost?: number }[]) {
    for (const t of tasks) this.total += Number(t?.cost ?? 0);
  }
}

function toKeyword(item: Item): Keyword | null {
  const d: Info = item.keyword_data ?? item;
  if (!d.keyword) return null;
  const months = [...(d.keyword_info?.monthly_searches ?? [])].sort((a, b) => a.year - b.year || a.month - b.month).slice(-12);
  return {
    keyword: d.keyword,
    volume: d.keyword_info?.search_volume ?? null,
    kd: d.keyword_properties?.keyword_difficulty ?? null,
    cpc: d.keyword_info?.cpc ?? null,
    intent: d.search_intent_info?.main_intent ?? null,
    trend: months.map((m) => m.search_volume ?? 0),
    serp: d.serp_info?.serp_item_types ?? [],
    rank: item.ranked_serp_element?.serp_item?.rank_group ?? null,
    url: item.ranked_serp_element?.serp_item?.url ?? null,
    etv: item.ranked_serp_element?.serp_item?.etv ?? null,
  };
}

async function labs(path: string, body: Record<string, unknown>, spend: Spend): Promise<Keyword[]> {
  const tasks = await call(`dataforseo_labs/google/${path}/live`, [body]);
  spend.add(tasks);
  const task = tasks[0];
  if (task?.status_code !== 20000) throw new Error(`DataForSEO: ${task?.status_message ?? "no result"}`);
  const items: Item[] = task.result?.[0]?.items ?? [];
  return items.map(toKeyword).filter((k): k is Keyword => Boolean(k));
}

/** Keyword Research: ideas from a word, or what a domain ranks for. */
export function research(mode: Exclude<Mode, "competitors">, query: string, m: Market, spend: Spend, limit = 300, maxRank?: number): Promise<Keyword[]> {
  const base = { location_code: m.location, language_code: m.language, limit };
  const byVolume = ["keyword_info.search_volume,desc"];
  switch (mode) {
    case "ideas":
      return labs("keyword_ideas", { ...base, keywords: [query], include_serp_info: true, order_by: byVolume }, spend);
    case "phrase":
      return labs("keyword_suggestions", { ...base, keyword: query, include_serp_info: true, order_by: byVolume }, spend);
    case "related":
      return labs("related_keywords", { ...base, keyword: query, depth: 2, include_serp_info: true }, spend);
    case "site":
      return labs("keywords_for_site", { ...base, target: query, include_serp_info: true, order_by: byVolume }, spend);
    case "ranked":
      return labs(
        "ranked_keywords",
        {
          ...base,
          target: query,
          order_by: ["keyword_data.keyword_info.search_volume,desc"],
          ...(maxRank ? { filters: ["ranked_serp_element.serp_item.rank_group", "<=", maxRank] } : {}),
        },
        spend,
      );
  }
}

/** Google numbers for a list of keywords we already have (up to 700 per call). */
export async function overview(keywords: string[], m: Market, spend: Spend): Promise<Map<string, Keyword>> {
  const out = new Map<string, Keyword>();
  for (let i = 0; i < keywords.length; i += 700) {
    const rows = await labs(
      "keyword_overview",
      { keywords: keywords.slice(i, i + 700), location_code: m.location, language_code: m.language, include_serp_info: true },
      spend,
    );
    for (const r of rows) out.set(r.keyword.toLowerCase(), r);
  }
  return out;
}

/** Google's top 10 regular results for one keyword, as clean URLs. */
export async function topUrls(keyword: string, m: Market, spend: Spend): Promise<string[]> {
  const tasks = await call("serp/google/organic/live/regular", [{ keyword, location_code: m.location, language_code: m.language, depth: 10 }]);
  spend.add(tasks);
  const items: { type?: string; url?: string }[] = tasks[0]?.result?.[0]?.items ?? [];
  return items
    .filter((i) => i.type === "organic" && i.url)
    .slice(0, 10)
    .map((i) => i.url!.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, ""));
}

/** Big sites that share results with almost everyone. They are never a real competitor. */
const GIANTS = /(^|\.)(wikipedia\.org|youtube\.com|amazon\.[a-z.]+|reddit\.com|quora\.com|facebook\.com|linkedin\.com|instagram\.com|twitter\.com|x\.com|pinterest\.[a-z.]+|medium\.com|forbes\.com|g2\.com|capterra\.com|trustpilot\.com|yelp\.com|tiktok\.com|google\.[a-z.]+|apple\.com|microsoft\.com|github\.com|indeed\.com|glassdoor\.com|nytimes\.com|investopedia\.com|ebay\.[a-z.]+|walmart\.com|etsy\.com)$/i;

export type Competitor = { domain: string; shared: number; keywords: number; traffic: number };

/** Sites that rank for the most of the same keywords as this one. */
export async function competitors(domain: string, m: Market, spend: Spend, limit = 20): Promise<Competitor[]> {
  const tasks = await call("dataforseo_labs/google/competitors_domain/live", [
    { target: domain, location_code: m.location, language_code: m.language, limit: limit + 5, exclude_top_domains: true },
  ]);
  spend.add(tasks);
  const task = tasks[0];
  if (task?.status_code !== 20000) throw new Error(`DataForSEO: ${task?.status_message ?? "no result"}`);
  type Row = { domain?: string; intersections?: number; full_domain_metrics?: { organic?: { count?: number; etv?: number } } };
  const items: Row[] = task.result?.[0]?.items ?? [];
  const self = domain.replace(/^www\./, "");
  return items
    .filter((i) => i.domain && i.domain.replace(/^www\./, "") !== self && !GIANTS.test(i.domain.replace(/^www\./, "")))
    .map((i) => ({
      domain: i.domain!.replace(/^www\./, ""),
      shared: i.intersections ?? 0,
      keywords: i.full_domain_metrics?.organic?.count ?? 0,
      traffic: Math.round(i.full_domain_metrics?.organic?.etv ?? 0),
    }))
    .sort((a, b) => b.shared - a.shared)
    .slice(0, limit);
}

/** What Domain Research looks at: a whole domain, one subdomain, a folder, or a single page. */
export type Scope = "domain" | "subdomain" | "subfolder" | "url";
export type Target = { scope: Scope; host: string; path: string };

/** Read what someone typed into a target for the chosen scope. Returns null when it is not a web address. */
export function parseTarget(input: string, scope: Scope): Target | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host)) return null;
  const path = u.pathname.replace(/\/+$/, "");
  if (scope === "domain") return { scope, host: host.replace(/^www\./, ""), path: "" };
  if (scope === "subdomain") return { scope, host, path: "" };
  if (!path) return null; // a folder or a page needs a path
  return { scope, host, path: scope === "subfolder" ? `${path}/` : path + u.search };
}

/** How a target shows on screen and in the cache key. */
export const targetLabel = (t: Target) => t.host + t.path;

/** The ranked_keywords settings for a target. */
function rankedTarget(t: Target): Record<string, unknown> {
  if (t.scope === "domain") return { target: t.host, include_subdomains: true };
  if (t.scope === "subdomain") return { target: t.host, include_subdomains: false };
  if (t.scope === "url") return { target: `https://${t.host}${t.path}` };
  return { target: t.host, include_subdomains: false, filters: ["ranked_serp_element.serp_item.relative_url", "like", `${t.path}%`] };
}

type Organic = Record<string, number>;
const sizeOf = (o: Organic | undefined) => {
  if (!o) return null;
  const n = (k: string) => Number(o[k] ?? 0);
  const top3 = n("pos_1") + n("pos_2_3");
  const top10 = top3 + n("pos_4_10");
  const top20 = top10 + n("pos_11_20");
  return {
    keywords: n("count"),
    traffic: Math.round(n("etv")),
    top3,
    top10,
    top20,
    top100: top20 + ["pos_21_30", "pos_31_40", "pos_41_50", "pos_51_60", "pos_61_70", "pos_71_80", "pos_81_90", "pos_91_100"].reduce((s, k) => s + n(k), 0),
    newKw: n("is_new"),
    lostKw: n("is_lost"),
  };
};

/** Keywords a target ranks for, plus its size on Google from the same call. */
export async function rankedFor(t: Target, m: Market, spend: Spend, limit: number) {
  const tasks = await call("dataforseo_labs/google/ranked_keywords/live", [
    { ...rankedTarget(t), location_code: m.location, language_code: m.language, limit, order_by: ["keyword_data.keyword_info.search_volume,desc"] },
  ]);
  spend.add(tasks);
  const task = tasks[0];
  if (task?.status_code !== 20000) throw new Error(`DataForSEO: ${task?.status_message ?? "no result"}`);
  const result = task.result?.[0];
  const items: Item[] = result?.items ?? [];
  return { keywords: items.map(toKeyword).filter((k): k is Keyword => Boolean(k)), overview: sizeOf(result?.metrics?.organic as Organic | undefined) };
}

/** A domain's size on Google: keywords, estimated visits and how many rank in the top 3, 10, 20 and 100. */
export async function domainOverview(domain: string, m: Market, spend: Spend) {
  const tasks = await call("dataforseo_labs/google/domain_rank_overview/live", [{ target: domain, location_code: m.location, language_code: m.language }]);
  spend.add(tasks);
  const t = tasks[0];
  if (t?.status_code !== 20000) throw new Error(`DataForSEO: ${t?.status_message ?? "no result"}`);
  const o = t.result?.[0]?.items?.[0]?.metrics?.organic as Record<string, number> | undefined;
  if (!o) return null;
  const n = (k: string) => Number(o[k] ?? 0);
  const top3 = n("pos_1") + n("pos_2_3");
  const top10 = top3 + n("pos_4_10");
  const top20 = top10 + n("pos_11_20");
  return {
    keywords: n("count"),
    traffic: Math.round(n("etv")),
    top3,
    top10,
    top20,
    top100: top20 + ["pos_21_30", "pos_31_40", "pos_41_50", "pos_51_60", "pos_61_70", "pos_71_80", "pos_81_90", "pos_91_100"].reduce((s, k) => s + n(k), 0),
    newKw: n("is_new"),
    lostKw: n("is_lost"),
  };
}
