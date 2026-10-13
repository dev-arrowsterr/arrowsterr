import { dfsReady, NOT_SAVED, savedOnly } from "@/lib/dataforseo";
import { allSuggestions, bulkReport, keywordReport } from "@/lib/kwReport";
import { BULK_LIMIT, bulkList, MARKETS } from "@/lib/research";
import { isEditor, requireRole } from "@/lib/serverAuth";
import { meteredRoute, streamed } from "@/lib/meter";
import { requireTrack, take } from "@/lib/entitlements";
import { TASK_COST } from "@/lib/plans";
import { saveBulkRun } from "@/lib/bulkRuns";

// Keyword overview, bulk analysis and the "View all" lists.
// Editors run searches, which can cost money. Viewers opening a shared link see saved results only.
//   report: { keyword, country, device, stream? } (stream: one JSON line per piece as it lands)
//   bulk: { keywords: string[], country, siteId } (editors only; saved with its own link)
//   all: { keyword, country, questions: boolean }
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "viewer");
  if ("denied" in auth) return auth.denied;
  const [editor, paid] = await Promise.all([isEditor(auth.sb, body.workspaceId), requireTrack(body.workspaceId, "seo")]);
  if (paid) return paid;
  if (!editor && body.action === "bulk") return Response.json({ error: "You need editor access in this workspace to run a bulk analysis." }, { status: 403 });
  // A bulk list is cleaned first, so it is charged for what actually runs.
  const list = body.action === "bulk" ? bulkList(Array.isArray(body.keywords) ? body.keywords : String(body.keywords ?? "")) : [];
  if (body.action === "bulk" && !list.length) return Response.json({ error: "Paste at least one keyword." }, { status: 400 });
  if (list.length > BULK_LIMIT) return Response.json({ error: `Up to ${BULK_LIMIT} keywords at a time. This list has ${list.length}.` }, { status: 400 });
  if (editor) {
    const took = await take(body.workspaceId, "tasks", body.action === "bulk" ? TASK_COST.bulk(list.length) : TASK_COST.keyword);
    if (!took.ok) return took.response;
  }
  if (!dfsReady()) return Response.json({ error: "DataForSEO is not set up. Add DFS_LOGIN and DFS_PASSWORD on Render." }, { status: 500 });
  const country = MARKETS[body.country] ? String(body.country) : "United States";
  // Viewers only read what is saved. Pieces that are missing come back empty; nothing saved at all is an error.
  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (editor) return fn();
    const r = await savedOnly(fn);
    if (r.data === null) throw new Error(NOT_SAVED);
    return r.data;
  };

  try {
    if (body.action === "bulk") {
      const result = await bulkReport(list, country);
      const id = await saveBulkRun(auth.sb, { workspaceId: body.workspaceId, siteId: body.siteId, kind: "keywords", country, items: list, result });
      return Response.json({ ...result, id });
    }
    const keyword = String(body.keyword ?? "").trim();
    if (!keyword) return Response.json({ error: "Enter a keyword." }, { status: 400 });
    if (body.action === "all") {
      const cost = { total: 0 };
      const list = await run(() => allSuggestions(keyword, country, Boolean(body.questions), cost));
      return Response.json({ ...list, cost: cost.total });
    }
    const device = body.device === "mobile" ? "mobile" : "desktop";
    if (!body.stream) return Response.json(await run(() => keywordReport(keyword, country, device)));
    // One JSON object per line: each piece as it lands, then the whole report, or an error.
    // no-transform keeps gzip from holding lines back until the end.
    const out = new TransformStream<string, string>();
    const writer = out.writable.getWriter();
    const line = (x: unknown) => writer.write(JSON.stringify(x) + "\n").catch(() => {});
    const work = run(() => keywordReport(keyword, country, device, false, line))
      .then((report) => (line({ part: "done", report }), true))
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        if (message !== NOT_SAVED) console.error("Keyword report failed:", message);
        line({ part: "error", error: message });
        return false;
      })
      .finally(() => writer.close().catch(() => {}));
    const headers = { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" };
    return streamed(new Response(out.readable.pipeThrough(new TextEncoderStream()), { headers }), work);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message === NOT_SAVED) return Response.json({ error: message, notSaved: true }, { status: 404 });
    console.error("Keyword report failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("keyword report", handle);
