import { createHash } from "node:crypto";
import { parseRange } from "@/lib/reportRange";
import { enqueue, queueReady } from "@/lib/jobs";
import { migrationHint, REPORT_COLS, type ReportRow } from "@/lib/reportServer";
import { adminClient, requireRole } from "@/lib/serverAuth";

// A saved client report as a PDF, made on the PDF worker with a real browser (docs/reports.md, section 25). Members only.
//   start: queue the PDF. The same report, dates and save within 10 minutes reuse one job.
//   status: queued, done (with a link good for an hour), failed, or stalled when no PDF worker took it.
const STALL_MS = 90_000;

type PdfJob = { id: number; status: string; payload: Record<string, unknown>; last_error: string | null; created_at: string; attempts: number; workspace_id: string | null };

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "viewer");
  if ("denied" in auth) return auth.denied;
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, { status: 500 });
  if (!(await queueReady())) return Response.json({ error: "Run supabase/016_queue.sql in Supabase." }, { status: 500 });
  const workspaceId = body.workspaceId as string;

  if (body.action === "status") {
    const { data } = await db.from("jobs").select("id, status, payload, last_error, created_at, attempts, workspace_id").eq("id", Number(body.jobId) || 0).eq("kind", "report_pdf").maybeSingle();
    const job = data as PdfJob | null;
    if (!job || job.workspace_id !== workspaceId) return Response.json({ error: "That PDF is gone." }, { status: 404 });
    if (job.status === "done") {
      const path = String(job.payload.path ?? "");
      const { data: signed, error } = await db.storage.from("report-pdfs").createSignedUrl(path, 3600, { download: String(job.payload.file ?? "report.pdf") });
      if (error || !signed) return Response.json({ status: "failed", error: error?.message ?? "The PDF is gone." });
      return Response.json({ status: "done", url: signed.signedUrl });
    }
    if (job.status === "dead") return Response.json({ status: "failed", error: job.last_error ?? "The PDF failed." });
    const stalled = job.status === "queued" && job.attempts === 0 && Date.now() - new Date(job.created_at).getTime() > STALL_MS;
    return Response.json({ status: stalled ? "stalled" : "working" });
  }

  const { data, error } = await auth.sb.from("reports").select(REPORT_COLS).eq("id", body.reportId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) return Response.json({ error: migrationHint(error.message) }, { status: 500 });
  if (!data) return Response.json({ error: "That report is gone." }, { status: 404 });
  const row = data as ReportRow;
  if (row.kind !== "client") return Response.json({ error: "Only client reports make a PDF here." }, { status: 400 });

  const range = parseRange(row.range);
  const window = Math.floor(Date.now() / 600_000);
  const key = `pdf:${row.id}:${createHash("sha256").update(`${row.updated_at}|${JSON.stringify(range)}|${window}`).digest("hex").slice(0, 24)}`;
  const file = `${row.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "report"}.pdf`;
  try {
    let id = await enqueue("report_pdf", { reportId: row.id, workspaceId, range, file }, { workspaceId, key, maxAttempts: 3 });
    if (!id) id = ((await db.from("jobs").select("id").eq("key", key).maybeSingle()).data as { id: number } | null)?.id ?? null;
    if (!id) return Response.json({ error: "Could not queue the PDF." }, { status: 500 });
    return Response.json({ jobId: id });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
