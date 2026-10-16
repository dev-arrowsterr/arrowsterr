import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CREATE_CREDITS, isPending, normalizeSection, SECTIONS, type ResearchRow, type SectionId } from "./industry";
import { finish, retry, type Job } from "./jobs";
import { charge } from "./meter";

// SparkToro (https://sparktoro.com/api/docs): who a brand's audience reads, follows and listens to.
// A report is built from a plain description of the audience, then each section is read by report id.
// SparkToro charges each section once per report and billing period, so reading it again is free.

const API = () => process.env.SPARKTORO_API_URL?.trim().replace(/\/+$/, "") || "https://api.sparktoro.com";
const KEY = () => process.env.SPARKTORO_API_KEY?.trim() ?? "";
const CREDIT_USD = () => Number(process.env.SPARKTORO_CREDIT_USD) || 0.1; // the 5,000-credit bundle price
const GIVE_UP_MS = 45 * 60_000; // a report still building after this is marked failed
export const sparktoroReady = () => Boolean(KEY());
export const NO_KEY = "Add SPARKTORO_API_KEY to the server's settings.";

type Reply = { status: number; body: unknown };

async function request(path: string, init: { method?: string; body?: unknown } = {}): Promise<Reply> {
  const res = await fetch(`${API()}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${KEY()}`, "Content-Type": "application/json", Accept: "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const message = (r: Reply) => {
  const b = r.body as { error?: unknown; message?: unknown } | null;
  const text = typeof b?.error === "string" ? b.error : typeof b?.message === "string" ? b.message : "";
  return `SparkToro returned ${r.status}${text ? `: ${text}` : ""}`;
};

/** Start a report for the audience described. Returns SparkToro's report id. */
async function createReport(audience: string): Promise<string> {
  const r = await request("/v3/describe/create", { method: "POST", body: { prompt: audience } });
  if (r.status >= 400) throw new Error(message(r));
  const b = (r.body ?? {}) as { report_id?: unknown; id?: unknown; data?: { report_id?: unknown; id?: unknown } };
  const id = [b.report_id, b.id, b.data?.report_id, b.data?.id].find((x) => typeof x === "string" || typeof x === "number");
  if (id === undefined) throw new Error("SparkToro did not return a report id.");
  charge("sparktoro", CREATE_CREDITS * CREDIT_USD());
  return String(id);
}

/** One section of a report: its rows, or "waiting" while SparkToro is still building it. */
async function readSection(id: SectionId, reportId: string): Promise<ResearchRow[] | "waiting"> {
  const s = SECTIONS.find((x) => x.id === id)!;
  for (const path of s.paths) {
    const r = await request(`${path}?report_id=${encodeURIComponent(reportId)}`);
    if (r.status === 404 && path !== s.paths.at(-1)) continue; // try the other path style
    if (r.status === 202 || r.status === 425 || isPending(r.body)) return "waiting";
    if (r.status >= 400) throw new Error(message(r));
    charge("sparktoro", s.credits * CREDIT_USD());
    return normalizeSection(id, r.body);
  }
  throw new Error(`SparkToro has no ${s.label} section.`);
}

/** The audience a brand's report is built from. */
export const audienceOf = (domain: string) => `People who visit ${domain}`;

/** The industry job: build the report, then read each section as it becomes ready. */
export async function industry(db: SupabaseClient, job: Job) {
  const { brandId } = job.payload as { brandId: string };
  const { data: row } = await db.from("industry_research").select("status, report_id, sections, started_at, audience").eq("brand_id", brandId).maybeSingle();
  if (!row || row.status !== "running") return finish(job.id);
  const fail = async (error: string) => {
    await db.from("industry_research").update({ status: "failed", error }).eq("brand_id", brandId);
    await finish(job.id);
  };
  if (!sparktoroReady()) return fail(NO_KEY);
  if (Date.now() - Date.parse(row.started_at) > GIVE_UP_MS) return fail("SparkToro took too long to build the report. Try again later.");

  try {
    if (!row.report_id) {
      const reportId = await createReport(row.audience);
      const { error } = await db.from("industry_research").update({ report_id: reportId }).eq("brand_id", brandId);
      if (error) throw new Error(error.message);
      return retry(job.id, "waiting on SparkToro", 60, { count: false });
    }
    const sections = { ...((row.sections ?? {}) as Record<string, ResearchRow[]>) };
    let waiting = false;
    for (const s of SECTIONS) {
      if (sections[s.id]) continue;
      const got = await readSection(s.id, row.report_id);
      if (got === "waiting") waiting = true;
      else sections[s.id] = got;
    }
    const done = !waiting;
    const { error } = await db
      .from("industry_research")
      .update({ sections, ...(done ? { status: "done", error: null, updated_at: new Date().toISOString() } : {}) })
      .eq("brand_id", brandId);
    if (error) throw new Error(error.message);
    if (done) return finish(job.id);
    return retry(job.id, "waiting on SparkToro", 60, { count: false });
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    // Out of credits or a bad key won't fix itself. Anything else gets the queue's normal retries.
    if (/returned (401|402|403)/.test(text) || job.attempts + 1 >= job.max_attempts) return fail(text);
    throw e;
  }
}
