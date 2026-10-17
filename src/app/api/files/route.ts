import { enqueue, queueReady } from "@/lib/jobs";
import { fileName, isDesign } from "@/lib/pdf/design";
import { isPdfPage } from "@/lib/pdf/pages";
import { makeSnapshot } from "@/lib/pdf/server";
import { adminClient, requireRole } from "@/lib/serverAuth";

// A page's PDF (docs/reports.md, section 32). Members of the workspace only.
//   make: { page, brandId, design, params }  build the numbers now, save the file row, queue the PDF.
//   status: { fileId }  making, ready (with a download link good for an hour), failed, or stalled when no PDF worker took it.
//   delete: { fileId }  editors only.
// The design the plan allows is decided here: a brand design below white label comes back as Arrowsterr's.
const STALL_MS = 90_000;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "viewer");
  if ("denied" in auth) return auth.denied;
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, { status: 500 });
  const workspaceId = body.workspaceId as string;
  const missing = (m: string) => (/report_files/.test(m) ? `${m} Run supabase/046_report_files.sql in Supabase.` : m);

  if (body.action === "status") {
    const { data, error } = await auth.sb.from("report_files").select("id, status, pdf_path, error, title, snapshot, job_id, created_at").eq("id", body.fileId).eq("workspace_id", workspaceId).maybeSingle();
    if (error) return Response.json({ error: missing(error.message) }, { status: 500 });
    if (!data) return Response.json({ error: "That file is gone." }, { status: 404 });
    const f = data as { id: string; status: string; pdf_path: string | null; error: string | null; title: string; snapshot: { brand?: { name?: string } }; job_id: number | null; created_at: string };
    if (f.status === "ready" && f.pdf_path) {
      const name = fileName(f.title, f.snapshot.brand?.name ?? "", new Date(f.created_at));
      const { data: signed, error: e } = await db.storage.from("report-pdfs").createSignedUrl(f.pdf_path, 3600, { download: name });
      if (e || !signed) return Response.json({ status: "failed", error: e?.message ?? "The PDF is gone." });
      return Response.json({ status: "ready", url: signed.signedUrl });
    }
    if (f.status === "failed") return Response.json({ status: "failed", error: f.error ?? "The PDF failed." });
    // Still making: a job that ran out of tries marks the file failed, and a job no worker took is stalled.
    const { data: job } = f.job_id ? await db.from("jobs").select("status, attempts, last_error, created_at").eq("id", f.job_id).maybeSingle() : { data: null };
    const j = job as { status: string; attempts: number; last_error: string | null; created_at: string } | null;
    if (j?.status === "dead") {
      await db.from("report_files").update({ status: "failed", error: j.last_error ?? "The PDF failed." }).eq("id", f.id);
      return Response.json({ status: "failed", error: j.last_error ?? "The PDF failed." });
    }
    const stalled = (!j || (j.status === "queued" && j.attempts === 0)) && Date.now() - Date.parse(f.created_at) > STALL_MS;
    return Response.json({ status: stalled ? "stalled" : "making" });
  }

  // delete: { fileId }  editors only. The row and the stored PDF both go.
  if (body.action === "delete") {
    const editor = await requireRole(request, workspaceId, "editor");
    if ("denied" in editor) return editor.denied;
    const { data } = await editor.sb.from("report_files").select("id, pdf_path").eq("id", body.fileId).eq("workspace_id", workspaceId).maybeSingle();
    if (!data) return Response.json({ error: "That file is gone." }, { status: 404 });
    const f = data as { id: string; pdf_path: string | null };
    if (f.pdf_path) await db.storage.from("report-pdfs").remove([f.pdf_path]);
    const { error } = await editor.sb.from("report_files").delete().eq("id", f.id);
    return error ? Response.json({ error: error.message }, { status: 500 }) : Response.json({ ok: true });
  }

  if (!isPdfPage(body.page)) return Response.json({ error: "This page has no PDF yet." }, { status: 400 });
  if (typeof body.brandId !== "string" || !body.brandId) return Response.json({ error: "Pick a brand." }, { status: 400 });
  if (!(await queueReady())) return Response.json({ error: "Run supabase/016_queue.sql in Supabase." }, { status: 500 });
  try {
    const made = await makeSnapshot(db, workspaceId, body.brandId, body.page, isDesign(body.design) ? body.design : "arrowsterr", body.params);
    const userId = (await auth.sb.auth.getUser(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "")).data.user?.id ?? null;
    const { data: row, error } = await db
      .from("report_files")
      .insert({ workspace_id: workspaceId, brand_id: made.brandId, page: body.page, title: made.title, design: made.design, params: made.params, snapshot: made.snapshot, created_by: userId })
      .select("id")
      .single();
    if (error) return Response.json({ error: missing(error.message) }, { status: 500 });
    const fileId = (row as { id: string }).id;
    const jobId = await enqueue("report_pdf", { fileId, workspaceId }, { workspaceId, key: `file:${fileId}`, maxAttempts: 3 });
    if (jobId) await db.from("report_files").update({ job_id: jobId }).eq("id", fileId);
    return Response.json({ fileId, design: made.design });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("PDF file failed:", message);
    return Response.json({ error: missing(message) }, { status: 500 });
  }
}
