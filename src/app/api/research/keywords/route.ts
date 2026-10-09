import { cached, DAY, readCache, writeCache } from "@/lib/cache";
import { dfsReady } from "@/lib/dataforseo";
import { competitors, research, Spend, type Mode } from "@/lib/keywords";
import type { Keyword } from "@/lib/research";
import { broaderSeed } from "@/lib/kwReport";
import { marketOf } from "@/lib/research";
import { requireRole } from "@/lib/serverAuth";
import { normalizeSite } from "@/lib/site";
import { meteredRoute } from "@/lib/meter";
import { take } from "@/lib/entitlements";

const MODES: Mode[] = ["ideas", "phrase", "related", "site", "ranked", "competitors"];
const BY_DOMAIN: Mode[] = ["site", "ranked", "competitors"];

// Keyword Research: one search in DataForSEO Labs for the site's market. Editors only, since each search costs money.
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const took = await take(body.workspaceId, "research");
  if (!took.ok) return took.response;
  if (!dfsReady()) return Response.json({ error: "DataForSEO is not set up. Add DFS_LOGIN and DFS_PASSWORD on Render." }, { status: 500 });

  const mode: Mode = MODES.includes(body.mode) ? body.mode : "ideas";
  let query = typeof body.query === "string" ? body.query.trim().replace(/\s+/g, " ").slice(0, 200) : "";
  if (BY_DOMAIN.includes(mode)) query = normalizeSite(query)?.domain ?? "";
  else query = query.toLowerCase().replace(/["“”?!.]/g, "").trim();
  if (!query) return Response.json({ error: BY_DOMAIN.includes(mode) ? "Enter a domain, like acme.com." : "Enter a keyword." }, { status: 400 });

  const { data: site, error } = await auth.sb.from("sites").select("profile").eq("id", body.siteId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (error) return Response.json({ error: error.message + (/sites/.test(error.message) ? " Run supabase/006_research.sql in Supabase." : "") }, { status: 500 });
  if (!site) return Response.json({ error: "Website not found." }, { status: 404 });

  try {
    const spend = new Spend();
    const market = marketOf((site.profile as { country?: string })?.country);
    // Shared across every workspace for 30 days: the second search for the same thing is free.
    const key = `kr2:${mode}:${market.location}:${market.language}:${query.toLowerCase()}`;
    if (mode === "competitors") {
      const { data } = await cached(key, 30 * DAY, () => competitors(query, market, spend));
      return Response.json({ competitors: data, cost: spend.total });
    }
    const hit = await readCache<Keyword[]>(key, 30 * DAY);
    if (hit) return Response.json({ rows: hit, cost: 0 });
    let rows = await research(mode, query, market, spend);
    // Long or new searches are often missing from the keyword database: widen the search before giving up.
    if (!rows.length && !BY_DOMAIN.includes(mode)) {
      const wider = broaderSeed(query);
      if (wider) rows = await research(mode, wider, market, spend);
      if (!rows.length && mode !== "ideas") rows = await research("ideas", wider ?? query, market, spend);
    }
    // Empty results are not saved, so the next search tries again.
    if (rows.length) await writeCache(key, rows);
    return Response.json({ rows, cost: spend.total });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Keyword research failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("keyword research", handle);
