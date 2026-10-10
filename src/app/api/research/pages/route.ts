import { cached, DAY } from "@/lib/cache";
import { dfsReady } from "@/lib/dataforseo";
import { parseTarget, rankedFor, relevantPages, Spend } from "@/lib/keywords";
import { marketOf, type PagePerf } from "@/lib/research";
import { requireRole } from "@/lib/serverAuth";
import { normalizeSite } from "@/lib/site";
import { meteredRoute } from "@/lib/meter";
import { requirePaid, take } from "@/lib/entitlements";
import { TASK_COST } from "@/lib/plans";

const strip = (u: string) => u.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

// How every page of the brand's website performs on Google right now: visits, keywords and its best keyword.
// Cached 7 days and shared, so a second look is free.
//   { siteId }
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const paid = await requirePaid(body.workspaceId);
  if (paid) return paid;
  if (!dfsReady()) return Response.json({ error: "DataForSEO is not set up. Add DFS_LOGIN and DFS_PASSWORD on Render." }, { status: 500 });

  const { data: site, error } = await auth.sb.from("sites").select("domain, profile").eq("id", body.siteId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!site) return Response.json({ error: "Website not found." }, { status: 404 });
  const domain = normalizeSite(site.domain)?.domain ?? site.domain;
  const target = parseTarget(domain, "domain");
  if (!target) return Response.json({ error: "This website's address is not valid." }, { status: 400 });
  const m = marketOf((site.profile as { country?: string })?.country);
  const took = await take(body.workspaceId, "tasks", TASK_COST.pages, { refundIfFree: true });
  if (!took.ok) return took.response;

  try {
    const spend = new Spend();
    const { data } = await cached<PagePerf[]>(`pages:${m.location}:${m.language}:${domain}`, 7 * DAY, async () => {
      const [pages, ranked] = await Promise.all([relevantPages(domain, m, spend), rankedFor(target, m, spend, 1000)]);
      // The keyword that brings each page the most visits.
      const best = new Map<string, { keyword: string; rank: number | null; volume: number | null; etv: number }>();
      for (const k of ranked.keywords) {
        if (!k.url) continue;
        const key = strip(k.url);
        const etv = k.etv ?? 0;
        if (!best.has(key) || etv > best.get(key)!.etv) best.set(key, { keyword: k.keyword, rank: k.rank ?? null, volume: k.volume ?? null, etv });
      }
      return pages.map((p) => {
        const b = best.get(strip(p.url));
        return { ...p, topKeyword: b?.keyword ?? null, topRank: b?.rank ?? null, topVolume: b?.volume ?? null };
      });
    });
    return Response.json({ pages: data, domain, cost: spend.total });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Site pages failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("site pages", handle);
