import { startArticleResearch } from "@/lib/articleResearchServer";
import { dfsReady } from "@/lib/dataforseo";
import { requireTrack } from "@/lib/entitlements";
import { queueReady } from "@/lib/jobs";
import { adminClient, requireRole } from "@/lib/serverAuth";

// Research for one content plan item (docs/content-v2.md, steps 1 to 3), run on the job queue and the Fly worker.
//   { workspaceId, itemId }  start it, or get the run already open or finished for the same keyword
// Progress is read from article_runs, article_pages and article_ai_answers.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const paid = await requireTrack(body.workspaceId, "seo");
  if (paid) return paid;
  if (!dfsReady()) return Response.json({ error: "DataForSEO is not set up. Add DFS_LOGIN and DFS_PASSWORD to the server's settings." }, { status: 500 });
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, { status: 500 });
  if (!(await queueReady())) return Response.json({ error: "Run supabase/016_queue.sql in Supabase." }, { status: 500 });

  // Checked as the caller, so another workspace's item is not found.
  const { data: item } = await auth.sb.from("calendar_items").select("id").eq("id", String(body.itemId ?? "")).eq("workspace_id", body.workspaceId).maybeSingle();
  if (!item) return Response.json({ error: "Calendar item not found." }, { status: 404 });
  try {
    const { data: me } = await auth.sb.auth.getUser();
    const run = await startArticleResearch(db, { workspaceId: body.workspaceId, itemId: item.id, userId: me.user?.id ?? null });
    return Response.json({ ok: true, ...run });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
