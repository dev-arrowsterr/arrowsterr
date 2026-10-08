import "server-only";
import { call } from "./dataforseo";
import type { Keyword } from "./research";

// Keyword numbers from DataForSEO Labs, and Google's top 10 results for grouping keywords into pages.

export type Market = { location: number; language: string };
export type Mode = "ideas" | "phrase" | "related" | "site" | "ranked";

type Info = {
  keyword?: string;
  keyword_info?: { search_volume?: number | null; cpc?: number | null; monthly_searches?: { year: number; month: number; search_volume: number | null }[] | null };
  keyword_properties?: { keyword_difficulty?: number | null };
  search_intent_info?: { main_intent?: string | null };
  serp_info?: { serp_item_types?: string[] | null };
};
type Item = Info & { keyword_data?: Info; ranked_serp_element?: { serp_item?: { rank_group?: number; url?: string } } };

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
export function research(mode: Mode, query: string, m: Market, spend: Spend, limit = 300): Promise<Keyword[]> {
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
      return labs("ranked_keywords", { ...base, target: query, order_by: ["keyword_data.keyword_info.search_volume,desc"] }, spend);
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
