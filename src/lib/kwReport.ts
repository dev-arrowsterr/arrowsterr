import "server-only";
import { cached, DAY, readCache, writeCache } from "./cache";
import { call } from "./dataforseo";
import { clustersOf, MARKETS, type KeywordReport, type KwList, type KwSerp, type KwSummary } from "./research";

// One Semrush-style report for a keyword: numbers, volume by country, variations, questions,
// clusters and Google's top 20 with traffic. Every piece is cached and shared across customers.

type Info = {
  keyword?: string;
  keyword_info?: { search_volume?: number | null; cpc?: number | null; competition?: number | null; monthly_searches?: { year: number; month: number; search_volume: number | null }[] | null };
  keyword_properties?: { keyword_difficulty?: number | null; core_keyword?: string | null };
  search_intent_info?: { main_intent?: string | null; foreign_intent?: string[] | null };
  serp_info?: { serp_item_types?: string[] | null; se_results_count?: number | null };
};
type Market = { location: number; language: string };
const QUESTION = "^(what|how|why|which|who|where|when|can|is|are|does|do|should|will|could)\\s";
const TOP_MARKETS = ["United States", "India", "United Kingdom", "Canada", "Australia", "Singapore"];

export function toSummary(d: Info): KwSummary | null {
  if (!d?.keyword) return null;
  const months = [...(d.keyword_info?.monthly_searches ?? [])].sort((a, b) => a.year - b.year || a.month - b.month).slice(-12);
  return {
    keyword: d.keyword,
    volume: d.keyword_info?.search_volume ?? null,
    kd: d.keyword_properties?.keyword_difficulty ?? null,
    cpc: d.keyword_info?.cpc ?? null,
    competition: d.keyword_info?.competition ?? null,
    intent: d.search_intent_info?.main_intent ?? null,
    otherIntents: d.search_intent_info?.foreign_intent ?? [],
    trend: months.map((m) => ({ month: `${m.year}-${String(m.month).padStart(2, "0")}`, volume: m.search_volume ?? 0 })),
    serp: d.serp_info?.serp_item_types ?? [],
    results: d.serp_info?.se_results_count ?? null,
    core: d.keyword_properties?.core_keyword ?? null,
  };
}

/** Run one DataForSEO call and add what it cost. */
async function task(path: string, body: Record<string, unknown>, cost: { total: number }) {
  const tasks = await call(path, [body]);
  const t = tasks[0];
  cost.total += Number(t?.cost ?? 0);
  if (t?.status_code !== 20000) throw new Error(`DataForSEO: ${t?.status_message ?? "no result"}`);
  return t.result?.[0] ?? {};
}

/** Keyword numbers for many keywords in one market. Cached 30 days per keyword; only missing ones are fetched. */
export async function overviewMany(keywords: string[], m: Market, cost: { total: number }): Promise<Map<string, KwSummary | null>> {
  const out = new Map<string, KwSummary | null>();
  const missing: string[] = [];
  await Promise.all(
    keywords.map(async (k) => {
      const hit = await readCache<KwSummary | null>(`ov:${m.location}:${m.language}:${k}`, 30 * DAY);
      if (hit !== undefined) out.set(k, hit);
      else missing.push(k);
    }),
  );
  for (let i = 0; i < missing.length; i += 700) {
    const chunk = missing.slice(i, i + 700);
    const r = await task("dataforseo_labs/google/keyword_overview/live", { keywords: chunk, location_code: m.location, language_code: m.language, include_serp_info: true }, cost);
    const found = new Map(((r.items ?? []) as Info[]).map((x) => [String(x.keyword).toLowerCase(), toSummary(x)]));
    await Promise.all(
      chunk.map(async (k) => {
        const s = found.get(k) ?? null;
        out.set(k, s);
        await writeCache(`ov:${m.location}:${m.language}:${k}`, s);
      }),
    );
  }
  return out;
}

async function suggestions(keyword: string, m: Market, questions: boolean, cost: { total: number }, limit = 100): Promise<KwList> {
  const { data } = await cached<KwList>(`${questions ? "q" : "sug"}:${limit}:${m.location}:${m.language}:${keyword}`, 30 * DAY, async () => {
    const r = await task(
      "dataforseo_labs/google/keyword_suggestions/live",
      {
        keyword,
        location_code: m.location,
        language_code: m.language,
        limit,
        include_serp_info: true,
        order_by: ["keyword_info.search_volume,desc"],
        ...(questions ? { filters: ["keyword", "regex", QUESTION] } : {}),
      },
      cost,
    );
    const rows = ((r.items ?? []) as Info[]).map(toSummary).filter((x): x is KwSummary => Boolean(x));
    return { total: Number(r.total_count ?? rows.length), volume: rows.reduce((n, x) => n + (x.volume ?? 0), 0), rows };
  });
  return data;
}

type SerpItem = {
  type?: string;
  rank_group?: number;
  url?: string;
  domain?: string;
  title?: string;
  rating?: { value?: number } | null;
  links?: unknown[] | null;
  items?: SerpItem[];
  references?: { url?: string; domain?: string; title?: string }[];
};

