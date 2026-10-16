import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ga4Traffic } from "./ga4";
import { accessToken } from "./google";
import { summarize, type Step, type Visitor } from "./journey";
import { adminClient } from "./serverAuth";
import { active, activity, aiSourceOf, AI_SOURCES, events, metrics, series, sessions, stats, umamiReady, type Activity, type Range, type Row } from "./umami";

// A brand's website traffic and visitors for any time span, from Google Analytics or Umami.
// The Traffic and Visitors pages ask for the last N days; reports ask for exact dates.

const PAGES = ["path", "url"];
// Each breakdown on the Traffic page and the names Umami uses for it.
const BREAKDOWNS: Record<string, string[]> = {
  pages: PAGES,
  entry: ["entry"],
  exit: ["exit"],
  titles: ["title"],
  referrers: ["referrer"],
  channels: ["channel"],
  queries: ["query"],
  countries: ["country"],
  regions: ["region"],
  cities: ["city"],
  browsers: ["browser"],
  os: ["os"],
  devices: ["device"],
  screens: ["screen"],
  languages: ["language"],
  events: ["event"],
};

/** Run jobs a few at a time so Umami doesn't turn us away. */
async function pool<T>(jobs: (() => Promise<T>)[], size = 6): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        out[i] = await jobs[i]();
      }
    }),
  );
  return out;
}

/** Everything Umami knows about one website in a span, plus visits from AI assistants, compared with an earlier span. */
export async function umamiTraffic(id: string, cur: Range, prev: Range) {
  const soft = <T>(p: Promise<T>, empty: T) => p.catch(() => empty);
  const names = Object.keys(BREAKDOWNS);
  const [total, totalPrev, refsPrev, totalSeries, ...lists] = await pool<unknown>([
    () => stats(id, cur),
    () => stats(id, prev),
    () => soft(metrics(id, "referrer", prev), [] as Row[]),
    () => series(id, cur),
    ...names.map((n) => () => soft(metrics(id, BREAKDOWNS[n], cur, {}, 100), [] as Row[])),
  ]);
  const t = total as Awaited<ReturnType<typeof stats>>;
  const tp = totalPrev as Awaited<ReturnType<typeof stats>>;
  const s = totalSeries as Awaited<ReturnType<typeof series>>;
  const breakdowns = Object.fromEntries(names.map((n, i) => [n, (lists[i] as Row[]).map((r) => ({ x: r.x ?? "", y: r.y }))]));
  const refs = breakdowns.referrers as Row[];

  // Visits from each AI assistant, now and in the span before.
  const sum = (rows: Row[]) => {
    const out: Record<string, number> = Object.fromEntries(Object.keys(AI_SOURCES).map((k) => [k, 0]));
    for (const r of rows) {
      const src = aiSourceOf(r.x ?? "");
      if (src) out[src] += r.y;
    }
    return out;
  };
  const byEngine = sum(refs);
  const byEnginePrev = sum(refsPrev as Row[]);
  const aiDomains = refs.filter((r) => aiSourceOf(r.x ?? "") && r.y > 0).map((r) => r.x);

  // For each AI site that sent visits: visits per day and the pages people landed on.
  const perDomain = await pool(
    aiDomains.map((d) => async () => ({
      domain: d,
      engine: aiSourceOf(d)!,
      days: await soft(series(id, cur, { referrer: d }).then((x) => x.visitors), [] as Row[]),
      pages: await soft(metrics(id, PAGES, cur, { referrer: d }), [] as Row[]),
    })),
  );
  const daysMap = new Map<string, { day: string; visitors: number; pageviews: number; ai: Record<string, number> }>();
  const day = (x: string) => {
    const k = x.slice(0, 10);
    const row = daysMap.get(k) ?? { day: k, visitors: 0, pageviews: 0, ai: {} };
    daysMap.set(k, row);
    return row;
  };
  for (const p of s.visitors) day(p.x).visitors = p.y;
  for (const p of s.pageviews) day(p.x).pageviews = p.y;
  for (const d of perDomain) for (const p of d.days) day(p.x).ai[d.engine] = (day(p.x).ai[d.engine] ?? 0) + p.y;
  const pages = new Map<string, { path: string; visits: number; engines: Record<string, number> }>();
  for (const d of perDomain)
    for (const p of d.pages) {
      const row = pages.get(p.x) ?? { path: p.x, visits: 0, engines: {} };
      row.visits += p.y;
      row.engines[d.engine] = (row.engines[d.engine] ?? 0) + p.y;
      pages.set(p.x, row);
    }

  return {
    days: Math.round((cur.endAt - cur.startAt) / 864e5),
    totals: t,
    totalsPrev: tp,
    visits: t.visits || t.visitors,
    visitsPrev: tp.visits || tp.visitors,
    ai: Object.values(byEngine).reduce((a, b) => a + b, 0),
    aiPrev: Object.values(byEnginePrev).reduce((a, b) => a + b, 0),
    byEngine: Object.keys(AI_SOURCES).map((engine) => ({ engine, visits: byEngine[engine], prev: byEnginePrev[engine] })),
    series: [...daysMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
    pages: [...pages.values()].sort((a, b) => b.visits - a.visits).slice(0, 50),
    breakdowns,
  };
}

export const umamiNow = (id: string) => active(id).catch(() => null);

/** Exact spans for a report: days as YYYY-MM-DD, and the same spans as moments for Umami. */
export type Span = { start: string; end: string; startAt: number; endAt: number };

const cache = new Map<string, { at: number; data: unknown }>();
const remember = async <T>(key: string, ms: number, make: () => Promise<T>): Promise<T> => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.data as T;
  const data = await make();
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return data;
};

