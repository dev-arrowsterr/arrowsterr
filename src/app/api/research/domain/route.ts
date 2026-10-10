import { cached, DAY } from "@/lib/cache";
import { dfsReady } from "@/lib/dataforseo";
import { competitors, domainOverview, parseTarget, rankedFor, Spend, targetLabel, type Scope } from "@/lib/keywords";
import { MARKETS, pagesOf, type DomainReport } from "@/lib/research";
import { requireRole } from "@/lib/serverAuth";
import { meteredRoute } from "@/lib/meter";
import { requireTrack, take } from "@/lib/entitlements";
import { TASK_COST } from "@/lib/plans";

// Domain research: how big a domain, subdomain, folder or page is on Google, its top keywords and pages, and its competitors.
// Shared and cached for 30 days, so the same domain again is free.
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const paid = await requireTrack(body.workspaceId, "seo");
  if (paid) return paid;
  const took = await take(body.workspaceId, "tasks", TASK_COST.domain);
  if (!took.ok) return took.response;
  if (!dfsReady()) return Response.json({ error: "DataForSEO is not set up. Add DFS_LOGIN and DFS_PASSWORD on Render." }, { status: 500 });
  const scope: Scope = ["domain", "subdomain", "subfolder", "url"].includes(body.scope) ? body.scope : "domain";
  const target = parseTarget(String(body.domain ?? ""), scope);
  if (!target) {
    const hint = { domain: "a domain, like acme.com", subdomain: "a subdomain, like blog.acme.com", subfolder: "a folder, like acme.com/blog", url: "a page, like acme.com/pricing" }[scope];
    return Response.json({ error: `Enter ${hint}.` }, { status: 400 });
  }
  const domain = targetLabel(target);
  const country = MARKETS[body.country] ? String(body.country) : "United States";
  const m = MARKETS[country];
  const more = Boolean(body.more);

  try {
    const spend = new Spend();
    const key = (part: string) => `dom:${scope}:${part}:${m.location}:${m.language}:${domain}`;
    const whole = scope === "domain";
    const [ranked, overview, rivals] = await Promise.all([
      // 100 keywords up front. "Load more" asks for 500, cached separately.
      cached(key(more ? "kw500" : "kw"), 30 * DAY, () => rankedFor(target, m, spend, more ? 500 : 100)).then((r) => r.data),
      // A subdomain, folder or page gets its size from the ranked keywords call.
      whole ? cached(key("ov"), 30 * DAY, () => domainOverview(target.host, m, spend)).then((r) => r.data).catch(() => null) : null,
      cached(`dom:comp:${m.location}:${m.language}:${target.host}`, 30 * DAY, () => competitors(target.host, m, spend, 10)).then((r) => r.data).catch(() => []),
    ]);
    const keywords = ranked.keywords;
    const report: DomainReport = {
      domain,
      scope,
      country,
      overview: overview ?? ranked.overview,
      keywords,
      more,
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

export const POST = meteredRoute("domain research", handle);
