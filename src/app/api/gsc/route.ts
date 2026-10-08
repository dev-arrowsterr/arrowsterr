import { accessFor, forget, gscReady, properties, query } from "@/lib/gsc";
import { adminClient, requireRole } from "@/lib/serverAuth";

// Search Console for one website.
//   status (viewer): is it set up and connected, and to which property.
//   properties / pick / disconnect (editor): choose the property, or remove the connection.
//   report (viewer): clicks, impressions, CTR and position, by day, query and page. Cached 30 minutes.
const cache = new Map<string, { at: number; data: unknown }>();
const EDIT = ["properties", "pick", "disconnect"];

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "status");
  const auth = await requireRole(request, body.workspaceId, EDIT.includes(action) ? "editor" : "viewer");
  if ("denied" in auth) return auth.denied;

  const { data: site, error } = await auth.sb
    .from("sites")
    .select("id, domain, gsc_property, gsc_email")
    .eq("id", body.siteId)
    .eq("workspace_id", body.workspaceId)
    .maybeSingle();
  if (error) return Response.json({ error: error.message + (/gsc_/.test(error.message) ? " Run supabase/008_search_console.sql in Supabase." : "") }, { status: 500 });
  if (!site) return Response.json({ error: "Website not found." }, { status: 404 });

  try {
    if (action === "status") {
      const db = adminClient();
      const row = db ? (await db.from("gsc_connections").select("site_id").eq("site_id", site.id).maybeSingle()).data : null;
      return Response.json({ configured: gscReady(), connected: Boolean(row), property: site.gsc_property, email: site.gsc_email });
    }
    if (action === "properties") return Response.json({ properties: await properties(await accessFor(site.id)) });
    if (action === "pick") {
      const list = await properties(await accessFor(site.id));
      if (!list.some((p) => p.siteUrl === body.property)) return Response.json({ error: "That property is not in this Google account." }, { status: 400 });
      const res = await auth.sb.from("sites").update({ gsc_property: body.property }).eq("id", site.id);
      if (res.error) throw new Error(res.error.message);
      return Response.json({ property: body.property });
    }
    if (action === "disconnect") {
      const db = adminClient();
      if (!db) throw new Error("SUPABASE_SECRET_KEY is missing on Render.");
      await db.from("gsc_connections").delete().eq("site_id", site.id);
      await auth.sb.from("sites").update({ gsc_property: null, gsc_email: null }).eq("id", site.id);
      forget(site.id);
      return Response.json({ connected: false });
    }

    // report
    if (!site.gsc_property) return Response.json({ error: "Pick a Search Console property first." }, { status: 400 });
    const days = [7, 28, 90, 180].includes(Number(body.days)) ? Number(body.days) : 28;
    const key = `${site.id}:${site.gsc_property}:${days}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 30 * 60_000) return Response.json(hit.data);

    const p = site.gsc_property;
    const [total, totalPrev, series, queries, pages, pagesPrev, pairs] = await Promise.all([
      query(site.id, p, { days, dimensions: [] }),
      query(site.id, p, { days, offset: days, dimensions: [] }),
      query(site.id, p, { days, dimensions: ["date"] }),
      query(site.id, p, { days, dimensions: ["query"], limit: 2000 }),
      query(site.id, p, { days, dimensions: ["page"], limit: 2000 }),
      query(site.id, p, { days, offset: days, dimensions: ["page"], limit: 2000 }),
      query(site.id, p, { days, dimensions: ["page", "query"], limit: 10000 }),
    ]);
    const sum = (r: { clicks: number; impressions: number; ctr: number; position: number } | undefined) =>
      r ? { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position } : { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    const prevByPage = new Map(pagesPrev.map((r) => [r.keys[0], r]));
    const data = {
      days,
      property: p,
      totals: sum(total[0]),
      totalsPrev: sum(totalPrev[0]),
      series: series.map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
      queries: queries.map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
      pages: pages.map((r) => {
        const b = prevByPage.get(r.keys[0]);
        return { page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position, prevClicks: b?.clicks ?? 0, prevPosition: b?.position ?? null };
      }),
      pairs: pairs.map((r) => ({ page: r.keys[0], query: r.keys[1], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    };
    cache.set(key, { at: Date.now(), data });
    return Response.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Search Console failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
