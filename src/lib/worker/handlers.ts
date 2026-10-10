import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAgent } from "../agent";
import { readAnswer } from "../answer";
import { runBrief } from "../brief";
import type { Chat } from "../chats";
import { getTask, postTasks, type DfsAnswer, type DfsEngine } from "../dataforseo";
import { answerRows, saveAnswers, type Profile } from "../db";
import { askEngine, availableEngines, viaDfs, WEEKLY_ENGINES, type Engine } from "../engines";
import { entitlement } from "../entitlements";
import { enqueue, enqueueMany, finish, rateOk, retry, type Job } from "../jobs";
import { checkDue, promptAllowance } from "../plans";
import type { PlanBrief } from "../research";

// What each kind of job does. A handler either finishes its job, or puts it back with retry().
// Throwing counts as a failed attempt: the worker retries it with a growing wait.

export const LIMIT = "Daily limit reached. This workspace used all its AI answers for today.";
const STALE_MS = 20 * 3600_000; // a daily run still open after this is closed
const GIVE_UP_MS = 3 * 3600_000; // a DataForSEO task still queued after this is marked failed
const WINDOW_MIN = 20 * 60; // daily checks start between 00:00 and 20:00 UTC, one slot per brand

const promptKey = (p: string) => p.toLowerCase().replace(/\s+/g, " ").trim();
const failed = (engine: string, prompt: string, error: string): Chat => ({ engine, prompt, text: "", sources: [], brands: [], error });
const slim = (c: Chat) => ({ ...c, answered: Boolean(c.text), text: "" }); // saved chats drop the long text
const seed = (id: string) => [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 100003, 7);
const today = () => new Date().toISOString().slice(0, 10);

/** The minute of the day (UTC) a brand's daily check starts. Spreads the load over the day. */
export const slotOf = (brandId: string) => seed(brandId) % WINDOW_MIN;

// ─────────────── schedule: start today's runs that are due ───────────────
export async function schedule(db: SupabaseClient, job: Job) {
  const engines = availableEngines();
  if (!engines.length) return finish(job.id);
  const now = new Date();
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  const dayStart = `${today()}T00:00:00Z`;

  // Close daily runs that never finished, so a crash never blocks tomorrow.
  await db.from("runs").update({ status: "done" }).eq("source", "daily").eq("status", "running").lt("at", new Date(Date.now() - STALE_MS).toISOString());

  const { data: brands, error } = await db.from("brands").select("id, workspace_id, name, domain, prompts, daily").order("created_at");
  if (error) throw new Error(error.message);
  const { data: ran } = await db.from("runs").select("brand_id").eq("source", "daily").gte("at", dayStart);
  const started = new Set((ran ?? []).map((r) => r.brand_id));
  const due = (brands ?? []).filter((b) => b.daily && b.prompts?.length && !started.has(b.id) && slotOf(b.id) <= minute);

  const allowance = new Map<string, Map<string, number>>();
  for (const b of due) {
    const e = await entitlement(b.workspace_id);
    if (e.readOnly) continue;
    // Only what the plan covers is checked. The rest stays paused until the plan grows.
    if (!allowance.has(b.workspace_id)) allowance.set(b.workspace_id, promptAllowance((brands ?? []).filter((x) => x.workspace_id === b.workspace_id), e.limits));
    const prompts: string[] = (b.prompts as string[]).slice(0, allowance.get(b.workspace_id)!.get(b.id) ?? 0);
    if (!prompts.length) continue;
    // Weekly plans check each brand on its own day of the week, so the load stays even.
    if (!checkDue(seed(b.id), e.limits.checkEvery)) continue;
    // Claude and Perplexity answer through their own paid APIs, so they are checked once a week, on the brand's own day.
    const list = engines.filter((e) => !WEEKLY_ENGINES.includes(e) || checkDue(seed(b.id), 7));
    const { data: run, error: err } = await db
      .from("runs")
      .insert({ workspace_id: b.workspace_id, brand_id: b.id, source: "daily", status: "running", engines: list, prompts, chats: [], expected: list.length * prompts.length })
      .select("id")
      .single();
    if (err || !run) throw new Error(err?.message ?? "Could not start a run.");
    await enqueueMany(
      list.flatMap((engine) =>
        prompts.map((prompt, i) => ({
          kind: "check" as const,
          workspace_id: b.workspace_id,
          key: `check:${run.id}:${engine}:${i}`,
          payload: { runId: run.id, brandId: b.id, brand: b.name, domain: b.domain, engine, prompt, day: today() },
        })),
      ),
    );
  }
  await finish(job.id);
}

