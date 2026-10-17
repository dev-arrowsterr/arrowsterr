import { allowed } from "@/lib/cronAuth";
import { finish } from "@/lib/jobs";
import { isPdf, runningPdf } from "@/lib/pdfJobs";
import { adminClient } from "@/lib/serverAuth";

// The PDF worker sends the finished file. It is kept in the private report-pdfs bucket (docs/reports.md, section 32).
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!allowed(request)) return Response.json({ error: "Wrong or missing CRON_SECRET." }, { status: 401 });
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, { status: 500 });
  const job = await runningPdf(db, Number(new URL(request.url).searchParams.get("id")) || 0);
  if (!job || !job.workspace_id || !job.payload.fileId) return Response.json({ error: "No such PDF job." }, { status: 404 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!isPdf(bytes)) return Response.json({ error: "That is not a PDF." }, { status: 400 });

  // One file per row, kept until it is deleted.
  const fileId = String(job.payload.fileId);
  const filePath = `files/${job.workspace_id}/${fileId}.pdf`;
  const { error } = await db.storage.from("report-pdfs").upload(filePath, bytes, { contentType: "application/pdf", upsert: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await db.from("report_files").update({ status: "ready", pdf_path: filePath, error: null }).eq("id", fileId).eq("workspace_id", job.workspace_id);
  await db.from("jobs").update({ payload: { ...job.payload, path: filePath } }).eq("id", job.id);
  await finish(job.id);
  return Response.json({ ok: true });
}
