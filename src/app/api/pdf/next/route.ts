import { allowed } from "@/lib/cronAuth";
import { claim, queueReady } from "@/lib/jobs";
import { filePath } from "@/lib/reportLinks";

// The PDF worker asks for its next PDF: a page's file from Download PDF or a schedule (docs/reports.md, section 32).
// It gets the print page to open, signed for 15 minutes. A job with no file opens a page that says so, and fails.
export async function POST(request: Request) {
  if (!allowed(request)) return Response.json({ error: "Wrong or missing CRON_SECRET." }, { status: 401 });
  if (!(await queueReady())) return Response.json({ error: "Run supabase/016_queue.sql in Supabase." }, { status: 500 });
  const worker = (new URL(request.url).searchParams.get("worker") ?? "pdf").replace(/[^\w-]/g, "").slice(0, 40) || "pdf";
  try {
    const [job] = await claim(worker, 1, ["report_pdf"], 300);
    if (!job) return Response.json({ idle: true });
    return Response.json({ id: job.id, path: filePath(String(job.payload.fileId ?? "none")) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
