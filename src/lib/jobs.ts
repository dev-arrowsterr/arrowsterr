import "server-only";
import { adminClient } from "./serverAuth";

// The job queue (supabase/016_queue.sql). Routes add jobs; workers claim and run them.

export type JobKind = "schedule" | "check" | "brief" | "plan" | "rollup";
export type Job = { id: number; kind: JobKind; key: string | null; workspace_id: string | null; payload: Record<string, unknown>; attempts: number; max_attempts: number };

const db = () => {
  const c = adminClient();
  if (!c) throw new Error("Add SUPABASE_SECRET_KEY on Render.");
  return c;
};

/** True when the queue tables exist, so routes can fall back to running work inline before the migration. */
let ready: boolean | null = null;
export async function queueReady() {
  if (ready !== null) return ready;
  const c = adminClient();
  if (!c) return (ready = false);
  const { error } = await c.from("jobs").select("id").limit(1);
  return (ready = !error);
}

export async function enqueue(kind: JobKind, payload: Record<string, unknown>, opts: { workspaceId?: string | null; key?: string; runAt?: Date; maxAttempts?: number } = {}) {
  const { data, error } = await db().rpc("enqueue_job", {
    p_kind: kind,
    p_payload: payload,
    p_workspace: opts.workspaceId ?? null,
    p_key: opts.key ?? null,
    p_run_at: (opts.runAt ?? new Date()).toISOString(),
    p_max_attempts: opts.maxAttempts ?? 6,
  });
  if (error) throw new Error(`Queue: ${error.message}`);
  return data as number | null;
}

/** Add many jobs at once (a daily run's checks). Duplicate keys are skipped. */
export async function enqueueMany(rows: { kind: JobKind; payload: Record<string, unknown>; workspace_id?: string | null; key?: string; run_at?: string }[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db()
      .from("jobs")
      .upsert(rows.slice(i, i + 500).map((r) => ({ ...r, workspace_id: r.workspace_id ?? null })), { onConflict: "key", ignoreDuplicates: true });
    if (error) throw new Error(`Queue: ${error.message}`);
  }
}

export async function claim(worker: string, limit: number, kinds?: JobKind[], leaseSeconds = 300): Promise<Job[]> {
  const { data, error } = await db().rpc("claim_jobs", { p_worker: worker, p_limit: limit, p_lease_seconds: leaseSeconds, p_kinds: kinds ?? null });
  if (error) throw new Error(`Queue: ${error.message}`);
  return (data ?? []) as Job[];
}

export const finish = async (id: number) => void (await db().rpc("finish_job", { p_id: id }));

/** Run again later. count = false means waiting on something, which does not use up an attempt. */
export async function retry(id: number, error: string, seconds: number, opts: { payload?: Record<string, unknown>; count?: boolean } = {}) {
  await db().rpc("retry_job", { p_id: id, p_error: error.slice(0, 1000), p_seconds: Math.max(1, Math.round(seconds)), p_payload: opts.payload ?? null, p_count: opts.count ?? true });
}

export const prune = async () => void (await db().rpc("prune_jobs"));

// Calls per minute each provider may take, across every worker. Set RATE_<NAME> on Render to change one.
const RATES: Record<string, number> = { anthropic: 300, openai: 300, gemini: 300, perplexity: 120, dataforseo: 1500 };

/** True when this call fits under the provider's per-minute limit. Fails open if the limiter is missing. */
export async function rateOk(provider: string, n = 1) {
  const limit = Number(process.env[`RATE_${provider.toUpperCase()}`]) || RATES[provider] || 120;
  const { data, error } = await db().rpc("take_rate", { p_key: provider, p_per_minute: limit, p_n: n });
  return error ? true : Boolean(data);
}
