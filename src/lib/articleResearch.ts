// Article research, steps 1 to 3 (docs/content-v2.md, "How one article is made").
//   1. Google's top 10, People Also Ask and AI Overview (DataForSEO).
//   2. Each result queued for the Fly worker to read in Chromium.
//   3. The keyword asked as a question to the AI engines; their cited links queued for reading too.
// Every step saves its output before the next starts, so a retried job resumes and never pays twice.
// Pure: the database and the paid calls come in as `store` and `deps` (articleResearchServer.ts), so tests run it offline.
import { isIP } from "node:net";
import { privateIp } from "./netCheck.ts";
import { cleanSources, domainOf, type Source } from "./sources.ts";

export const MIN_PAGES = 5; // an article needs this many pages read
export const AI_ENGINES = 4; // engines asked in step 3
export const MAX_CITED = 10; // cited pages read in step 3
export const MAX_PAGE_ATTEMPTS = 3; // tries per page, across rounds
export const MAX_ROUNDS = 2; // times a run waits for more pages before it fails
export const ROUND_WAIT_S = 15 * 60; // the wait before a round
export const POLL_S = 30; // how often the job looks at the pages while they are read
export const ENOUGH_AFTER_MS = 10 * 60_000; // with 5 pages read, stop waiting for the rest after this
export const DEADLINE_MS = 3 * 3600_000; // a run still open after this finishes with what it has
export const BODY_MAX = 60_000; // characters of page text kept

// Engines in the order step 3 prefers them: the DataForSEO ones read the real apps and cost least.
// AI Overview is not asked: step 1 already has it, and its links are read with the rest.
const PREFERRED = ["ChatGPT", "Gemini", "AI Mode", "Perplexity", "Claude"];

// ─────────────── shapes ───────────────
export type RunStatus = "queued" | "searching" | "reading" | "waiting" | "done" | "failed";
export type Step = "serp" | "pages" | "ai" | "reading" | "done";
export type SkipReason = "robots" | "private" | "blocked" | "failed" | "timeout" | "empty" | "not_needed";
export type PageStatus = "queued" | "rendering" | "done" | "skipped";

export type Organic = { position: number; url: string; title: string | null; snippet: string | null; domain: string };
export type Paa = { question: string; answer: string | null; url: string | null };
export type AiOverview = { shown: boolean; text: string; sources: Source[] };
export type Serp = { organic: Organic[]; paa: Paa[]; aiOverview: AiOverview };
export type Answer = { text: string; sources: Source[] };

export type Run = {
  id: string;
  workspace_id: string;
  keyword: string;
  question: string | null;
  status: RunStatus;
  step: Step;
  serp_at: string | null;
  organic: Organic[];
  paa: Paa[];
  ai_overview: AiOverview | null;
  engines: string[] | null;
  ai_at: string | null;
  rounds: number;
  started_at: string;
};
export type SerpRow = { run_id: string; position: number; url: string; title: string | null; snippet: string | null; domain: string };
export type PageRow = { id: number; run_id: string; url: string; source: "serp" | "ai"; status: PageStatus; skip_reason: SkipReason | null; attempts: number; locked_until: string | null; read_at?: string | null };
export type NewPage = { run_id: string; url: string; source: "serp" | "ai"; position: number | null; status: PageStatus; skip_reason: SkipReason | null; error: string | null };
export type AnswerRow = { run_id: string; engine: string; question: string; answer: string | null; cited: Source[]; error: string | null };

/** Where a run's steps are saved. Inserts skip rows that already exist (the unique keys in 049). */
export type Store = {
  run(id: string): Promise<Run | null>;
  updateRun(id: string, patch: Partial<Run> & { error?: string | null; finished_at?: string | null }): Promise<void>;
  serpRows(runId: string): Promise<SerpRow[]>;
  addSerpRows(rows: SerpRow[]): Promise<void>;
  answers(runId: string): Promise<AnswerRow[]>;
  addAnswer(row: AnswerRow): Promise<void>;
  pages(runId: string): Promise<PageRow[]>;
  addPages(rows: NewPage[]): Promise<void>;
  updatePages(ids: number[], patch: Partial<Pick<PageRow, "status" | "skip_reason" | "locked_until">> & { error?: string | null }): Promise<void>;
};

