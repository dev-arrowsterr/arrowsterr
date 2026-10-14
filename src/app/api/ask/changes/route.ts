import { after } from "next/server";
import { requireWriter } from "@/lib/entitlements";
import { enqueue, queueReady } from "@/lib/jobs";
import { applySet, undoSet } from "@/lib/plays";
import { adminClient, requireRole } from "@/lib/serverAuth";

export const maxDuration = 300;

const str = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const err = (error: string, status = 400) => Response.json({ error }, { status });

// Change sets from Mr. Agent. Nothing reaches a website until an editor approves it and presses Apply.
//   list: {}                                    viewers
//   get: { setId }                              viewers, with every change
//   review: { setId, approve: id[], reject: id[] }   editors
//   apply: { setId }    undo: { setId }         editors, on Pro and up
//   discard: { setId }                          editors, only before anything was applied
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const read = body.action === "list" || body.action === "get";
  const auth = await requireRole(request, body.workspaceId, read ? "viewer" : "editor");
  if ("denied" in auth) return auth.denied;
  const db = adminClient();
  if (!db) return err("Add SUPABASE_SECRET_KEY to the server's settings.", 500);
  const ws = String(body.workspaceId);

  if (body.action === "list") {
    const { data, error } = await db
      .from("change_sets")
      .select("id, title, play, status, step, error, created_at, applied_at, thread_id, cms_connections(name, kind)")
      .eq("workspace_id", ws)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error && /change_sets/.test(error.message)) return Response.json({ sets: [], setup: "Run supabase/036_ask.sql in Supabase to turn on Mr. Agent." });
    if (error) return err(error.message, 500);
    return Response.json({ sets: data });
  }

  const { data: set } = await db.from("change_sets").select("id, title, play, status, step, error, created_at, applied_at, thread_id, cms_connections(name, kind)").eq("id", str(body.setId, 60)).eq("workspace_id", ws).maybeSingle();
  if (!set) return err("Change set not found.", 404);
  const busy = set.status === "preparing" || set.status === "applying";

  if (body.action === "get") {
    const { data: changes, error } = await db.from("changes").select("id, target_type, target_id, url, label, field, before, after, note, status, error, applied_at").eq("change_set_id", set.id).order("id");
    if (error) return err(error.message, 500);
    return Response.json({ set, changes });
  }

  if (body.action === "review") {
    if (busy) return err("Wait until it's done.", 409);
    const ids = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter(Number.isFinite).slice(0, 500) : []);
    for (const [list, status] of [[ids(body.approve), "approved"], [ids(body.reject), "rejected"]] as const) {
      if (!list.length) continue;
      const { error } = await db.from("changes").update({ status }).eq("change_set_id", set.id).in("status", ["proposed", "approved", "rejected", "failed"]).in("id", list);
      if (error) return err(error.message, 500);
    }
    return Response.json({ ok: true });
  }

  if (body.action === "apply" || body.action === "undo") {
    if (busy) return err("It's already working on this set.", 409);
    const locked = await requireWriter(ws);
    if (locked) return locked;
    const want = body.action === "apply" ? "approved" : "applied";
    const { count } = await db.from("changes").select("id", { count: "exact", head: true }).eq("change_set_id", set.id).eq("status", want);
    if (!count) return err(body.action === "apply" ? "Approve at least one change first." : "Nothing here is live to undo.");
    const { data: me } = await auth.sb.auth.getUser();
    await db
      .from("change_sets")
      .update({ status: "applying", error: null, step: body.action === "apply" ? "Applying" : "Undoing", ...(body.action === "apply" ? { applied_by: me.user?.id ?? null } : {}) })
      .eq("id", set.id);
    const undo = body.action === "undo";
    if (await queueReady()) await enqueue("apply", { setId: set.id, undo }, { workspaceId: ws, key: `apply:${set.id}:${Date.now()}`, maxAttempts: 1 });
    else after(() => (undo ? undoSet(db, set.id) : applySet(db, set.id)));
    return Response.json({ ok: true });
  }

  if (body.action === "discard") {
    if (busy) return err("Wait until it's done.", 409);
    const { count } = await db.from("changes").select("id", { count: "exact", head: true }).eq("change_set_id", set.id).eq("status", "applied");
    if (count) return err("Some of these changes are live. Undo them first.", 409);
    const { error } = await db.from("change_sets").delete().eq("id", set.id);
    if (error) return err(error.message, 500);
    return Response.json({ ok: true });
  }

  return err("Unknown action.");
}
