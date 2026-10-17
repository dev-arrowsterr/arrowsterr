import type { SupabaseClient } from "@supabase/supabase-js";

// The PDF worker's side of a report_pdf job (scripts/worker.mjs). The routes check CRON_SECRET first.

export const KEEP = 5;
export const MAX_PDF = 50 * 1024 * 1024;

export type RunningPdf = { id: number; workspace_id: string | null; payload: { reportId?: string; fileId?: string; workspaceId?: string; file?: string } & Record<string, unknown> };

/** The job, if it is a PDF job a worker holds right now. */
export async function runningPdf(db: SupabaseClient, id: number): Promise<RunningPdf | null> {
  const { data } = await db.from("jobs").select("id, workspace_id, payload, status, kind").eq("id", id).maybeSingle();
  const job = data as (RunningPdf & { status: string; kind: string }) | null;
  return job && job.kind === "report_pdf" && job.status === "running" ? job : null;
}

/** True when the bytes are a PDF of a size storage takes. */
export const isPdf = (bytes: Uint8Array) => bytes.length > 4 && bytes.length <= MAX_PDF && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";

/** The files to remove so only the newest KEEP stay. Names are <jobId>.pdf, and job ids only grow. */
export function overflow(names: string[], keep = KEEP) {
  const ids = names.map((n) => ({ n, id: Number(n.replace(/\.pdf$/, "")) })).filter((x) => Number.isFinite(x.id));
  return ids.sort((a, b) => b.id - a.id).slice(keep).map((x) => x.n);
}
