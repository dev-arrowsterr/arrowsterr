import { dfsReady } from "@/lib/dataforseo";
import { research, Spend, type Mode } from "@/lib/keywords";
import { marketOf } from "@/lib/research";
import { requireRole } from "@/lib/serverAuth";
import { normalizeSite } from "@/lib/site";

const MODES: Mode[] = ["ideas", "phrase", "related", "site", "ranked"];

// Keyword Research: one search in DataForSEO Labs for the site's market. Editors only, since each search costs money.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  if (!dfsReady()) return Response.json({ error: "DataForSEO is not set up. Add DFS_LOGIN and DFS_PASSWORD on Render." }, { status: 500 });

  const mode: Mode = MODES.includes(body.mode) ? body.mode : "ideas";
  let query = typeof body.query === "string" ? body.query.trim().replace(/\s+/g, " ").slice(0, 200) : "";
  if (mode === "site" || mode === "ranked") query = normalizeSite(query)?.domain ?? "";
  if (!query) return Response.json({ error: mode === "site" || mode === "ranked" ? "Enter a domain, like acme.com." : "Enter a keyword." }, { status: 400 });

  const { data: site, error } = await auth.sb.from("sites").select("profile").eq("id", body.siteId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (error) return Response.json({ error: error.message + (/sites/.test(error.message) ? " Run supabase/006_research.sql in Supabase." : "") }, { status: 500 });
  if (!site) return Response.json({ error: "Website not found." }, { status: 404 });

  try {
    const spend = new Spend();
    const rows = await research(mode, query, marketOf((site.profile as { country?: string })?.country), spend);
    return Response.json({ rows, cost: spend.total });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Keyword research failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
