import { dfsReady } from "@/lib/dataforseo";
import { allSuggestions, bulkReport, keywordReport } from "@/lib/kwReport";
import { MARKETS } from "@/lib/research";
import { requireRole } from "@/lib/serverAuth";
import { meteredRoute } from "@/lib/meter";
import { take } from "@/lib/entitlements";
import { TASK_COST } from "@/lib/plans";

// Keyword overview, bulk analysis and the "View all" lists. Editors only, since a first search costs money.
//   report: { keyword, country, device }
//   bulk: { keywords: string[], country }
//   all: { keyword, country, questions: boolean }
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const took = await take(body.workspaceId, "tasks", body.action === "bulk" ? TASK_COST.bulk(Array.isArray(body.keywords) ? body.keywords.length : 20) : TASK_COST.keyword);
  if (!took.ok) return took.response;
  if (!dfsReady()) return Response.json({ error: "DataForSEO is not set up. Add DFS_LOGIN and DFS_PASSWORD on Render." }, { status: 500 });
  const country = MARKETS[body.country] ? String(body.country) : "United States";

  try {
    if (body.action === "bulk") {
      const keywords = (Array.isArray(body.keywords) ? body.keywords : String(body.keywords ?? "").split(/\n|,/)).map(String).filter((k: string) => k.trim());
      if (!keywords.length) return Response.json({ error: "Paste at least one keyword." }, { status: 400 });
      return Response.json(await bulkReport(keywords, country));
    }
    const keyword = String(body.keyword ?? "").trim();
    if (!keyword) return Response.json({ error: "Enter a keyword." }, { status: 400 });
    if (body.action === "all") {
      const cost = { total: 0 };
      const list = await allSuggestions(keyword, country, Boolean(body.questions), cost);
      return Response.json({ ...list, cost: cost.total });
    }
    return Response.json(await keywordReport(keyword, country, body.device === "mobile" ? "mobile" : "desktop"));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Keyword report failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("keyword report", handle);
