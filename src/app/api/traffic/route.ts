import { requireRole } from "@/lib/serverAuth";
import { active, aiSourceOf, AI_SOURCES, metrics, series, stats, umamiReady, type Range, type Row } from "@/lib/umami";

// Everything Umami knows about one brand's website, plus visits from AI assistants. Cached for 10 minutes.
const cache = new Map<string, { at: number; data: unknown }>();

const PAGES = ["path", "url"];
// Each breakdown on the page and the names Umami uses for it.
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

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "viewer");
  if ("denied" in auth) return auth.denied;
  if (!umamiReady()) return Response.json({ error: "Website tracking is not set up yet." }, { status: 500 });
  const days = [7, 30, 60, 90].includes(Number(body.days)) ? Number(body.days) : 30;

  const { data: brand, error } = await auth.sb
    .from("brands")
    .select("umami_website_id")
    .eq("id", body.brandId)
    .eq("workspace_id", body.workspaceId)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const id = (brand as { umami_website_id: string | null } | null)?.umami_website_id;
  if (!id) return Response.json({ error: "This brand has no website connected." }, { status: 400 });

  const key = `${id}:${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return Response.json({ ...(hit.data as object), now: await active(id).catch(() => null) });

  try {
    const now = Date.now();
    const cur: Range = { startAt: now - days * 864e5, endAt: now };
    const prev: Range = { startAt: now - 2 * days * 864e5, endAt: cur.startAt };
    const soft = <T,>(p: Promise<T>, empty: T) => p.catch(() => empty);

    const names = Object.keys(BREAKDOWNS);
    const [total, totalPrev, refsPrev, totalSeries, visitorsNow, ...lists] = await pool<unknown>([
      () => stats(id, cur),
      () => stats(id, prev),
      () => soft(metrics(id, "referrer", prev), [] as Row[]),
      () => series(id, cur),
      () => soft(active(id), null),
      ...names.map((n) => () => soft(metrics(id, BREAKDOWNS[n], cur, {}, 100), [] as Row[])),
    ]);
    const t = total as Awaited<ReturnType<typeof stats>>;
    const tp = totalPrev as Awaited<ReturnType<typeof stats>>;
    const s = totalSeries as Awaited<ReturnType<typeof series>>;
    const breakdowns = Object.fromEntries(names.map((n, i) => [n, (lists[i] as Row[]).map((r) => ({ x: r.x ?? "", y: r.y }))]));
    const refs = breakdowns.referrers as Row[];

    // Visits from each AI assistant, now and in the period before.
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
    const dayKey = (x: string) => x.slice(0, 10);
    const daysMap = new Map<string, { day: string; visitors: number; pageviews: number; ai: Record<string, number> }>();
    const day = (x: string) => {
      const k = dayKey(x);
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

    const data = {
      days,
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
    cache.set(key, { at: Date.now(), data });
    return Response.json({ ...data, now: visitorsNow });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Traffic failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
