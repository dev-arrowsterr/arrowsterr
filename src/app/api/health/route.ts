import { adminClient } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// GET /api/health: the app answers and the database answers. Fly and Render use this to decide when a deploy is live.
// GET /api/health?deep=1: also checks the worker ran in the last 25 minutes. Point an uptime monitor at this one,
// so you hear about a stopped worker or a database outage before customers do. Both answer 503 when something is wrong.

const STALE_MS = 25 * 60_000;

async function timed<T>(p: PromiseLike<T>, ms = 4000): Promise<T> {
  return Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error(`no answer in ${ms / 1000}s`)), ms))]);
}

export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.has("deep");
  const db = adminClient();
  if (!db) return Response.json({ ok: false, database: "SUPABASE_SECRET_KEY is not set" }, { status: 503 });
  try {
    const { error } = await timed(db.from("workspaces").select("id", { head: true, count: "estimated" }).limit(1));
    if (error) throw new Error(error.message);
  } catch (e) {
    return Response.json({ ok: false, database: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
  if (!deep) return Response.json({ ok: true });

  // The worker queues and finishes a "schedule" job every 10 minutes, so its latest one shows the worker is alive.
  const [last, dead] = await Promise.all([
    timed(db.from("jobs").select("finished_at").eq("kind", "schedule").eq("status", "done").order("finished_at", { ascending: false }).limit(1).maybeSingle()),
    timed(db.from("jobs").select("id", { head: true, count: "exact" }).eq("status", "dead").gte("finished_at", new Date(Date.now() - 86_400_000).toISOString())),
  ]).catch((e) => [{ data: null, error: { message: e instanceof Error ? e.message : String(e) } }, { count: null }] as const);
  const at = last.data?.finished_at ? Date.parse(last.data.finished_at) : NaN;
  const workerOk = Number.isFinite(at) && Date.now() - at < STALE_MS;
  const body = { ok: workerOk, database: "ok", worker: workerOk ? "ok" : last.error ? last.error.message : "no tick in the last 25 minutes", lastTick: last.data?.finished_at ?? null, deadJobs24h: dead.count ?? null };
  return Response.json(body, { status: workerOk ? 200 : 503 });
}