// ─────────────── check: one prompt on one AI for one brand ───────────────
type CheckPayload = { runId: string; brandId: string; brand: string; domain: string; engine: Engine; prompt: string; day: string; taskId?: string | null; postedAt?: number; counted?: boolean };

async function shared(db: SupabaseClient, p: CheckPayload): Promise<DfsAnswer | null> {
  const { data } = await db.from("shared_answers").select("answer").eq("engine", p.engine).eq("prompt_key", promptKey(p.prompt)).eq("day", p.day).maybeSingle();
  return (data?.answer as DfsAnswer | undefined) ?? null;
}
async function share(db: SupabaseClient, p: CheckPayload, answer: DfsAnswer) {
  await db.from("shared_answers").upsert({ engine: p.engine, prompt_key: promptKey(p.prompt), day: p.day, answer }, { onConflict: "engine,prompt_key,market,day", ignoreDuplicates: true });
}

/** Save the chat to its run. When it was the run's last chat, queue its daily numbers. */
async function record(db: SupabaseClient, job: Job, p: CheckPayload, chat: Chat) {
  if (chat.text) await saveAnswers(db, answerRows([chat], { workspace_id: job.workspace_id!, brand_id: p.brandId, run_id: p.runId, at: new Date().toISOString() }));
  const { data: last, error } = await db.rpc("append_chat", { p_run: p.runId, p_chat: slim(chat) });
  if (error) throw new Error(error.message);
  if (last) await enqueue("rollup", { runId: p.runId }, { workspaceId: job.workspace_id, key: `rollup:${p.runId}` });
  await finish(job.id);
}

/** Count one answer against the workspace's daily limit, once per job. */
async function counted(db: SupabaseClient, job: Job, p: CheckPayload) {
  if (p.counted) return true;
  const { data, error } = await db.rpc("take_answer", { p_ws: job.workspace_id });
  if (error) throw new Error(error.message);
  if (data) p.counted = true;
  return Boolean(data);
}

export async function check(db: SupabaseClient, job: Job) {
  const p = job.payload as unknown as CheckPayload;
  if (job.attempts >= job.max_attempts) return record(db, job, p, failed(p.engine, p.prompt, `${p.engine}: gave up after ${job.attempts} tries.`));

  let answer = await shared(db, p);
  if (!answer && viaDfs(p.engine)) {
    const engine = p.engine as DfsEngine;
    if (!p.taskId) {
      // Queue the question at DataForSEO (the cheap way). The answer is ready in up to about 45 minutes.
      if (!(await rateOk("dataforseo"))) return retry(job.id, "rate limit", 20, { count: false });
      if (!(await counted(db, job, p))) return record(db, job, p, failed(p.engine, p.prompt, LIMIT));
      const [id] = await postTasks(engine, [p.prompt]);
      if (!id) return record(db, job, p, failed(p.engine, p.prompt, `${p.engine}: DataForSEO did not accept this task.`));
      return retry(job.id, "waiting on DataForSEO", 300, { payload: { ...p, taskId: id, postedAt: Date.now() }, count: false });
    }
    const t = await getTask(engine, p.taskId);
    if (t.state === "waiting") {
      if (Date.now() - (p.postedAt ?? Date.now()) > GIVE_UP_MS) return record(db, job, p, failed(p.engine, p.prompt, `${p.engine}: DataForSEO took too long.`));
      return retry(job.id, "waiting on DataForSEO", 180, { count: false });
    }
    if (t.state === "failed") return record(db, job, p, failed(p.engine, p.prompt, t.error));
    answer = t.answer;
    await share(db, p, answer);
  } else if (!answer) {
    const provider = { ChatGPT: "openai", Gemini: "gemini", Claude: "anthropic", Perplexity: "perplexity" }[p.engine as string] ?? "other";
    if (!(await rateOk(provider))) return retry(job.id, "rate limit", 15, { count: false });
    if (!(await counted(db, job, p))) return record(db, job, p, failed(p.engine, p.prompt, LIMIT));
    try {
      answer = await askEngine(p.engine, p.prompt);
    } catch (e) {
      // Keep the counted flag, so the retry does not count this answer twice.
      await retry(job.id, e instanceof Error ? e.message : String(e), 30 * 2 ** job.attempts, { payload: { ...p } });
      return;
    }
    await share(db, p, answer);
  } else if (!(await counted(db, job, p))) {
    return record(db, job, p, failed(p.engine, p.prompt, LIMIT));
  }
  // Only the brand reading runs per brand. The answer itself was paid for once.
  await record(db, job, p, await readAnswer(p.engine, p.prompt, answer, p.brand, p.domain));
}

