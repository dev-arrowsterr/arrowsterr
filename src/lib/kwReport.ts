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

async function suggestions(keyword: string, m: Market, questions: boolean, cost: { total: number }, limit = 20): Promise<KwList> {
  const key = `${questions ? "q2" : "sug2"}:${limit}:${m.location}:${m.language}:${keyword}`;
  const hit = await readCache<KwList>(key, 30 * DAY);
  if (hit) return hit;
  const data = await (async () => {
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
  })();
  // An empty list is not saved, so a search that finds nothing today can find something next time.
  if (data.rows.length) await writeCache(key, data);
  return data;
}

/** Words that make a search longer without changing what it is about. */
const FILLER = /\b(best|top|good|great|cheap|cheapest|affordable|the|a|an|buy|reviews?|review|near me|online|20\d\d)\b/g;

/** "best pillow for kids" → "pillow for kids". Null when nothing changes. */
export function broaderSeed(keyword: string): string | null {
  const b = keyword.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  return b && b !== keyword ? b : null;
}

/** Related ideas by topic, for searches too new or too long to have phrase matches. */
async function ideas(keyword: string, m: Market, cost: { total: number }, limit = 20): Promise<KwList> {
  const key = `ideas:${limit}:${m.location}:${m.language}:${keyword}`;
  const hit = await readCache<KwList>(key, 30 * DAY);
  if (hit) return hit;
  const r = await task(
    "dataforseo_labs/google/keyword_ideas/live",
    { keywords: [keyword], location_code: m.location, language_code: m.language, limit, include_serp_info: true, order_by: ["keyword_info.search_volume,desc"] },
    cost,
  );
  const rows = ((r.items ?? []) as Info[]).map(toSummary).filter((x): x is KwSummary => Boolean(x));
  const data = { total: Number(r.total_count ?? rows.length), volume: rows.reduce((n, x) => n + (x.volume ?? 0), 0), rows };
  if (rows.length) await writeCache(key, data);
  return data;
}

type AdsRow = { keyword?: string; search_volume?: number | null; cpc?: number | null; competition_index?: number | null; monthly_searches?: { year: number; month: number; search_volume: number | null }[] | null };

/** Google Ads numbers for searches DataForSEO Labs does not have yet (long, new or rare ones). One call for up to 1,000. */
async function adsMany(keywords: string[], m: Market, cost: { total: number }): Promise<Map<string, KwSummary | null>> {
  const out = new Map<string, KwSummary | null>();
  const missing: string[] = [];
  await Promise.all(
    keywords.map(async (k) => {
      const hit = await readCache<KwSummary | null>(`ads:${m.location}:${m.language}:${k}`, 30 * DAY);
      if (hit !== undefined) out.set(k, hit);
      else missing.push(k);
    }),
  );
  for (let i = 0; i < missing.length; i += 1000) {
    const chunk = missing.slice(i, i + 1000);
    const tasks = await call("keywords_data/google_ads/search_volume/live", [{ keywords: chunk, location_code: m.location, language_code: m.language }]);
    const t = tasks[0];
    cost.total += Number(t?.cost ?? 0);
    const rows = (t?.status_code === 20000 ? t.result ?? [] : []) as AdsRow[];
    const found = new Map(rows.filter((r) => r.keyword).map((r) => [String(r.keyword).toLowerCase(), r]));
    await Promise.all(
      chunk.map(async (k) => {
        const r = found.get(k);
        const s = r
          ? toSummary({
              keyword: k,
              keyword_info: { search_volume: r.search_volume ?? null, cpc: r.cpc ?? null, competition: r.competition_index != null ? r.competition_index / 100 : null, monthly_searches: r.monthly_searches ?? null },
            })
          : null;
        out.set(k, s);
        await writeCache(`ads:${m.location}:${m.language}:${k}`, s);
      }),
    );
  }
  return out;
}

type ClickRow = { keyword?: string; search_volume?: number | null; monthly_searches?: { year: number; month: number; search_volume: number | null }[] | null };

/** Clickstream estimates: real searches seen by panels of users, for long searches Google Ads rounds down to zero. Cached 30 days. */
async function clickstreamMany(keywords: string[], m: Market, cost: { total: number }): Promise<Map<string, KwSummary | null>> {
  const out = new Map<string, KwSummary | null>();
  const missing: string[] = [];
  await Promise.all(
    keywords.map(async (k) => {
      const hit = await readCache<KwSummary | null>(`cs:${m.location}:${m.language}:${k}`, 30 * DAY);
      if (hit !== undefined) out.set(k, hit);
      else missing.push(k);
    }),
  );
  for (let i = 0; i < missing.length; i += 1000) {
    const chunk = missing.slice(i, i + 1000);
    const tasks = await call("keywords_data/clickstream_data/dataforseo_search_volume/live", [{ keywords: chunk, location_code: m.location, language_code: m.language }]);
    const t = tasks[0];
    cost.total += Number(t?.cost ?? 0);
    const items = (t?.status_code === 20000 ? (t.result?.[0]?.items ?? t.result ?? []) : []) as ClickRow[];
    const found = new Map(items.filter((r) => r.keyword).map((r) => [String(r.keyword).toLowerCase(), r]));
    await Promise.all(
      chunk.map(async (k) => {
        const r = found.get(k);
        const s = r && r.search_volume ? toSummary({ keyword: k, keyword_info: { search_volume: r.search_volume, cpc: null, competition: null, monthly_searches: r.monthly_searches ?? null } }) : null;
        out.set(k, s);
        await writeCache(`cs:${m.location}:${m.language}:${k}`, s);
      }),
    );
  }
  return out;
}

