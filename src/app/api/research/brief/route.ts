import { after } from "next/server";
import { runBrief } from "@/lib/brief";
import { dfsReady } from "@/lib/dataforseo";
import { adminClient, requireRole, takeAnswer } from "@/lib/serverAuth";
import { metered, meteredRoute } from "@/lib/meter";
import { requireTrack, take } from "@/lib/entitlements";
import { TASK_COST } from "@/lib/plans";
import { enqueue, queueReady } from "@/lib/jobs";

// Content brief for one calendar item: start it, answer right away, and finish on the job queue
// (or in the background before supabase/016_queue.sql).
// The page reads progress from calendar_items.brief_status.
//   { itemId }                  start a brief
//   { itemId, action: "stop" }  stop a running brief; its tasks come back if no work was done
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  if (body.action === "stop") return stop(auth.sb, body.workspaceId, String(body.itemId ?? ""));
  const paid = await requireTrack(body.workspaceId, "seo");
  if (paid) return paid;
  const took = await take(body.workspaceId, "tasks", TASK_COST.brief, { refundIfFree: false });
  if (!took.ok) return took.response;
  if (!dfsReady()) return Response.json({ error: "DataForSEO is not set up. Add DFS_LOGIN and DFS_PASSWORD on Render." }, { status: 500 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY is not set on Render." }, { status: 500 });

  const { data: item, error } = await auth.sb.from("calendar_items").select("id, brief_status, brief_at").eq("id", body.itemId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (error) return Response.json({ error: error.message + (/brief/.test(error.message) ? " Run supabase/007_briefs_and_pages.sql in Supabase." : "") }, { status: 500 });
  if (!item) return Response.json({ error: "Calendar item not found." }, { status: 404 });

  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;

  let { error: e2 } = await auth.sb.from("calendar_items").update({ brief_status: "running", brief_error: null, brief_started_at: new Date().toISOString() }).eq("id", item.id);
  // Before supabase/029_brief_started.sql there is no start time. Start without it.
  if (e2 && /brief_started_at/.test(e2.message)) ({ error: e2 } = await auth.sb.from("calendar_items").update({ brief_status: "running", brief_error: null }).eq("id", item.id));
  if (e2) return Response.json({ error: e2.message }, { status: 500 });
  if (await queueReady()) {
    await enqueue("brief", { itemId: item.id, period: took.period, tasks: TASK_COST.brief, fromPack: took.fromPack ?? 0 }, { workspaceId: body.workspaceId, key: `brief:${item.id}:${Date.now()}`, maxAttempts: 2 });
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

/** Stop a brief: mark it stopped, drop its queued job, and hand back the tasks of a job no worker is running. */
async function stop(sb: import("@supabase/supabase-js").SupabaseClient, workspaceId: string, itemId: string) {
  const { data: item } = await sb.from("calendar_items").select("id").eq("id", itemId).eq("workspace_id", workspaceId).maybeSingle();
  if (!item) return Response.json({ error: "Calendar item not found." }, { status: 404 });
  const { error } = await sb.from("calendar_items").update({ brief_status: "failed", brief_error: "Stopped." }).eq("id", item.id).eq("brief_status", "running");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const db = adminClient();
  if (db && (await queueReady())) {
    const { data: jobs } = await db.from("jobs").select("id, status, locked_until, payload").like("key", `brief:${item.id}:%`).in("status", ["queued", "running"]);
    for (const j of jobs ?? []) {
      await db.from("jobs").update({ status: "dead", finished_at: new Date().toISOString(), last_error: "Stopped." }).eq("id", j.id);
      // A job a worker is still running hands its tasks back itself when it sees the brief stopped.
      const idle = j.status === "queued" || (j.locked_until && new Date(j.locked_until).getTime() < Date.now());
      const p = j.payload as { period?: string; tasks?: number; fromPack?: number };
      if (idle && p.period) await db.rpc("give_back_tasks", { p_ws: workspaceId, p_period: p.period, p_plan_n: (p.tasks ?? 0) - (p.fromPack ?? 0), p_pack_n: p.fromPack ?? 0 });
    }
  }
  return Response.json({ ok: true });
}
