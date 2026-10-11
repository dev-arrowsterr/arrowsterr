import { runSerp } from "@/lib/brief";
import { dfsReady } from "@/lib/dataforseo";
import { requireTrack, take } from "@/lib/entitlements";
import { meteredRoute } from "@/lib/meter";
import { TASK_COST } from "@/lib/plans";
import { requireRole } from "@/lib/serverAuth";

// SERP analysis for one Content Plan piece: Google's top 10 in the brand's market, every page read.
// Saved on the piece. A brief written later reads it; a brief written before gets it copied in.
//   { itemId }
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const paid = await requireTrack(body.workspaceId, "seo");
  if (paid) return paid;
  if (!dfsReady()) return Response.json({ error: "DataForSEO is not set up. Add DFS_LOGIN and DFS_PASSWORD on Render." }, { status: 500 });

  const { data: item, error } = await auth.sb.from("calendar_items").select("id").eq("id", body.itemId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!item) return Response.json({ error: "Content Plan item not found." }, { status: 404 });

  const took = await take(body.workspaceId, "tasks", TASK_COST.serp, { refundIfFree: false });
  if (!took.ok) return took.response;
  try {
    const out = await runSerp(auth.sb, item.id);
    return Response.json(out);
  } catch (e) {
    await took.giveBack();
    const message = e instanceof Error ? e.message : String(e);
    console.error("SERP analysis failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("serp analysis", handle);
