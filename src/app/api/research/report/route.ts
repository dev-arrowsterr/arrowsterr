import { dfsReady } from "@/lib/dataforseo";
import { allSuggestions, bulkReport, keywordReport } from "@/lib/kwReport";
import { MARKETS } from "@/lib/research";
import { requireRole } from "@/lib/serverAuth";
import { meteredRoute, streamed } from "@/lib/meter";
import { requireTrack, take } from "@/lib/entitlements";
import { TASK_COST } from "@/lib/plans";

// Keyword overview, bulk analysis and the "View all" lists. Editors only, since a first search costs money.
//   report: { keyword, country, device, stream? } (stream: one JSON line per piece as it lands)
//   bulk: { keywords: string[], country }
//   all: { keyword, country, questions: boolean }
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const paid = await requireTrack(body.workspaceId, "seo");
  if (paid) return paid;
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
    const device = body.device === "mobile" ? "mobile" : "desktop";
    if (!body.stream) return Response.json(await keywordReport(keyword, country, device));
    // One JSON object per line: each piece as it lands, then the whole report, or an error.
    // no-transform keeps gzip from holding lines back until the end.
    const out = new TransformStream<string, string>();
    const writer = out.writable.getWriter();
    const line = (x: unknown) => writer.write(JSON.stringify(x) + "\n").catch(() => {});
    const work = keywordReport(keyword, country, device, false, line)
      .then((report) => (line({ part: "done", report }), true))
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        console.error("Keyword report failed:", message);
        line({ part: "error", error: message });
        return false;
      })
      .finally(() => writer.close().catch(() => {}));
    const headers = { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" };
    return streamed(new Response(out.readable.pipeThrough(new TextEncoderStream()), { headers }), work);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Keyword report failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("keyword report", handle);
