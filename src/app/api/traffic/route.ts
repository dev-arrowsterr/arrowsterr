import { requireRole } from "@/lib/serverAuth";
import { aiSourceOf, AI_SOURCES, metrics, series, stats, umamiReady } from "@/lib/umami";

// Visits from AI assistants for one brand's website, from Umami. Cached for 10 minutes.
const cache = new Map<string, { at: number; data: unknown }>();

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
  if (hit && Date.now() - hit.at < 10 * 60_000) return Response.json(hit.data);

  try {
    const now = Date.now();
    const cur = { startAt: now - days * 864e5, endAt: now };
    const prev = { startAt: now - 2 * days * 864e5, endAt: cur.startAt };
    const [total, totalPrev, refs, refsPrev, totalSeries] = await Promise.all([
      stats(id, cur),
      stats(id, prev),
      metrics(id, "referrer", cur),
      metrics(id, "referrer", prev),
      series(id, cur),
    ]);

    // Visits from each AI assistant, now and in the period before.
    const sum = (rows: { x: string; y: number }[]) => {
      const out: Record<string, number> = Object.fromEntries(Object.keys(AI_SOURCES).map((k) => [k, 0]));
      for (const r of rows) {
        const src = aiSourceOf(r.x ?? "");
        if (src) out[src] += r.y;
      }
      return out;
    };
    const byEngine = sum(refs);
    const byEnginePrev = sum(refsPrev);
    const aiDomains = refs.filter((r) => aiSourceOf(r.x ?? "") && r.y > 0).map((r) => r.x);

    // For each AI site that sent visits: visits per day and the pages people landed on.
    const perDomain = await Promise.all(
      aiDomains.map(async (d) => ({
        domain: d,
        engine: aiSourceOf(d)!,
        days: await series(id, cur, { referrer: d }).catch(() => []),
        pages: await metrics(id, "url", cur, { referrer: d }).catch(() => []),
      })),
    );
    const dayKey = (x: string) => x.slice(0, 10);
    const daysMap = new Map<string, { day: string; total: number; ai: Record<string, number> }>();
    for (const p of totalSeries) daysMap.set(dayKey(p.x), { day: dayKey(p.x), total: p.y, ai: {} });
    for (const d of perDomain)
      for (const p of d.days) {
        const row = daysMap.get(dayKey(p.x)) ?? { day: dayKey(p.x), total: 0, ai: {} };
        row.ai[d.engine] = (row.ai[d.engine] ?? 0) + p.y;
        daysMap.set(row.day, row);
      }
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
      visits: total.visits || total.visitors,
      visitsPrev: totalPrev.visits || totalPrev.visitors,
      pageviews: total.pageviews,
      ai: Object.values(byEngine).reduce((a, b) => a + b, 0),
      aiPrev: Object.values(byEnginePrev).reduce((a, b) => a + b, 0),
      byEngine: Object.keys(AI_SOURCES).map((engine) => ({ engine, visits: byEngine[engine], prev: byEnginePrev[engine] })),
      series: [...daysMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
      pages: [...pages.values()].sort((a, b) => b.visits - a.visits).slice(0, 50),
      topReferrers: refs.slice(0, 10).map((r) => ({ referrer: r.x || "Direct", visits: r.y, ai: aiSourceOf(r.x ?? "") })),
    };
    cache.set(key, { at: Date.now(), data });
    return Response.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Traffic failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