/** The paid calls and the clock. */
export type Deps = {
  serp(keyword: string): Promise<Serp>;
  ask(engine: string, question: string): Promise<Answer>;
  engines(): string[]; // engines with keys on this server
  rateOk(engine: string | "serp"): Promise<boolean>; // false means wait, not fail
  now?: () => number;
};

export type Outcome = { state: "done" } | { state: "failed"; error: string } | { state: "wait"; seconds: number; why: string };

// ─────────────── step 1: reading DataForSEO's answer ───────────────
type Raw = { url?: string; domain?: string; title?: string };
type Item = {
  type?: string;
  rank_group?: number;
  url?: string;
  domain?: string;
  title?: string;
  description?: string;
  markdown?: string;
  text?: string;
  featured_title?: string;
  references?: Raw[];
  items?: Item[];
  expanded_element?: Item[];
};
const toSources = (list: Raw[] | undefined): Source[] => (list ?? []).filter((s) => s?.url).map((s) => ({ url: s.url!, title: s.title ?? null, domain: s.domain ?? "" }));
const clip = (s: unknown, n: number) => (typeof s === "string" && s.trim() ? s.trim().slice(0, n) : null);

/** Google's top 10, People Also Ask and AI Overview from one serp/google/organic advanced result. */
export function readSerp(result: { items?: Item[] } | undefined): Serp {
  const all = result?.items ?? [];
  const seen = new Set<string>();
  const organic: Organic[] = [];
  for (const i of all) {
    if (i.type !== "organic" || !i.url || organic.length >= 10) continue;
    const key = pageKey(i.url);
    if (seen.has(key)) continue;
    seen.add(key);
    organic.push({ position: organic.length + 1, url: i.url, title: clip(i.title, 300), snippet: clip(i.description, 1000), domain: (i.domain ?? domainOf(i.url)).replace(/^www\./, "") });
  }
  const paa: Paa[] = all
    .filter((i) => i.type === "people_also_ask")
    .flatMap((i) => i.items ?? [])
    .map((e) => {
      const x = e.expanded_element?.[0];
      return { question: clip(e.title, 300) ?? "", answer: clip(x?.description ?? x?.markdown ?? x?.text, 2000), url: x?.url ?? null };
    })
    .filter((q) => q.question)
    .slice(0, 10);
  const aio = all.find((i) => i.type === "ai_overview");
  const aiOverview: AiOverview = aio
    ? {
        shown: true,
        text: (aio.markdown || (aio.items ?? []).map((i) => [i.title ? `## ${i.title}` : "", i.markdown || i.text || ""].filter(Boolean).join("\n")).join("\n\n")).slice(0, 20_000),
        sources: cleanSources(toSources([...(aio.references ?? []), ...(aio.items ?? []).flatMap((i) => i.references ?? [])])),
      }
    : { shown: false, text: "", sources: [] };
  return { organic, paa, aiOverview };
}

// ─────────────── step 3: the question and the engines ───────────────
const QUESTION_WORD = /^(what|how|why|which|who|when|where|is|are|can|could|do|does|did|should|will|would)\b/i;

/** The keyword the way a person would ask an AI about it. */
export function asQuestion(keyword: string): string {
  const k = keyword.trim().replace(/\s+/g, " ").replace(/[?.!]+$/, "");
  if (!k) return "";
  if (QUESTION_WORD.test(k)) return `${k[0].toUpperCase()}${k.slice(1)}?`;
  const vs = k.split(/\s+(?:vs\.?|versus)\s+/i);
  if (vs.length === 2) return `Which is better, ${vs[0]} or ${vs[1]}?`;
  if (/^(best|top)\b/i.test(k)) return `What are the ${k}?`;
  return `What should I know about ${k}?`;
}

/** Up to n engines this server can ask, best first. */
export function pickEngines(available: string[], n = AI_ENGINES): string[] {
  return PREFERRED.filter((e) => available.includes(e)).slice(0, n);
}