// ─────────────── rollup: the daily numbers for a finished run ───────────────
export async function rollup(db: SupabaseClient, job: Job) {
  const { runId } = job.payload as { runId: string };
  const { data: run } = await db.from("runs").select("brand_id, workspace_id, at, chats").eq("id", runId).maybeSingle();
  if (!run) return finish(job.id);
  const { data: brand } = await db.from("brands").select("name").eq("id", run.brand_id).maybeSingle();
  const you = (brand?.name ?? "").toLowerCase();
  const day = String(run.at).slice(0, 10);
  type Row = { brand_id: string; workspace_id: string; day: string; engine: string; named: string; is_you: boolean; answers: number; mentions: number; position_sum: number; sentiment_sum: number };
  const rows = new Map<string, Row>();
  const row = (engine: string, named: string) => {
    const k = `${engine}\n${named}`;
    if (!rows.has(k)) rows.set(k, { brand_id: run.brand_id, workspace_id: run.workspace_id, day, engine, named, is_you: named.toLowerCase() === you, answers: 0, mentions: 0, position_sum: 0, sentiment_sum: 0 });
    return rows.get(k)!;
  };
  for (const c of (run.chats ?? []) as Chat[]) {
    if (c.error || !(c.answered ?? Boolean(c.text))) continue;
    row(c.engine, "").answers++;
    for (const b of c.brands) {
      const r = row(c.engine, b.name);
      r.mentions++;
      r.position_sum += b.position;
      r.sentiment_sum += b.sentiment;
    }
  }
  // Every brand row also carries the day's answer count for its AI, so a share is mentions / answers.
  for (const r of rows.values()) r.answers = rows.get(`${r.engine}\n`)?.answers ?? r.answers;
  const list = [...rows.values()];
  for (let i = 0; i < list.length; i += 500) {
    const { error } = await db.from("daily_metrics").upsert(list.slice(i, i + 500), { onConflict: "brand_id,day,engine,named" });
    if (error) throw new Error(error.message);
  }
  await finish(job.id);
}

// ─────────────── brief and plan: long AI work, off the web server ───────────────
async function giveBack(db: SupabaseClient, ws: string | null, metric: string, period: string | undefined) {
  if (ws && period) await db.rpc("give_back", { p_ws: ws, p_metric: metric, p_period: period, p_n: 1 });
}

export async function brief(db: SupabaseClient, job: Job) {
  const { itemId, period, tasks, fromPack } = job.payload as { itemId: string; period?: string; tasks?: number; fromPack?: number };
  await runBrief(db, itemId);
  // A brief that failed hands its tasks back.
  const { data } = await db.from("calendar_items").select("brief_status").eq("id", itemId).maybeSingle();
  if (data?.brief_status === "failed" && job.workspace_id && period) {
    const n = tasks ?? 75;
    const { error } = await db.rpc("give_back_tasks", { p_ws: job.workspace_id, p_period: period, p_plan_n: n - (fromPack ?? 0), p_pack_n: fromPack ?? 0 });
    if (error) await giveBack(db, job.workspace_id, "tasks", period);
  }
  await finish(job.id);
}

export async function plan(db: SupabaseClient, job: Job) {
  const { runId, site, period } = job.payload as { runId: string; site: { id: string; domain: string; name: string; profile: Profile; brief?: PlanBrief }; period?: string };
  await runAgent(db, runId, site);
  const { data } = await db.from("keyword_runs").select("status").eq("id", runId).maybeSingle();
  if (data?.status === "failed") await giveBack(db, job.workspace_id, "plans", period);
  await finish(job.id);
}