/**
 * Fill in volume for keywords Google's keyword data has no number for: Google Ads first, then clickstream.
 * Everything else (difficulty, intent) stays from the first source.
 */
export async function fillVolume(map: Map<string, KwSummary | null>, m: Market, cost: { total: number }) {
  const gaps = [...map.entries()].filter(([, s]) => !s?.volume).map(([k]) => k);
  if (!gaps.length) return map;
  const ads = await adsMany(gaps, m, cost).catch(() => new Map<string, KwSummary | null>());
  const still = gaps.filter((k) => !ads.get(k)?.volume);
  const clicks = still.length ? await clickstreamMany(still, m, cost).catch(() => new Map<string, KwSummary | null>()) : new Map<string, KwSummary | null>();
  for (const k of gaps) {
    const base = map.get(k) ?? null;
    const a = ads.get(k)?.volume ? ads.get(k)! : null;
    const c = clicks.get(k)?.volume ? clicks.get(k)! : null;
    const extra = a ?? c;
    if (!extra) {
      if (!base && ads.get(k)) map.set(k, ads.get(k)!);
      continue;
    }
    map.set(k, {
      ...(base ?? extra),
      volume: extra.volume,
      trend: base?.trend.length ? base.trend : extra.trend,
      cpc: base?.cpc ?? a?.cpc ?? null,
      competition: base?.competition ?? a?.competition ?? null,
      source: a ? "ads" : "clickstream",
    });
  }
  return map;
}

/** Variations or questions, widening the search when the exact phrase has none. */
async function widen(kw: string, first: KwList, m: Market, questions: boolean, cost: { total: number }): Promise<KwList> {
  if (first.rows.length) return first;
  const wider = broaderSeed(kw);
  if (wider) {
    const w = await suggestions(wider, m, questions, cost).catch(() => first);
    if (w.rows.length) return w;
  }
  if (questions) return first;
  return ideas(kw, m, cost).catch(() => first);
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
      { keyword, location_code: m.location, language_code: m.language, device, depth: 10, load_async_ai_overview: true },
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
        .slice(0, 10)
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

export async function keywordReport(keyword: string, country: string, device: "desktop" | "mobile", withCountries = false): Promise<KeywordReport> {
  const kw = keyword.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
  const m = MARKETS[country] ?? MARKETS["United States"];
  const cost = { total: 0 };
  const countries = [...new Set([country === "Global" ? "United States" : country, ...TOP_MARKETS])].filter((c) => MARKETS[c]).slice(0, 6);

  const [main, others, variations, questions, google] = await Promise.all([
    overviewMany([kw], m, cost),
    // Volume in other countries costs a call each, so it only runs when asked for.
    withCountries ? Promise.all(countries.map(async (c) => ({ country: c, volume: (await overviewMany([kw], MARKETS[c], cost).catch(() => new Map())).get(kw)?.volume ?? null }))) : Promise.resolve([]),
    suggestions(kw, m, false, cost).catch(() => ({ total: 0, volume: 0, rows: [] })),
    suggestions(kw, m, true, cost).catch(() => ({ total: 0, volume: 0, rows: [] })),
    serp(kw, m, device, cost).catch((e) => {
      console.error("Keyword SERP failed:", e instanceof Error ? e.message : e);
      return null;
    }),
  ]);
  // Long or new searches are often missing from DataForSEO Labs. Fall back to Google Ads numbers and wider ideas.
  const overview = (await fillVolume(new Map([[kw, main.get(kw) ?? null]]), m, cost)).get(kw) ?? null;
  const [vars, qs] = await Promise.all([widen(kw, variations, m, false, cost), widen(kw, questions, m, true, cost)]);
  if (google?.rows.length) {
    const t = await traffic(google.rows.map((r) => r.url), m, cost).catch(() => ({}) as Record<string, { etv: number; count: number }>);
    google.rows = google.rows.map((r) => ({ ...r, traffic: t[r.url]?.etv ?? null, keywords: t[r.url]?.count ?? null }));
  }
  return {
    keyword: kw,
    country,
    device,
    overview,
    byCountry: others,
    variations: vars,
    questions: qs,
    clusters: clustersOf([...vars.rows, ...qs.rows], kw),
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
  const map = await fillVolume(await overviewMany(list, m, cost), m, cost);
  return { rows: list.map((k) => map.get(k) ?? { keyword: k, volume: null, kd: null, cpc: null, competition: null, intent: null, otherIntents: [], trend: [], serp: [], results: null, core: null }), cost: Math.round(cost.total * 10000) / 10000 };
}

/** The full lists behind "View all". Cached 30 days. */
export const allSuggestions = (keyword: string, country: string, questions: boolean, cost: { total: number }) =>
  suggestions(keyword.trim().toLowerCase(), MARKETS[country] ?? MARKETS["United States"], questions, cost, 1000);