/** One key per page: the same page with and without "www", a slash, a fragment or tracking counts once. */
export function pageKey(url: string): string {
  return url.replace(/#.*$/, "").replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "").toLowerCase();
}

/**
 * The cited pages to read: cleaned, without pages Google's results already queued, without repeats, at most cap.
 * Links cited by more engines come first, then in the order they were cited.
 */
export function citedToRead(answers: { cited: Source[] }[], already: string[], cap = MAX_CITED): string[] {
  const skip = new Set(already.map(pageKey));
  const count = new Map<string, { url: string; n: number; order: number }>();
  let order = 0;
  for (const a of answers) {
    const mine = new Set<string>();
    for (const s of cleanSources(a.cited)) {
      const key = pageKey(s.url);
      if (skip.has(key) || mine.has(key) || !pageUrlOk(s.url).ok) continue;
      mine.add(key);
      const c = count.get(key);
      if (c) c.n++;
      else count.set(key, { url: s.url, n: 1, order: order++ });
    }
  }
  return [...count.values()].sort((a, b) => b.n - a.n || a.order - b.order).slice(0, cap).map((c) => c.url);
}

// ─────────────── what may be read ───────────────
const LOCAL_NAMES = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa|in-addr\.arpa|ip6\.arpa|flycast)$/i;

/** A quick look at an address before any lookup: public web pages only, no logins in the address, the usual ports. */
export function pageUrlOk(url: string): { ok: true } | { ok: false; reason: SkipReason; error: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "failed", error: "Not a valid address." };
  }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, reason: "blocked", error: "Only web pages are read." };
  if (u.username || u.password) return { ok: false, reason: "blocked", error: "Pages behind a login are not read." };
  if (u.port && u.port !== "80" && u.port !== "443") return { ok: false, reason: "private", error: "Only the usual web ports are read." };
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host)) return privateIp(host) ? { ok: false, reason: "private", error: "That address points to a private network." } : { ok: true };
  if (!host.includes(".") || LOCAL_NAMES.test(host)) return { ok: false, reason: "private", error: "That address points to a private network." };
  return { ok: true };
}

/**
 * True when robots.txt lets agent read path (RFC 9309): the group naming the agent, else "*";
 * the longest matching rule wins, and Allow wins a tie. * and $ work as wildcards.
 */
export function robotsAllows(txt: string, path: string, agent = "ArrowsterrBot"): boolean {
  type Rule = { allow: boolean; pattern: string };
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
    } else lastWasAgent = false;
  }
  const me = agent.toLowerCase();
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && me.startsWith(a)));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  let best: Rule | null = null;
  for (const r of rules) {
    if (!robotsMatch(r.pattern, path)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

function robotsMatch(pattern: string, path: string) {
  const end = pattern.endsWith("$");
  const body = (end ? pattern.slice(0, -1) : pattern).split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  try {
    return new RegExp(`^${body}${end ? "$" : ""}`).test(path);
  } catch {
    return false;
  }
}

export type Vet = { ok: true } | { ok: false; reason: SkipReason; error: string };
export type VetDeps = {
  resolve(host: string): Promise<string[]>; // every address the name points to
  robots(origin: string): Promise<{ status: number; body: string } | null>; // null when it could not be reached
};

/** Whether the worker may open url: a public address (every one the name points to), and robots.txt allows it. */
export async function vetPage(url: string, deps: VetDeps, opts: { robots?: boolean } = {}): Promise<Vet> {
  const quick = pageUrlOk(url);
  if (!quick.ok) return quick;
  const u = new URL(url);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!isIP(host)) {
    let addresses: string[];
    try {
      addresses = await deps.resolve(host);
    } catch {
      return { ok: false, reason: "failed", error: "That domain doesn't exist." };
    }
    if (!addresses.length || addresses.some(privateIp)) return { ok: false, reason: "private", error: "That address points to a private network." };
  }
  if (opts.robots === false) return { ok: true };
  const r = await deps.robots(u.origin);
  // No robots.txt (4xx) means everything may be read. A server error or no answer means wait (RFC 9309).
  if (!r || r.status >= 500 || r.status === 429) return { ok: false, reason: "failed", error: "robots.txt could not be read." };
  if (r.status >= 400) return { ok: true };
  return robotsAllows(r.body, u.pathname + u.search) ? { ok: true } : { ok: false, reason: "robots", error: "robots.txt asks bots not to read this page." };
}

// ─────────────── what the worker sends back ───────────────
export type Read = { title: string | null; headings: { level: number; text: string }[]; body: string; word_count: number; tables: string[][][]; published_at: string | null };

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** The worker's extracted page, trimmed to sizes the database keeps. */
export function cleanRead(input: unknown): Read {
  const x = (input ?? {}) as Record<string, unknown>;
  const body = typeof x.body === "string" ? x.body.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, BODY_MAX) : "";
  const headings = (Array.isArray(x.headings) ? x.headings : [])
    .map((h) => ({ level: Math.min(6, Math.max(1, Number((h as { level?: unknown })?.level) || 2)), text: clip((h as { text?: unknown })?.text, 300) ?? "" }))
    .filter((h) => h.text)
    .slice(0, 200);
  const tables = (Array.isArray(x.tables) ? x.tables : [])
    .slice(0, 10)
    .map((t) => (Array.isArray(t) ? t : []).slice(0, 50).map((row) => (Array.isArray(row) ? row : []).slice(0, 12).map((c) => String(c ?? "").trim().slice(0, 300))))
    .filter((t) => t.length);
  const date = typeof x.published_at === "string" ? new Date(x.published_at) : null;
  const published_at = date && !Number.isNaN(date.getTime()) && date.getTime() > Date.UTC(1995, 0) && date.getTime() < Date.now() + 2 * 86400_000 ? date.toISOString() : null;
  // The page's own count can be off when text is hidden. Count what was kept, unless it was cut.
  const counted = Number(x.word_count);
  const word_count = body.length >= BODY_MAX && Number.isFinite(counted) && counted > 0 ? Math.round(counted) : words(body);
  return { title: clip(x.title, 300), headings, body, word_count, tables, published_at };
}

