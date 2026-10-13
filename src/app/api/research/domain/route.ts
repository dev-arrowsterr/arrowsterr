import type { SupabaseClient } from "@supabase/supabase-js";
import { cached, DAY } from "@/lib/cache";
import { dfsReady, NOT_SAVED, savedOnly } from "@/lib/dataforseo";
import { saveBulkRun } from "@/lib/bulkRuns";
import { bulkDomains, competitors, domainOverview, parseTarget, rankedFor, Spend, targetLabel, type Scope } from "@/lib/keywords";
import { BULK_LIMIT, bulkList, MARKETS, pagesOf, type DomainBulkRow, type DomainReport } from "@/lib/research";
import { scopeOf } from "@/lib/scope";
import { isEditor, requireRole } from "@/lib/serverAuth";
import { meteredRoute } from "@/lib/meter";
import { requireTrack, take } from "@/lib/entitlements";
import { TASK_COST } from "@/lib/plans";

// Domain research: how big a domain, subdomain, folder or page is on Google, its top keywords and pages, and its competitors.
// Shared and cached for 30 days, so the same domain again is free.
// Editors run lookups, which can cost money. Viewers opening a shared link see saved results only.
//   { domain, scope, country, more? }  one site in depth
//   { action: "bulk", targets: string[], country, siteId }  up to 500 sites or pages side by side (editors only; saved with its own link)
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "viewer");
  if ("denied" in auth) return auth.denied;
  const [editor, paid] = await Promise.all([isEditor(auth.sb, body.workspaceId), requireTrack(body.workspaceId, "seo")]);
  if (paid) return paid;
  if (body.action === "bulk") {
    if (!editor) return Response.json({ error: "You need editor access in this workspace to run a bulk analysis." }, { status: 403 });
    return bulk(auth.sb, body);
  }
  if (editor) {
    const took = await take(body.workspaceId, "tasks", TASK_COST.domain);
    if (!took.ok) return took.response;
  }
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
    // Viewers only read what is saved: the keywords must be there, the rest may come back empty.
    const run = async <T>(fn: () => Promise<T>): Promise<T> => {
      if (editor) return fn();
      const r = await savedOnly(fn);
      if (r.data === null) throw new Error(NOT_SAVED);
      return r.data;
    };
    const [ranked, overview, rivals] = await run(() => Promise.all([
      // 100 keywords up front. "Load more" asks for 500, cached separately.
      cached(key(more ? "kw500" : "kw"), 30 * DAY, () => rankedFor(target, m, spend, more ? 500 : 100)).then((r) => r.data),
      // A subdomain, folder or page gets its size from the ranked keywords call.
      whole ? cached(key("ov"), 30 * DAY, () => domainOverview(target.host, m, spend)).then((r) => r.data).catch(() => null) : null,
      cached(`dom:comp:${m.location}:${m.language}:${target.host}`, 30 * DAY, () => competitors(target.host, m, spend, 10)).then((r) => r.data).catch(() => []),
    ]));
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
    if (message === NOT_SAVED) return Response.json({ error: message, notSaved: true }, { status: 404 });
    console.error("Domain research failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

/** A typed site or page as a bulk target: bare for domains and subdomains, a full link for pages and folders. */
function bulkTarget(input: string): { target: string; kind: DomainBulkRow["kind"] } | null {
  const scope = scopeOf(input);
  if (!scope) return null;
  const t = parseTarget(input, scope);
  if (!t) return null;
  if (scope === "domain") return { target: t.host, kind: "domain" };
  if (scope === "subdomain") return { target: t.host, kind: "subdomain" };
  return { target: `https://${t.host}${t.path}`, kind: "page" };
}

async function bulk(sb: SupabaseClient, body: { workspaceId: string; targets?: unknown; country?: string; siteId?: unknown }) {
  const lines = bulkList(Array.isArray(body.targets) ? body.targets.map(String) : String(body.targets ?? ""));
  const targets = [...new Map(lines.map(bulkTarget).filter((t): t is NonNullable<typeof t> => Boolean(t)).map((t) => [t.target, t])).values()];
  const skipped = lines.length - targets.length;
  if (!targets.length) return Response.json({ error: "Paste at least one site, like acme.com, one per line." }, { status: 400 });
  if (targets.length > BULK_LIMIT) return Response.json({ error: `Up to ${BULK_LIMIT} sites at a time. This list has ${targets.length}.` }, { status: 400 });
  const took = await take(body.workspaceId, "tasks", TASK_COST.bulk(targets.length));
  if (!took.ok) return took.response;
  if (!dfsReady()) return Response.json({ error: "DataForSEO is not set up. Add DFS_LOGIN and DFS_PASSWORD on Render." }, { status: 500 });
  const country = body.country && MARKETS[body.country] ? body.country : "United States";
  try {
    const spend = new Spend();
    const rows = await bulkDomains(targets, MARKETS[country], spend);
    const result = { rows, country, skipped, cost: Math.round(spend.total * 10000) / 10000 };
    const id = await saveBulkRun(sb, { workspaceId: body.workspaceId, siteId: body.siteId, kind: "domains", country, items: lines, result });
    return Response.json({ ...result, id });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Bulk domain analysis failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("domain research", handle);
