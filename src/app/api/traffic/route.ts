import { ga4Traffic } from "@/lib/ga4";
import { accessToken } from "@/lib/google";
import { adminClient, requireRole } from "@/lib/serverAuth";
import { umamiNow, umamiTraffic } from "@/lib/traffic";
import { active, umamiReady, type Range } from "@/lib/umami";

// Everything Umami knows about one brand's website, plus visits from AI assistants. Cached for 10 minutes.
const cache = new Map<string, { at: number; data: unknown }>();

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "viewer");
  if ("denied" in auth) return auth.denied;
  const days = [7, 30, 60, 90].includes(Number(body.days)) ? Number(body.days) : 30;

  // Google Analytics, when the brand has a property picked. Cached for 10 minutes, like Umami.
  const { data: g } = await auth.sb.from("brands").select("ga4_property").eq("id", body.brandId).eq("workspace_id", body.workspaceId).maybeSingle();
  const property = (g as { ga4_property: string | null } | null)?.ga4_property;
  if (property) {
    const key = `ga4:${property}:${days}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) return Response.json(hit.data);
    try {
      const { data: conn } = (await adminClient()?.from("ga4_connections").select("refresh_token").eq("brand_id", body.brandId).maybeSingle()) ?? { data: null };
      if (!conn) return Response.json({ error: "Reconnect Google Analytics." }, { status: 400 });
      const data = await ga4Traffic(await accessToken(conn.refresh_token), property, days);
      cache.set(key, { at: Date.now(), data });
      return Response.json(data);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("GA4 traffic failed:", message);
      return Response.json({ error: message }, { status: 500 });
    }
  }
  if (!umamiReady()) return Response.json({ error: "Website tracking is not set up yet." }, { status: 500 });

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
    const [data, visitorsNow] = await Promise.all([umamiTraffic(id, cur, prev), umamiNow(id)]);
    cache.set(key, { at: Date.now(), data });
    return Response.json({ ...data, now: visitorsNow });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Traffic failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