// ─────────────── waiting on the worker ───────────────
const RETRYABLE: SkipReason[] = ["failed", "timeout", "empty"];

/** Pages a dead worker held too long, past their last try. */
export const stale = (pages: PageRow[], now: number) => pages.filter((p) => p.status === "rendering" && p.locked_until && Date.parse(p.locked_until) < now && p.attempts >= MAX_PAGE_ATTEMPTS);

/** What to do with a run's pages now. */
export function settle(pages: PageRow[], opts: { rounds: number; readingSince: number; startedAt: number; now: number }):
  | { act: "done"; leftover: number[] }
  | { act: "wait"; seconds: number }
  | { act: "round"; requeue: number[] }
  | { act: "fail"; error: string } {
  const done = pages.filter((p) => p.status === "done").length;
  const open = pages.filter((p) => p.status === "queued" || p.status === "rendering");
  const leftover = pages.filter((p) => p.status === "queued").map((p) => p.id);
  if (done >= MIN_PAGES && (!open.length || opts.now - opts.readingSince > ENOUGH_AFTER_MS)) return { act: "done", leftover };
  const late = opts.now - opts.startedAt > DEADLINE_MS;
  if (open.length && !late) return { act: "wait", seconds: POLL_S };
  if (done >= MIN_PAGES) return { act: "done", leftover };
  const requeue = pages.filter((p) => p.status === "skipped" && p.skip_reason && RETRYABLE.includes(p.skip_reason) && p.attempts < MAX_PAGE_ATTEMPTS).map((p) => p.id);
  if (!late && opts.rounds < MAX_ROUNDS && requeue.length && done + requeue.length >= MIN_PAGES) return { act: "round", requeue };
  return { act: "fail", error: `Only ${done} of ${pages.length} pages could be read. An article needs ${MIN_PAGES}.` };
}

// ─────────────── the job ───────────────
/**
 * Run (or resume) a research run as far as it can go now. Steps whose output is saved are skipped.
 * "wait" means put the job back for that long: the pages are still being read, or a provider is busy.
 */
