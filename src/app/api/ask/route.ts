import { answer, startAudit, type AskEvent } from "@/lib/ask";
import { take } from "@/lib/entitlements";
import { meteredRoute, streamed } from "@/lib/meter";
import { TASK_COST } from "@/lib/plans";
import { adminClient, isEditor, requireRole } from "@/lib/serverAuth";

export const maxDuration = 300;

const str = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const err = (error: string, status = 400) => Response.json({ error }, { status });
const missing = (e: { message: string } | null) => e && /ask_threads|ask_messages|site_audits|change_sets/.test(e.message);
const SETUP = "Run supabase/036_ask.sql in Supabase to turn on Ask Arrowsterr.";

type Block = { type: string; text?: string; name?: string };

// Ask Arrowsterr. Everyone in the workspace can chat and read; only editors start audits or prepare changes.
//   threads: {}                       the workspace's chats, newest first
//   thread: { threadId }              one chat's messages
//   send: { threadId?, message }      answer one message, streamed as one JSON event per line
//   rename: { threadId, title }       delete: { threadId }
//   audits: {}                        audit: { auditId }        audit_start: { domain }
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, body.action === "audit_start" ? "editor" : "viewer");
  if ("denied" in auth) return auth.denied;
  const db = adminClient();
  if (!db) return err("Add SUPABASE_SECRET_KEY to the server's settings to use Ask Arrowsterr.", 500);
  const ws = String(body.workspaceId);
  const { data: me } = await auth.sb.auth.getUser();
  const userId = me.user?.id ?? "";

  if (body.action === "threads") {
    const { data, error } = await db.from("ask_threads").select("id, title, created_by, updated_at").eq("workspace_id", ws).order("updated_at", { ascending: false }).limit(100);
    if (missing(error)) return Response.json({ threads: [], setup: SETUP });
    if (error) return err(error.message, 500);
    return Response.json({ threads: data });
  }

  const threadOf = async (id: unknown) => {
    const { data } = await db.from("ask_threads").select("id, title, created_by").eq("id", str(id, 60)).eq("workspace_id", ws).maybeSingle();
    return data as { id: string; title: string; created_by: string | null } | null;
  };

  if (body.action === "thread") {
    const t = await threadOf(body.threadId);
    if (!t) return err("Chat not found.", 404);
    const { data, error } = await db.from("ask_messages").select("id, role, content, text, created_at").eq("thread_id", t.id).order("id").limit(400);
    if (error) return err(error.message, 500);
    // Show people the words and which tools ran. Tool results stay on the server.
    const messages = (data ?? [])
      .map((m) => {
        const blocks = (typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content as Block[])) ?? [];
        return { id: m.id, role: m.role, text: m.text, tools: blocks.filter((b) => b.type === "tool_use").map((b) => b.name ?? ""), created_at: m.created_at };
      })
      .filter((m) => m.text || m.tools.length);
    const [{ data: sets }, { data: audits }] = await Promise.all([
      db.from("change_sets").select("id, title, status").eq("thread_id", t.id).order("created_at"),
      db.from("site_audits").select("id, domain, status").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(1),
    ]);
    return Response.json({ thread: t, messages, changeSets: sets ?? [], audit: audits?.[0] ?? null });
  }

  if (body.action === "rename" || body.action === "delete") {
    const t = await threadOf(body.threadId);
    if (!t) return err("Chat not found.", 404);
    if (t.created_by !== userId && !(await isEditor(auth.sb, ws))) return err("Only the person who started this chat can change it.", 403);
    const q = body.action === "delete" ? db.from("ask_threads").delete() : db.from("ask_threads").update({ title: str(body.title, 80) || "New chat" });
    const { error } = await q.eq("id", t.id);
    if (error) return err(error.message, 500);
    return Response.json({ ok: true });
  }

  if (body.action === "audits") {
    const { data, error } = await db.from("site_audits").select("id, domain, status, step, pages, score, error, created_at, finished_at").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(20);
    if (missing(error)) return Response.json({ audits: [], setup: SETUP });
    if (error) return err(error.message, 500);
    return Response.json({ audits: data });
  }

  if (body.action === "audit") {
    const { data, error } = await db.from("site_audits").select("*").eq("id", str(body.auditId, 60)).eq("workspace_id", ws).maybeSingle();
    if (error) return err(error.message, 500);
    if (!data) return err("Audit not found.", 404);
    return Response.json({ audit: data });
  }

  if (body.action === "audit_start") {
    const { data: running } = await db.from("site_audits").select("id").eq("workspace_id", ws).eq("status", "running").gte("created_at", new Date(Date.now() - 30 * 60_000).toISOString()).limit(1);
    if (running?.length) return err("An audit is already running. It takes a few minutes.", 409);
    try {
      let domain = str(body.domain, 200);
      if (!domain) {
        const { data: b } = await db.from("brands").select("domain").eq("workspace_id", ws).order("created_at").limit(1).maybeSingle();
        domain = (b?.domain as string) ?? "";
      }
      return Response.json({ audit: await startAudit(db, ws, userId, domain) });
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e), missing(e as { message: string }) ? 500 : 400);
    }
  }

  if (body.action === "send") {
    const message = str(body.message, 4000);
    if (!message) return err("Type a message.");
    if (!process.env.ANTHROPIC_API_KEY) return err("Add ANTHROPIC_API_KEY to the server's settings to use Ask Arrowsterr.", 500);
    let thread = body.threadId ? await threadOf(body.threadId) : null;
    if (body.threadId && !thread) return err("Chat not found.", 404);
    const took = await take(ws, "tasks", TASK_COST.ai, { refundIfFree: false });
    if (!took.ok) return took.response;
    if (!thread) {
      const title = message.replace(/\s+/g, " ").slice(0, 60) + (message.length > 60 ? "…" : "");
      const { data, error } = await db.from("ask_threads").insert({ workspace_id: ws, title, created_by: userId }).select("id, title, created_by").single();
      if (missing(error)) return err(SETUP, 500);
      if (error || !data) return err(error?.message ?? "Could not start a chat.", 500);
      thread = data;
    }
    const canEdit = await isEditor(auth.sb, ws);
    const out = new TransformStream<string, string>();
    const writer = out.writable.getWriter();
    const line = (x: AskEvent | { type: "thread"; id: string; title: string }) => void writer.write(JSON.stringify(x) + "\n").catch(() => {});
    line({ type: "thread", id: thread.id, title: thread.title });
    const work = answer({ db, ws, userId, canEdit, threadId: thread.id }, message, line)
      .then(() => true)
      .catch((e) => {
        const error = e instanceof Error ? e.message : String(e);
        console.error("Ask failed:", error);
        line({ type: "error", error: /overloaded|529/i.test(error) ? "Claude is busy right now. Try again in a minute." : error });
        return false;
      })
      .finally(() => writer.close().catch(() => {}));
    const headers = { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" };
    return streamed(new Response(out.readable.pipeThrough(new TextEncoderStream()), { headers }), work);
  }

  return err("Unknown action.");
}

export const POST = meteredRoute("Ask Arrowsterr", handle);
