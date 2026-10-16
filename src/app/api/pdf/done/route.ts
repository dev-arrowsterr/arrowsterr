import { allowed } from "@/lib/cronAuth";
import { finish } from "@/lib/jobs";
import { isPdf, overflow, runningPdf } from "@/lib/pdfJobs";
import { adminClient } from "@/lib/serverAuth";

// The PDF worker sends the finished file. It is kept in the private report-pdfs bucket, newest 5 per report.
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!allowed(request)) return Response.json({ error: "Wrong or missing CRON_SECRET." }, { status: 401 });
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, { status: 500 });
  const job = await runningPdf(db, Number(new URL(request.url).searchParams.get("id")) || 0);
  if (!job || !job.workspace_id || !job.payload.reportId) return Response.json({ error: "No such PDF job." }, { status: 404 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!isPdf(bytes)) return Response.json({ error: "That is not a PDF." }, { status: 400 });

  const folder = `${job.workspace_id}/${job.payload.reportId}`;
  const path = `${folder}/${job.id}.pdf`;
  const { error } = await db.storage.from("report-pdfs").upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (error) return Response.json({ error: `${error.message}${/bucket/i.test(error.message) ? " Run supabase/043_reports.sql in Supabase." : ""}` }, { status: 500 });

  const { data: files } = await db.storage.from("report-pdfs").list(folder, { limit: 100 });
  const old = overflow((files ?? []).map((f) => f.name));
  if (old.length) await db.storage.from("report-pdfs").remove(old.map((n) => `${folder}/${n}`));

  await db.from("jobs").update({ payload: { ...job.payload, path } }).eq("id", job.id);
  await finish(job.id);
  return Response.json({ ok: true });
}