export async function research(store: Store, deps: Deps, runId: string): Promise<Outcome> {
  const now = deps.now ?? Date.now;
  let run = await store.run(runId);
  if (!run) return { state: "failed", error: "This research run was deleted." };
  if (run.status === "done") return { state: "done" };
  if (run.status === "failed") return { state: "failed", error: "This research run already failed." };
  const iso = () => new Date(now()).toISOString();

  // Step 1: search results, saved on the run in one write. After it, DataForSEO is never called again for this run.
  if (!run.serp_at) {
    if (!(await deps.rateOk("serp"))) return { state: "wait", seconds: 20, why: "rate limit" };
    await store.updateRun(run.id, { status: "searching", step: "serp" });
    const s = await deps.serp(run.keyword);
    const saved = { serp_at: iso(), organic: s.organic, paa: s.paa, ai_overview: s.aiOverview };
    await store.updateRun(run.id, { ...saved, step: "pages" });
    run = { ...run, ...saved };
  }
  // The top 10 as rows, built from what the run saved (again, if a crash came between the two writes).
  let serp = await store.serpRows(run.id);
  if (serp.length < run.organic.length) {
    await store.addSerpRows(run.organic.map((o) => ({ run_id: run!.id, ...o })));
    serp = await store.serpRows(run.id);
  }
  if (!serp.length) {
    const error = "Google showed no results for this keyword.";
    await store.updateRun(run.id, { status: "failed", error, finished_at: iso() });
    return { state: "failed", error };
  }

  // Step 2: every result queued for the worker. A page that may not be read is skipped right away.
  await store.addPages(serp.map((r) => queued(run!.id, r.url, "serp", r.position)));

  // Step 3: the AI engines, each saved as it answers, so a retry only asks the ones still missing.
  if (!run.ai_at) {
    const question = run.question || asQuestion(run.keyword);
    const engines = run.engines ?? pickEngines(deps.engines());
    if (!run.engines || !run.question) await store.updateRun(run.id, { engines, question, step: "ai", status: "searching" });
    const have = new Set((await store.answers(run.id)).map((a) => a.engine));
    // Google's AI Overview came free with step 1. Its links are AI sources too.
    if (run.ai_overview?.shown && !have.has("AI Overview")) {
      await store.addAnswer({ run_id: run.id, engine: "AI Overview", question: run.keyword, answer: run.ai_overview.text, cited: run.ai_overview.sources, error: null });
    }
    for (const engine of engines) {
      if (have.has(engine)) continue;
      if (!(await deps.rateOk(engine))) return { state: "wait", seconds: 15, why: "rate limit" };
      let row: AnswerRow;
      try {
        const a = await deps.ask(engine, question);
        row = { run_id: run.id, engine, question, answer: a.text, cited: cleanSources(a.sources), error: null };
      } catch (e) {
        // One engine down does not stop the article: its answer is saved as missing and the others go on.
        row = { run_id: run.id, engine, question, answer: null, cited: [], error: (e instanceof Error ? e.message : String(e)).slice(0, 500) };
      }
      await store.addAnswer(row);
    }
    const answers = await store.answers(run.id);
    const urls = citedToRead(answers, serp.map((r) => r.url));
    await store.addPages(urls.map((url) => queued(run!.id, url, "ai", null)));
    await store.updateRun(run.id, { ai_at: iso(), step: "reading", status: run.status === "waiting" ? "waiting" : "reading" });
    run = { ...run, ai_at: iso() };
  }

  // Reading: the worker leases pages from article_pages. Look at where they stand.
  const t = now();
  const pages = await store.pages(run.id);
  const dead = stale(pages, t);
  if (dead.length) {
    await store.updatePages(dead.map((p) => p.id), { status: "skipped", skip_reason: "timeout", error: "The worker stopped answering.", locked_until: null });
    for (const p of dead) Object.assign(p, { status: "skipped", skip_reason: "timeout" });
  }
  const next = settle(pages, { rounds: run.rounds, readingSince: Date.parse(run.ai_at!), startedAt: Date.parse(run.started_at), now: t });
  if (next.act === "wait") {
    if (run.status !== "reading" && run.status !== "waiting") await store.updateRun(run.id, { status: "reading", step: "reading" });
    return { state: "wait", seconds: next.seconds, why: "reading pages" };
  }
  if (next.act === "round") {
    await store.updatePages(next.requeue, { status: "queued", skip_reason: null, error: null, locked_until: null });
    await store.updateRun(run.id, { status: "waiting", rounds: run.rounds + 1, error: `Fewer than ${MIN_PAGES} pages could be read. Trying again.` });
    return { state: "wait", seconds: ROUND_WAIT_S * (run.rounds + 1), why: "waiting for more pages" };
  }
  if (next.act === "fail") {
    await store.updateRun(run.id, { status: "failed", error: next.error, finished_at: iso() });
    return { state: "failed", error: next.error };
  }
  if (next.leftover.length) await store.updatePages(next.leftover, { status: "skipped", skip_reason: "not_needed", error: null });
  await store.updateRun(run.id, { status: "done", step: "done", error: null, finished_at: iso() });
  return { state: "done" };
}

/** A page row to queue, skipped up front when its address may never be read. */
function queued(runId: string, url: string, source: "serp" | "ai", position: number | null): NewPage {
  const ok = pageUrlOk(url);
  return ok.ok ? { run_id: runId, url, source, position, status: "queued", skip_reason: null, error: null } : { run_id: runId, url, source, position, status: "skipped", skip_reason: ok.reason, error: ok.error };
}
