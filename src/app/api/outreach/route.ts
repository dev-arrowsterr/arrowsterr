import type { SupabaseClient } from "@supabase/supabase-js";
import type { TargetKind } from "@/lib/contacts";
import { requireActive } from "@/lib/entitlements";
import { enqueueMany } from "@/lib/jobs";
import { adminClient, requireRole } from "@/lib/serverAuth";

// Outreach lists and their targets. Editors make lists, add targets and fix emails here.
// Adding a target queues a job that looks for its public contact email.

const KINDS: TargetKind[] = ["website", "press", "podcast", "youtube", "social"];
const FINDABLE: TargetKind[] = ["website", "press", "podcast"];
const NOT_SET_UP = "Run supabase/040_outreach.sql in Supabase.";
const EMAIL = /^[^\s@]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/i;
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const domainOf = (url: string) => {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};
const fail = (error: string, status = 400) => Response.json({ error }, { status });

/** Queue the email search for these targets. */
async function findEmails(db: SupabaseClient, ws: string, targets: { id: string; kind: string }[]) {
  const now = Date.now();
  await enqueueMany(targets.filter((t) => FINDABLE.includes(t.kind as TargetKind)).map((t) => ({ kind: "contact" as const, workspace_id: ws, key: `contact:${t.id}:${now}`, payload: { targetId: t.id } })));
  const manualOnly = targets.filter((t) => !FINDABLE.includes(t.kind as TargetKind)).map((t) => t.id);
  if (manualOnly.length) await db.from("outreach_targets").update({ email_status: "not_found" }).in("id", manualOnly).eq("email_status", "pending");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const ws = body.workspaceId;
  const auth = await requireRole(request, ws, "editor");
  if ("denied" in auth) return auth.denied;
  const stopped = await requireActive(ws);
  if (stopped) return stopped;
  const db = adminClient();
  if (!db) return fail("Add SUPABASE_SECRET_KEY to the server's settings.", 500);

  // A list must belong to this workspace before anything touches it.
  const ownList = async (id: unknown) => {
    if (typeof id !== "string") return null;
    const { data } = await db.from("outreach_lists").select("id").eq("id", id).eq("workspace_id", ws).maybeSingle();
    return data?.id as string | undefined;
  };

  try {
    switch (body.action) {
      case "createList": {
        const name = str(body.name, 80);
        if (!name) return fail("Give the list a name.");
        const brandId = typeof body.brandId === "string" ? body.brandId : null;
        const { data, error } = await db.from("outreach_lists").insert({ workspace_id: ws, brand_id: brandId, name }).select("id, name, brand_id, created_at").single();
        if (error) throw new Error(error.message);
        return Response.json({ list: data });
      }
      case "renameList": {
        const id = await ownList(body.listId);
        const name = str(body.name, 80);
        if (!id || !name) return fail("List not found.", 404);
        const { error } = await db.from("outreach_lists").update({ name }).eq("id", id);
        if (error) throw new Error(error.message);
        return Response.json({ ok: true });
      }
      case "deleteList": {
        const id = await ownList(body.listId);
        if (!id) return fail("List not found.", 404);
        const { error } = await db.from("outreach_lists").delete().eq("id", id);
        if (error) throw new Error(error.message);
        return Response.json({ ok: true });
      }
      case "add": {
        const id = await ownList(body.listId);
        if (!id) return fail("List not found.", 404);
        const from = ["industry", "sources", "social", "manual"].includes(body.from) ? body.from : "manual";
        const items = (Array.isArray(body.items) ? body.items : [])
          .slice(0, 200)
          .map((x: Record<string, unknown>) => ({ kind: x.kind as TargetKind, name: str(x.name, 200), url: str(x.url, 1000) || null }))
          .filter((x: { kind: TargetKind; name: string }) => KINDS.includes(x.kind) && x.name);
        if (!items.length) return fail("Nothing to add.");
        const { data: blocked } = await db.from("outreach_suppression").select("value").eq("workspace_id", ws);
        const no = new Set((blocked ?? []).map((b) => b.value));
        const rows = items.map((x: { kind: TargetKind; name: string; url: string | null }) => {
          const domain = x.url ? domainOf(x.url) : "";
          return { list_id: id, workspace_id: ws, kind: x.kind, name: x.name, url: x.url, domain: domain || null, added_from: from, status: domain && no.has(domain) ? "do_not_contact" : "new" };
        });
        const { data, error } = await db.from("outreach_targets").upsert(rows, { onConflict: "list_id,kind,name", ignoreDuplicates: true }).select("id, kind");
        if (error) throw new Error(error.message);
        await findEmails(db, ws, data ?? []);
        return Response.json({ added: data?.length ?? 0, skipped: rows.length - (data?.length ?? 0) });
      }
      case "remove": {
        const ids = (Array.isArray(body.targetIds) ? body.targetIds : []).filter((x: unknown) => typeof x === "string").slice(0, 500);
        const { error } = await db.from("outreach_targets").delete().in("id", ids).eq("workspace_id", ws);
        if (error) throw new Error(error.message);
        return Response.json({ ok: true });
      }
      case "setEmail": {
        const email = str(body.email, 254).toLowerCase();
        if (email && !EMAIL.test(email)) return fail("That doesn't look like an email address.");
        const { data: blocked } = email ? await db.from("outreach_suppression").select("value").eq("workspace_id", ws).in("value", [email, email.split("@")[1]]) : { data: [] };
        const patch = email
          ? { email, email_source: "manual", email_status: "manual", ...(blocked?.length ? { status: "do_not_contact" } : {}) }
          : { email: null, email_source: null, email_status: "not_found" };
        const { error } = await db.from("outreach_targets").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", body.targetId).eq("workspace_id", ws);
        if (error) throw new Error(error.message);
        return Response.json({ ok: true });
      }
      case "findEmails": {
        const ids = (Array.isArray(body.targetIds) ? body.targetIds : []).filter((x: unknown) => typeof x === "string").slice(0, 500);
        const { data, error } = await db.from("outreach_targets").update({ email_status: "pending" }).in("id", ids).eq("workspace_id", ws).neq("email_status", "manual").select("id, kind");
        if (error) throw new Error(error.message);
        await findEmails(db, ws, data ?? []);
        return Response.json({ queued: data?.length ?? 0 });
      }
      default:
        return fail("Bad request");
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Outreach:", message);
    return fail(/outreach_/.test(message) ? NOT_SET_UP : message, 500);
  }
}
