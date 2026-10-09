import { after } from "next/server";
import { runBrief } from "@/lib/brief";
import { dfsReady } from "@/lib/dataforseo";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { metered, meteredRoute } from "@/lib/meter";
import { take } from "@/lib/entitlements";
import { enqueue, queueReady } from "@/lib/jobs";
import { periodOf } from "@/lib/plans";

// Content brief for one calendar item: start it, answer right away, and finish on the job queue
// (or in the background before supabase/016_queue.sql).
// The page reads progress from calendar_items.brief_status.
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const took = await take(body.workspaceId, "briefs", 1, { refundIfFree: false });
  if (!took.ok) return took.response;
  if (!dfsReady()) return Response.json({ error: "DataForSEO is not set up. Add DFS_LOGIN and DFS_PASSWORD on Render." }, { status: 500 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY is not set on Render." }, { status: 500 });

  const { data: item, error } = await auth.sb.from("calendar_items").select("id, brief_status, brief_at").eq("id", body.itemId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (error) return Response.json({ error: error.message + (/brief/.test(error.message) ? " Run supabase/007_briefs_and_pages.sql in Supabase." : "") }, { status: 500 });
  if (!item) return Response.json({ error: "Calendar item not found." }, { status: 404 });

  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;

  const { error: e2 } = await auth.sb.from("calendar_items").update({ brief_status: "running", brief_error: null }).eq("id", item.id);
  if (e2) return Response.json({ error: e2.message }, { status: 500 });
  if (await queueReady()) {
    await enqueue("brief", { itemId: item.id, period: periodOf("briefs") }, { workspaceId: body.workspaceId, key: `brief:${item.id}:${Date.now()}`, maxAttempts: 2 });
    return Response.json({ ok: true });
  }
  after(async () => {
    await metered(body.workspaceId, "content brief", () => runBrief(auth.sb, item.id));
    // A brief that failed does not count against the month's briefs.
    const { data: done } = await auth.sb.from("calendar_items").select("brief_status").eq("id", item.id).maybeSingle();
    if (done?.brief_status === "failed") await took.giveBack();
  });
  return Response.json({ ok: true });
}

export const POST = meteredRoute("content brief", handle);