async function serp(keyword: string, m: Market, device: string, cost: { total: number }): Promise<KwSerp> {
  const { data } = await cached<KwSerp>(`serp:${m.location}:${m.language}:${device}:${keyword}`, 7 * DAY, async () => {
    const r = await task(
      "serp/google/organic/live/advanced",
      { keyword, location_code: m.location, language_code: m.language, device, depth: 20, load_async_ai_overview: true },
      cost,
    );
    const items: SerpItem[] = r.items ?? [];
    const aio = items.find((i) => i.type === "ai_overview");
    const refs = [...(aio?.references ?? []), ...(aio?.items ?? []).flatMap((i) => i.references ?? [])].filter((x) => x.url);
    const cites = [...new Map(refs.map((x) => [x.url!, { url: x.url!, domain: (x.domain ?? "").replace(/^www\./, ""), title: x.title ?? "" }])).values()];
    const citedDomains = new Set(cites.map((c) => c.domain));
    const local = items.filter((i) => i.type === "local_pack").map((i) => ({ title: i.title ?? "", domain: (i.domain ?? "").replace(/^www\./, ""), rating: i.rating?.value ?? null }));
    return {
      features: [...new Set(((r.item_types as string[]) ?? items.map((i) => i.type ?? "")).filter((t) => t && t !== "organic"))],
      ads: items.filter((i) => i.type === "paid").length,
      results: r.se_results_count ?? null,
      aio: { shown: Boolean(aio), cites },
      local,
      rows: items
        .filter((i) => i.type === "organic" && i.url)
        .slice(0, 20)
        .map((i) => {
          const domain = (i.domain ?? "").replace(/^www\./, "");
          return { rank: i.rank_group ?? 0, url: i.url!, domain, title: i.title ?? "", sitelinks: Boolean(i.links?.length), traffic: null, keywords: null, aiCited: citedDomains.has(domain) };
        }),
    };
  });
  return data;
}

/** Estimated monthly search traffic and keyword count for each ranking page, one call for all of them. */
async function traffic(urls: string[], m: Market, cost: { total: number }) {
  const { data } = await cached<Record<string, { etv: number; count: number }>>(`trf:${m.location}:${urls.join("|")}`, 30 * DAY, async () => {
    const r = await task("dataforseo_labs/google/bulk_traffic_estimation/live", { targets: urls, location_code: m.location, language_code: m.language, item_types: ["organic"] }, cost);
    type T = { target?: string; metrics?: { organic?: { etv?: number; count?: number } } };
    return Object.fromEntries(((r.items ?? []) as T[]).map((t) => [t.target ?? "", { etv: Math.round(t.metrics?.organic?.etv ?? 0), count: t.metrics?.organic?.count ?? 0 }]));
  });
  return data;
}

export async function keywordReport(keyword: string, country: string, device: "desktop" | "mobile"): Promise<KeywordReport> {
  const kw = keyword.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
  const m = MARKETS[country] ?? MARKETS["United States"];
  const cost = { total: 0 };
  const countries = [...new Set([country === "Global" ? "United States" : country, ...TOP_MARKETS])].filter((c) => MARKETS[c]).slice(0, 6);

  const [main, others, variations, questions, google] = await Promise.all([
    overviewMany([kw], m, cost),
    Promise.all(countries.map(async (c) => ({ country: c, volume: (await overviewMany([kw], MARKETS[c], cost).catch(() => new Map())).get(kw)?.volume ?? null }))),
    suggestions(kw, m, false, cost).catch(() => ({ total: 0, volume: 0, rows: [] })),
    suggestions(kw, m, true, cost).catch(() => ({ total: 0, volume: 0, rows: [] })),
    serp(kw, m, device, cost).catch((e) => {
      console.error("Keyword SERP failed:", e instanceof Error ? e.message : e);
      return null;
    }),
  ]);
  if (google?.rows.length) {
    const t = await traffic(google.rows.map((r) => r.url), m, cost).catch(() => ({}) as Record<string, { etv: number; count: number }>);
    google.rows = google.rows.map((r) => ({ ...r, traffic: t[r.url]?.etv ?? null, keywords: t[r.url]?.count ?? null }));
  }
  return {
    keyword: kw,
    country,
    device,
    overview: main.get(kw) ?? null,
    byCountry: others,
    variations,
    questions,
    clusters: clustersOf([...variations.rows, ...questions.rows], kw),
    serp: google,
    cost: Math.round(cost.total * 10000) / 10000,
    cached: cost.total === 0,
  };
}

/** Bulk analysis: numbers for up to 700 keywords. */
export async function bulkReport(keywords: string[], country: string) {
  const m = MARKETS[country] ?? MARKETS["United States"];
  const cost = { total: 0 };
  const list = [...new Set(keywords.map((k) => k.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80)).filter(Boolean))].slice(0, 700);
  const map = await overviewMany(list, m, cost);
  return { rows: list.map((k) => map.get(k) ?? { keyword: k, volume: null, kd: null, cpc: null, competition: null, intent: null, otherIntents: [], trend: [], serp: [], results: null, core: null }), cost: Math.round(cost.total * 10000) / 10000 };
}

/** The full lists behind "View all". Cached 30 days. */
export const allSuggestions = (keyword: string, country: string, questions: boolean, cost: { total: number }) =>
  suggestions(keyword.trim().toLowerCase(), MARKETS[country] ?? MARKETS["United States"], questions, cost, 1000);
