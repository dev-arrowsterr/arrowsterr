import { cached, DAY } from "@/lib/cache";
import { call, dfsReady } from "@/lib/dataforseo";
import { competitors, Spend } from "@/lib/keywords";
import { marketOf } from "@/lib/research";
import { requireRole } from "@/lib/serverAuth";
import { normalizeSite } from "@/lib/site";
import { meteredRoute } from "@/lib/meter";
import { take } from "@/lib/entitlements";
import type { Gap, GapRow } from "@/lib/gap";


type Serp = { rank_group?: number | null; url?: string | null };
type Item = {
  keyword_data?: {
    keyword?: string;
    keyword_info?: { search_volume?: number | null };
    keyword_properties?: { keyword_difficulty?: number | null };
    search_intent_info?: { main_intent?: string | null };
  };
  first_domain_serp_element?: Serp | null;
  second_domain_serp_element?: Serp | null;
};

/** Keywords target1 ranks for, with (intersections) or without target2 ranking too. */
async function intersect(target1: string, target2: string, both: boolean, m: { location: number; language: string }, spend: Spend) {
  const tasks = await call("dataforseo_labs/google/domain_intersection/live", [
    {
      target1,
      target2,
      intersections: both,
      location_code: m.location,
      language_code: m.language,
      limit: 300,
      order_by: ["keyword_data.keyword_info.search_volume,desc"],
    },
  ]);
  spend.add(tasks);
  const t = tasks[0];
  if (t?.status_code !== 20000) throw new Error(`DataForSEO: ${t?.status_message ?? "no result"}`);
  const r = t.result?.[0] ?? {};
  return { total: Number(r.total_count ?? 0), items: (r.items ?? []) as Item[] };
}

const row = (i: Item, flip: boolean): GapRow | null => {
  const k = i.keyword_data;
  if (!k?.keyword) return null;
  const a = i.first_domain_serp_element;
  const b = i.second_domain_serp_element;
  const them = flip ? b : a;
  const you = flip ? a : b;
  return {
    keyword: k.keyword,
    volume: k.keyword_info?.search_volume ?? null,
    kd: k.keyword_properties?.keyword_difficulty ?? null,
    intent: k.search_intent_info?.main_intent ?? null,
    them: them?.rank_group ?? null,
    you: you?.rank_group ?? null,
    url: them?.url ?? null,
  };
};
const rows = (items: Item[], flip: boolean) => items.map((i) => row(i, flip)).filter((r): r is GapRow => Boolean(r));

// Competitive analysis: the keyword gap between the site and one competitor, and suggested competitors.
//   gap: { siteId, competitor }
//   rivals: { siteId }
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  if (!dfsReady()) return Response.json({ error: "DataForSEO is not set up. Add DFS_LOGIN and DFS_PASSWORD on Render." }, { status: 500 });

  const { data: site, error } = await auth.sb.from("sites").select("domain, profile").eq("id", body.siteId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!site) return Response.json({ error: "Website not found." }, { status: 404 });
  const you = normalizeSite(site.domain)?.domain ?? site.domain;
  const m = marketOf((site.profile as { country?: string })?.country);
  const spend = new Spend();

  try {
    if (body.action === "rivals") {
      const { data } = await cached(`rivals:${m.location}:${m.language}:${you}`, 30 * DAY, () => competitors(you, m, spend, 8));
      return Response.json({ rivals: data.map((c) => c.domain).filter((d) => d !== you), cost: spend.total });
    }

    const them = normalizeSite(String(body.competitor ?? ""))?.domain;
    if (!them) return Response.json({ error: "Enter a competitor's domain, like acme.com." }, { status: 400 });
    if (them === you) return Response.json({ error: "Pick a different domain from your own." }, { status: 400 });
    const took = await take(body.workspaceId, "research");
    if (!took.ok) return took.response;

    const key = `gap:${m.location}:${m.language}:${you}:${them}`;
    const { data } = await cached<Gap>(key, 30 * DAY, async () => {
      const [missing, shared, only] = await Promise.all([intersect(them, you, false, m, spend), intersect(them, you, true, m, spend), intersect(you, them, false, m, spend)]);
      return {
        missing: rows(missing.items, false),
        shared: rows(shared.items, false),
        only: rows(only.items, true),
        totals: { missing: missing.total, shared: shared.total, only: only.total },
      };
    });
    return Response.json({ gap: data, you, them, cost: spend.total });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Keyword gap failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("keyword gap", handle);
