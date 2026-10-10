import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allowed } from "@/lib/cronAuth";
import { claim, enqueue, prune, queueReady, retry, type Job, type JobKind } from "@/lib/jobs";
import { metered } from "@/lib/meter";
import { sendNudges } from "@/lib/nudges";
import { adminClient } from "@/lib/serverAuth";
import { brief, check, plan, rollup, schedule } from "@/lib/worker/handlers";

// One worker tick. scripts/worker.mjs calls this over and over.
// Each tick queues the scheduler for this 10-minute window, then claims a batch of jobs and runs them a few at a time.

export const maxDuration = 300;

const HANDLERS: Record<JobKind, (db: SupabaseClient, job: Job) => Promise<void>> = { schedule, check, brief, plan, rollup };
const ACTION: Record<JobKind, string> = { schedule: "daily check", check: "daily check", brief: "content brief", plan: "content plan", rollup: "daily numbers" };
const WORKER = `web-${randomUUID().slice(0, 8)}`;
const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 8);

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

export async function POST(request: Request) {
  if (!allowed(request)) return Response.json({ error: "Wrong or missing CRON_SECRET." }, { status: 401 });
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY on Render." }, { status: 500 });
  if (!(await queueReady())) return Response.json({ error: "Run supabase/016_queue.sql in Supabase." }, { status: 500 });

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  try {
    const window = Math.floor(Date.now() / 600_000);
    await enqueue("schedule", {}, { key: `schedule:${window}`, maxAttempts: 2 });
    if (window % 36 === 0) await prune();
    // About once an hour: emails for tasks running low and trials ending.
    if (window % 6 === 0) await sendNudges(db).catch((e) => console.error("Nudges failed:", e instanceof Error ? e.message : e));

    const jobs = await claim(WORKER, limit);
    const done: Record<string, number> = {};
    let failed = 0;
    await pool(jobs, CONCURRENCY, async (job) => {
      try {
        await metered(job.workspace_id, ACTION[job.kind] ?? job.kind, () => HANDLERS[job.kind](db, job));
        done[job.kind] = (done[job.kind] ?? 0) + 1;
      } catch (e) {
        failed++;
        const message = e instanceof Error ? e.message : String(e);
        console.error(`Job ${job.id} (${job.kind}) failed:`, message);
        await retry(job.id, message, Math.min(3600, 30 * 2 ** job.attempts)).catch(() => {});
      }
    });
    return Response.json({ claimed: jobs.length, done, failed, idle: !jobs.length });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
