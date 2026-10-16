import { allowed } from "@/lib/cronAuth";
import { claim, queueReady } from "@/lib/jobs";
import { parseRange } from "@/lib/reportRange";
import { printPath } from "@/lib/reportServer";

// The PDF worker asks for its next PDF. It gets the print page to open, signed for 15 minutes.
export async function POST(request: Request) {
  if (!allowed(request)) return Response.json({ error: "Wrong or missing CRON_SECRET." }, { status: 401 });
  if (!(await queueReady())) return Response.json({ error: "Run supabase/016_queue.sql in Supabase." }, { status: 500 });
  const worker = (new URL(request.url).searchParams.get("worker") ?? "pdf").replace(/[^\w-]/g, "").slice(0, 40) || "pdf";
  try {
    const [job] = await claim(worker, 1, ["report_pdf"], 300);
    if (!job) return Response.json({ idle: true });
    const reportId = String(job.payload.reportId ?? "");
    return Response.json({ id: job.id, path: printPath(reportId, parseRange(job.payload.range)) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
