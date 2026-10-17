import "server-only";
import { lookup } from "node:dns/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { call } from "./dataforseo";
import { askEngine, availableEngines, viaDfs, type Engine } from "./engines";
import { enqueue, finish, rateOk, retry, type Job } from "./jobs";
import { UA, safeFetch } from "./safeFetch";
import { cleanRead, readSerp, research, vetPage, type Deps, type NewPage, type Run, type SkipReason, type Store, type VetDeps } from "./articleResearch";

// The database and paid calls behind article research (articleResearch.ts), the article_research job,
// and the Fly worker's side of reading pages (/api/research/render-next and render-done).

const must = <T>(r: { data: T; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message + (/article_/.test(r.error.message) ? " Run supabase/049_article_research.sql in Supabase." : ""));
  return r.data;
};

export function supaStore(db: SupabaseClient): Store {
  return {
    run: async (id) => must(await db.from("article_runs").select("*").eq("id", id).maybeSingle()) as Run | null,
    updateRun: async (id, patch) => void must(await db.from("article_runs").update(patch).eq("id", id)),
    serpRows: async (runId) => must(await db.from("article_serp").select("run_id, position, url, title, snippet, domain").eq("run_id", runId).order("position")) ?? [],
    addSerpRows: async (rows) => void (rows.length && must(await db.from("article_serp").upsert(rows, { onConflict: "run_id,position", ignoreDuplicates: true }))),
    answers: async (runId) => must(await db.from("article_ai_answers").select("run_id, engine, question, answer, cited, error").eq("run_id", runId)) ?? [],
    addAnswer: async (row) => void must(await db.from("article_ai_answers").upsert(row, { onConflict: "run_id,engine", ignoreDuplicates: true })),
    pages: async (runId) => must(await db.from("article_pages").select("id, run_id, url, source, status, skip_reason, attempts, locked_until").eq("run_id", runId)) ?? [],
    addPages: async (rows: NewPage[]) => void (rows.length && must(await db.from("article_pages").upsert(rows, { onConflict: "run_id,url", ignoreDuplicates: true }))),
    updatePages: async (ids, patch) => void (ids.length && must(await db.from("article_pages").update(patch).in("id", ids))),
  };
}

const PROVIDER: Record<string, string> = { ChatGPT: "openai", Gemini: "gemini", Claude: "anthropic", Perplexity: "perplexity" };

const deps: Deps = {
  // One live call for the top 10, People Also Ask and AI Overview. Depth 10: DataForSEO prices by the page of results.
  async serp(keyword) {
    const [task] = await call("serp/google/organic/live/advanced", [
      {
        keyword: keyword.slice(0, 700),
        location_code: Number(process.env.DFS_LOCATION_CODE) || 2840, // United States
        language_code: process.env.DFS_LANGUAGE_CODE || "en",
        device: "desktop",
        depth: 10,
        load_async_ai_overview: true,
        expand_ai_overview: true,
      },
    ]);
    if (task?.status_code !== 20000) throw new Error(`DataForSEO: ${task?.status_message ?? "no result"}`);
    return readSerp(task.result?.[0]);
  },
  ask: (engine, question) => askEngine(engine as Engine, question),
  engines: () => availableEngines(),
  rateOk: (engine) => rateOk(engine === "serp" || viaDfs(engine) ? "dataforseo" : (PROVIDER[engine] ?? "other")),
};

// ─────────────── start ───────────────
/**
 * Start research for one content plan item, or pick up the one already open. Returns the run.
 * A finished run for the same keyword is reused (nothing is paid again) unless fresh is set (Regenerate).
 */
export async function startArticleResearch(db: SupabaseClient, opts: { workspaceId: string; itemId: string; userId?: string | null; fresh?: boolean }): Promise<{ runId: string; started: boolean }> {
  const item = must(await db.from("calendar_items").select("id, workspace_id, site_id, keyword").eq("id", opts.itemId).eq("workspace_id", opts.workspaceId).maybeSingle()) as { id: string; workspace_id: string; site_id: string; keyword: string } | null;
  if (!item) throw new Error("Calendar item not found.");
  const latest = must(await db.from("article_runs").select("id, status, keyword").eq("item_id", item.id).neq("status", "failed").order("created_at", { ascending: false }).limit(1).maybeSingle()) as { id: string; status: string; keyword: string } | null;
  const open = latest && latest.status !== "done";
  if (latest && (open || (!opts.fresh && latest.keyword === item.keyword))) {
    if (open) await queueRun(db, latest.id, item.workspace_id);
    return { runId: latest.id, started: false };
  }
  const site = must(await db.from("sites").select("brand_id").eq("id", item.site_id).maybeSingle()) as { brand_id: string | null } | null;
  const { data, error } = await db
    .from("article_runs")
    .insert({ workspace_id: item.workspace_id, site_id: item.site_id, brand_id: site?.brand_id ?? null, item_id: item.id, keyword: item.keyword, created_by: opts.userId ?? null })
    .select("id")
    .single();
  // Two starts at once: the open-run index lets one in. Use that one.
  if (error?.code === "23505") return startArticleResearch(db, { ...opts, fresh: false });
  const run = must({ data, error }) as { id: string };
  await queueRun(db, run.id, item.workspace_id);
  return { runId: run.id, started: true };
}

