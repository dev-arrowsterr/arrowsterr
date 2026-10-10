import type { SupabaseClient } from "@supabase/supabase-js";
import { answerChat, readAnswer } from "@/lib/answer";
import type { Chat } from "@/lib/chats";
import { getTask, postTasks, type DfsEngine } from "@/lib/dataforseo";
import { answerRows, saveAnswers } from "@/lib/db";
import { availableEngines, viaDfs, WEEKLY_ENGINES, type Engine } from "@/lib/engines";
import { allowed } from "@/lib/cronAuth";
import { entitlement } from "@/lib/entitlements";
import { queueReady } from "@/lib/jobs";
import { checkDue, promptAllowance } from "@/lib/plans";
import { metered } from "@/lib/meter";
import { adminClient } from "@/lib/serverAuth";

// The old daily job, kept for setups without the job queue. Once supabase/016_queue.sql has run,
// the worker (/api/worker) does this work spread over the day, and this route answers done right away.
// scripts/daily-run.mjs calls this over and over until it answers done: true.
// Each call:
//   1. starts today's runs for brands that need one,
//   2. queues every ChatGPT, Gemini, AI Overview and AI Mode question at DataForSEO (the cheap way, ready in up to 45 minutes),
//   3. answers a few Claude and Perplexity questions directly,
//   4. collects queued answers that are ready.

const BATCH = 6; // direct answers per call, so each call ends in a few minutes
const CHECKS = 30; // queued tasks checked per call
const CONCURRENCY = 3;
const DAY_MS = 20 * 3600_000; // a brand with a run in the last 20 hours is skipped
const GIVE_UP_MS = 3 * 3600_000; // queued tasks older than this are marked failed

type Queued = { id: string | null; engine: DfsEngine; prompt: string; at: string };
type Row = {
  id: string;
  at: string;
  workspace_id: string;
  brand_id: string;
  engines: string[];
  prompts: string[] | null;
  chats: Chat[];
  queued: Queued[];
};

const LIMIT = "Daily limit reached. This workspace used all its AI answers for today.";
const key = (engine: string, prompt: string) => `${engine}\n${prompt}`;
const failed = (engine: string, prompt: string, error: string): Chat => ({ engine, prompt, text: "", sources: [], brands: [], error });
const slim = (c: Chat) => ({ ...c, answered: Boolean(c.text), text: "" }); // saved chats drop the long text, like manual runs

