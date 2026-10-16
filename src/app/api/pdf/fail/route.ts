import { allowed } from "@/lib/cronAuth";
import { retry } from "@/lib/jobs";
import { runningPdf } from "@/lib/pdfJobs";
import { adminClient } from "@/lib/serverAuth";

// The PDF worker could not make the file. The job tries again in 30 seconds, up to its limit.
export async function POST(request: Request) {
  if (!allowed(request)) return Response.json({ error: "Wrong or missing CRON_SECRET." }, { status: 401 });
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, { status: 500 });
  const job = await runningPdf(db, Number(new URL(request.url).searchParams.get("id")) || 0);
  if (!job) return Response.json({ error: "No such PDF job." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  await retry(job.id, String(body.error ?? "The PDF failed.").slice(0, 1000), 30);
  return Response.json({ ok: true });
}