/**
 * A brand's traffic for a report span, from Google Analytics when a property is picked, else Umami.
 * Null when the brand has no website connected. Cached for 10 minutes.
 */
export async function brandTraffic(db: SupabaseClient, brandId: string, cur: Span, prev: Span | null) {
  const { data: b } = await db.from("brands").select("ga4_property, umami_website_id").eq("id", brandId).maybeSingle();
  const brand = b as { ga4_property?: string | null; umami_website_id?: string | null } | null;
  const before = prev ?? { start: cur.start, end: cur.start, startAt: cur.startAt, endAt: cur.startAt };
  if (brand?.ga4_property) {
    const property = brand.ga4_property;
    return remember(`ga4:${property}:${cur.start}:${cur.end}:${before.start}:${before.end}`, 10 * 60_000, async () => {
      const { data: conn } = (await adminClient()?.from("ga4_connections").select("refresh_token").eq("brand_id", brandId).maybeSingle()) ?? { data: null };
      if (!conn) throw new Error("Reconnect Google Analytics.");
      return ga4Traffic(await accessToken(conn.refresh_token), property, { cur: [cur.start, cur.end], prev: [before.start, before.end] });
    });
  }
  const id = brand?.umami_website_id;
  if (!id || !umamiReady()) return null;
  return remember(`umami:${id}:${cur.startAt}:${cur.endAt}:${before.startAt}:${before.endAt}`, 10 * 60_000, () => umamiTraffic(id, { startAt: cur.startAt, endAt: cur.endAt }, { startAt: before.startAt, endAt: before.endAt }));
}

const toStep = (a: Activity): Step => ({ at: a.at, visitId: a.visitId, path: a.path, query: a.query, referrer: a.referrer, title: a.title, event: a.event });

async function each<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/** Every visitor to a website in a span, with a fun name, source, actions and buyer score. */
export async function umamiVisitors(id: string, domain: string, range: Range): Promise<{ visitors: Visitor[]; detail: "all" | "recent" }> {
  const list = await sessions(id, range, 500);
  const bySession = new Map<string, Step[]>();
  let detail: "all" | "recent" = "all";
  try {
    for (const a of await events(id, range)) if (a.sessionId) bySession.set(a.sessionId, [...(bySession.get(a.sessionId) ?? []), toStep(a)]);
  } catch {
    // This Umami has no event list. Read the 150 most recent visitors one by one.
    detail = "recent";
    await each(list.slice(0, 150), 6, async (s) => {
      bySession.set(s.id, (await activity(id, s.id, range).catch(() => [])).map(toStep));
    });
  }
  return { visitors: list.map((s) => summarize(s, bySession.get(s.id) ?? [], domain)), detail };
}

/** A brand's visitors for a report span. Null when the website isn't connected to Umami. Cached for 10 minutes. */
export async function brandVisitors(db: SupabaseClient, brandId: string, cur: Span): Promise<Visitor[] | null> {
  if (!umamiReady()) return null;
  const { data: b } = await db.from("brands").select("domain, umami_website_id").eq("id", brandId).maybeSingle();
  const brand = b as { domain: string; umami_website_id: string | null } | null;
  if (!brand?.umami_website_id) return null;
  const id = brand.umami_website_id;
  return remember(`visitors:${id}:${cur.startAt}:${cur.endAt}`, 10 * 60_000, async () => (await umamiVisitors(id, brand.domain, { startAt: cur.startAt, endAt: cur.endAt })).visitors);
}