/** Make sure an open run has a live job. A job that died is woken up again. */
async function queueRun(db: SupabaseClient, runId: string, workspaceId: string) {
  const key = `article_research:${runId}`;
  const id = await enqueue("article_research", { runId }, { workspaceId, key, maxAttempts: 6 });
  if (id !== null) return;
  await db.from("jobs").update({ status: "queued", attempts: 0, run_at: new Date().toISOString(), finished_at: null, last_error: null }).eq("key", key).in("status", ["dead", "done"]);
}

// ─────────────── the job ───────────────
/** article_research: run what is left of the research, then wait on the worker reading the pages. */
export async function articleResearchJob(db: SupabaseClient, job: Job) {
  const runId = String((job.payload as { runId?: string }).runId ?? "");
  let out;
  try {
    out = await research(supaStore(db), deps, runId);
  } catch (e) {
    // A paid call or the database failed. The worker route retries with a growing wait, up to max_attempts.
    if (job.attempts < job.max_attempts) throw e;
    const error = e instanceof Error ? e.message : String(e);
    await db.from("article_runs").update({ status: "failed", error: error.slice(0, 1000), finished_at: new Date().toISOString() }).eq("id", runId).not("status", "in", "(done,failed)");
    return finish(job.id);
  }
  if (out.state === "wait") return retry(job.id, out.why, out.seconds, { count: false });
  return finish(job.id);
}

// ─────────────── the worker reading pages ───────────────
const LEASE_S = 90; // 20 seconds a page, plus the trip
const ROBOTS_MS = 3600_000;
const robotsSeen = new Map<string, { at: number; value: { status: number; body: string } | null }>();

const vetDeps: VetDeps = {
  resolve: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
  async robots(origin) {
    const hit = robotsSeen.get(origin);
    if (hit && Date.now() - hit.at < ROBOTS_MS) return hit.value;
    // safeFetch refuses private networks at connect time, so robots.txt can't be pointed inward either.
    const r = await safeFetch(`${origin}/robots.txt`, { timeout: 8_000, maxBytes: 500_000, accept: "text/plain,*/*;q=0.5", ua: UA });
    const value = r.status ? { status: r.status, body: r.ok ? r.body : "" } : null;
    if (robotsSeen.size > 2000) robotsSeen.clear();
    robotsSeen.set(origin, { at: Date.now(), value });
    return value;
  },
};

const skip = (db: SupabaseClient, id: number, worker: string, reason: SkipReason, error: string) =>
  db.from("article_pages").update({ status: "skipped", skip_reason: reason, error: error.slice(0, 500), locked_until: null }).eq("id", id).eq("locked_by", worker).eq("status", "rendering");

/**
 * The next page for a worker to read, leased for 90 seconds. Before it goes out, the address must be public
 * (every address its name points to) and robots.txt must allow it; a page that fails either is skipped.
 */
export async function leaseNextPage(db: SupabaseClient, worker: string): Promise<{ id: number; url: string } | null> {
  for (let i = 0; i < 10; i++) {
    const rows = must(await db.rpc("lease_article_page", { p_worker: worker, p_lease_seconds: LEASE_S })) as { id: number; url: string }[] | null;
    const page = rows?.[0];
    if (!page) return null;
    const vet = await vetPage(page.url, vetDeps);
    if (vet.ok) return { id: page.id, url: page.url };
    await skip(db, page.id, worker, vet.reason, vet.error);
  }
  return null;
}

const FAIL_REASONS: SkipReason[] = ["timeout", "failed", "blocked", "private", "empty"];
const MIN_WORDS = 100; // less than this is a cookie wall, a login or an error page

/** What the worker read, or why it could not. Only the worker holding the lease may answer. */
export async function savePage(db: SupabaseClient, worker: string, id: number, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const row = must(await db.from("article_pages").select("id, url, status, locked_by").eq("id", id).maybeSingle()) as { id: number; url: string; status: string; locked_by: string | null } | null;
  if (!row || row.status !== "rendering" || row.locked_by !== worker) return { ok: false, error: "This page is not leased to this worker." };
  if (body.ok !== true) {
    const reason = FAIL_REASONS.includes(body.reason as SkipReason) ? (body.reason as SkipReason) : "failed";
    await skip(db, id, worker, reason, String(body.error ?? "The page could not be read."));
    return { ok: true };
  }
  // The page may have redirected anywhere: check where it ended up, as before it went out.
  const finalUrl = typeof body.final_url === "string" && body.final_url ? body.final_url : row.url;
  const sameOrigin = (() => {
    try {
      return new URL(finalUrl).origin === new URL(row.url).origin;
    } catch {
      return false;
    }
  })();
  const vet = await vetPage(finalUrl, vetDeps, { robots: !sameOrigin });
  if (!vet.ok) {
    await skip(db, id, worker, vet.reason, `After redirects: ${vet.error}`);
    return { ok: true };
  }
  const read = cleanRead(body);
  if (read.word_count < MIN_WORDS) {
    await skip(db, id, worker, "empty", `Only ${read.word_count} words could be read.`);
    return { ok: true };
  }
  must(
    await db
      .from("article_pages")
      .update({ ...read, status: "done", skip_reason: null, error: null, final_url: finalUrl.slice(0, 2000), locked_until: null, read_at: new Date().toISOString() })
      .eq("id", id)
      .eq("locked_by", worker)
      .eq("status", "rendering"),
  );
  return { ok: true };
}