/** Run jobs a few at a time. */
async function pool<T>(items: T[], fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

/** Count one answer against the workspace's daily limit. */
async function take(sb: SupabaseClient, ws: string) {
  const { data, error } = await sb.rpc("take_answer", { p_ws: ws });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/** Every question this run still needs, minus the ones answered or already queued. */
const seedOf = (id: string) => [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 100003, 7);

function todo(run: Row, engines: Engine[]) {
  const have = new Set([...run.chats.map((c) => key(c.engine, c.prompt)), ...run.queued.map((q) => key(q.engine, q.prompt))]);
  return run.engines
    .filter((e): e is Engine => engines.includes(e as Engine))
    .flatMap((engine) => (run.prompts ?? []).map((prompt) => ({ engine, prompt })))
    .filter((j) => !have.has(key(j.engine, j.prompt)));
}

export async function POST(request: Request) {
  if (!allowed(request)) return Response.json({ error: "Wrong or missing CRON_SECRET." }, { status: 401 });
  const sb = adminClient();
  if (!sb) return Response.json({ error: "Add SUPABASE_SECRET_KEY on Render." }, { status: 500 });
  if (await queueReady()) return Response.json({ done: true, message: "The job queue runs daily checks now." });
  const engines = availableEngines();
  if (!engines.length) return Response.json({ done: true, message: "No engine keys are set." });
  const fail = (error: { message: string }) => Response.json({ error: error.message }, { status: 500 });

  // Close daily runs that never finished, so a crashed job does not block tomorrow.
  const stale = new Date(Date.now() - DAY_MS).toISOString();
  let res = await sb.from("runs").update({ status: "done", queued: [] }).eq("source", "daily").eq("status", "running").lt("at", stale);
  if (res.error) return fail(res.error);

  // 1. Start a daily run for every brand that has daily runs on and no run in the last 20 hours.
  const brands = await sb.from("brands").select("id, workspace_id, name, domain, prompts, daily").order("created_at");
  if (brands.error) return fail(brands.error);
  const recent = await sb.from("runs").select("brand_id").gte("at", stale);
  if (recent.error) return fail(recent.error);
  const ran = new Set((recent.data ?? []).map((r) => r.brand_id));
  const plans = new Map<string, Awaited<ReturnType<typeof entitlement>>>();
  for (const w of new Set((brands.data ?? []).map((b) => b.workspace_id))) plans.set(w, await entitlement(w));
  const room = (b: { id: string; workspace_id: string }) =>
    promptAllowance((brands.data ?? []).filter((x) => x.workspace_id === b.workspace_id), plans.get(b.workspace_id)!.limits).get(b.id) ?? 0;
  const fresh = (brands.data ?? [])
    .filter((b) => b.daily && !ran.has(b.id) && b.prompts?.length && !plans.get(b.workspace_id)?.readOnly && room(b) > 0)
    // Weekly plans check each brand on its own day of the week.
    .filter((b) => checkDue(seedOf(b.id), plans.get(b.workspace_id)?.limits.checkEvery ?? 1))
    // Claude and Perplexity answer through their own paid APIs, so they are checked once a week, on the brand's own day.
    .map((b) => ({
      workspace_id: b.workspace_id,
      brand_id: b.id,
      source: "daily",
      status: "running",
      engines: engines.filter((e) => !WEEKLY_ENGINES.includes(e) || checkDue(seedOf(b.id), 7)),
      prompts: b.prompts.slice(0, room(b)),
      chats: [],
    }));
  if (fresh.length) {
    res = await sb.from("runs").insert(fresh);
    if (res.error) return fail(res.error);
  }

  const open = await sb
    .from("runs")
    .select("id, at, workspace_id, brand_id, engines, prompts, chats, queued")
    .eq("source", "daily")
    .eq("status", "running")
    .order("at")
    .limit(50);
  if (open.error) return fail(open.error);
  const runs = (open.data ?? []) as Row[];
  if (!runs.length) return Response.json({ done: true, started: fresh.length });
  const brandOf = new Map((brands.data ?? []).filter((b) => b.daily).map((b) => [b.id, b as { name: string; domain: string }]));

  let queuedNow = 0;
  let answeredNow = 0;
  try {
    // 2. Queue every DataForSEO question for every open run. Posting is quick, and the clock starts sooner.
    for (const run of runs) {
      const jobs = todo(run, engines).filter((j) => viaDfs(j.engine));
      if (!jobs.length) continue;
      // Over the daily limit, a question is saved as an error so it is not tried again today.
      const allowedJobs: typeof jobs = [];
      for (const j of jobs) {
        if (await take(sb, run.workspace_id)) allowedJobs.push(j);
        else run.chats.push(failed(j.engine, j.prompt, LIMIT));
      }
      const byEngine = new Map<DfsEngine, string[]>();
      for (const j of allowedJobs) byEngine.set(j.engine as DfsEngine, [...(byEngine.get(j.engine as DfsEngine) ?? []), j.prompt]);
      const at = new Date().toISOString();
      await metered(run.workspace_id, "daily check", async () => {
        for (const [engine, prompts] of byEngine) {
          const ids = await postTasks(engine, prompts);
          prompts.forEach((prompt, i) => run.queued.push({ id: ids[i], engine, prompt, at }));
        }
      });
      queuedNow += allowedJobs.length;
      res = await sb.from("runs").update({ queued: run.queued, chats: run.chats }).eq("id", run.id);
      if (res.error) return fail(res.error);
    }

    // 3 and 4. Work on the oldest run that has direct questions left or queued answers to collect.
    const run = runs.find((r) => todo(r, engines).some((j) => !viaDfs(j.engine)) || r.queued.length);
    if (!run) return Response.json({ done: true, queued: queuedNow });
    const brand = brandOf.get(run.brand_id);
    if (!brand) {
      await sb.from("runs").update({ status: "done", queued: [] }).eq("id", run.id);
      return Response.json({ done: false, skipped: "brand removed or daily runs turned off" });
    }

    const results: Chat[] = [];
    const direct = todo(run, engines).filter((j) => !viaDfs(j.engine)).slice(0, BATCH);
    const stillQueued: Queued[] = [];
    const toCheck = run.queued.slice(0, CHECKS);
    await metered(run.workspace_id, "daily check", async () => {
      await pool(direct, async (j) => {
        if (await take(sb, run.workspace_id)) results.push(await answerChat(j.engine, j.prompt, brand.name, brand.domain));
        else results.push(failed(j.engine, j.prompt, LIMIT));
      });

      await pool(toCheck, async (q) => {
        if (!q.id) return void results.push(failed(q.engine, q.prompt, `${q.engine}: DataForSEO did not accept this task.`));
        const t = await getTask(q.engine, q.id).catch((e) => ({ state: "failed" as const, error: e instanceof Error ? e.message : String(e) }));
        if (t.state === "done") results.push(await readAnswer(q.engine, q.prompt, t.answer, brand.name, brand.domain));
        else if (t.state === "failed") results.push(failed(q.engine, q.prompt, t.error));
        else if (Date.now() - new Date(q.at).getTime() > GIVE_UP_MS) results.push(failed(q.engine, q.prompt, `${q.engine}: DataForSEO took too long.`));
        else stillQueued.push(q);
      });
    });
    const queued = [...stillQueued, ...run.queued.slice(CHECKS)];
    answeredNow = results.length;

    await saveAnswers(sb, answerRows(results, { workspace_id: run.workspace_id, brand_id: run.brand_id, run_id: run.id, at: new Date().toISOString() }));
    const chats = [...run.chats, ...results.map(slim)];
    const left = todo({ ...run, chats, queued }, engines).length;
    const status = left || queued.length ? "running" : chats.some((c) => c.error === LIMIT) ? "limited" : "done";
    res = await sb.from("runs").update({ chats, queued, status }).eq("id", run.id);
    if (res.error) return fail(res.error);

    // Nothing new this call means the job is only waiting on DataForSEO. The script waits a minute, then asks again.
    const waiting = !queuedNow && !answeredNow;
    return Response.json({ done: false, run: run.id, queued: queuedNow, answered: answeredNow, waitingOn: queued.length, left, status, waiting });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
