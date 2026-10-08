import { cached, DAY } from "@/lib/cache";
import { dfsReady } from "@/lib/dataforseo";
import { competitors, domainOverview, research, Spend } from "@/lib/keywords";
import { MARKETS, pagesOf, type DomainReport } from "@/lib/research";
import { requireRole } from "@/lib/serverAuth";
import { normalizeSite } from "@/lib/site";

// Domain research: how big a site is on Google, its top keywords and pages, and its competitors.
// Shared and cached for 30 days, so the same domain again is free.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  if (!dfsReady()) return Response.json({ error: "DataForSEO is not set up. Add DFS_LOGIN and DFS_PASSWORD on Render." }, { status: 500 });
  const domain = normalizeSite(String(body.domain ?? ""))?.domain;
  if (!domain) return Response.json({ error: "Enter a domain, like acme.com." }, { status: 400 });
  const country = MARKETS[body.country] ? String(body.country) : "United States";
  const m = MARKETS[country];

  try {
    const spend = new Spend();
    const key = (part: string) => `dom:${part}:${m.location}:${m.language}:${domain}`;
    const [overview, keywords, rivals] = await Promise.all([
      cached(key("ov"), 30 * DAY, () => domainOverview(domain, m, spend)).then((r) => r.data).catch(() => null),
      cached(key("kw"), 30 * DAY, () => research("ranked", domain, m, spend, 300)).then((r) => r.data),
      cached(key("comp"), 30 * DAY, () => competitors(domain, m, spend, 15)).then((r) => r.data).catch(() => []),
    ]);
    const report: DomainReport = {
      domain,
      country,
      overview,
      keywords,
      pages: pagesOf(keywords).slice(0, 100),
      competitors: rivals,
      cost: Math.round(spend.total * 10000) / 10000,
      cached: spend.total === 0,
    };
    return Response.json(report);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Domain research failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
