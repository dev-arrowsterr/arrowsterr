// How the queue and the AI calls react to a failure. Kept free of server code so it can be tested.

/** Tries a queued job gets. With the waits below, a job keeps trying for about 7 hours before it is marked dead. */
export const MAX_ATTEMPTS = 8;
// Seconds to wait after try 1, 2, 3...: 1 min, 5 min, 15 min, 30 min, 1 h, 2 h, 3 h.
const WAITS = [60, 300, 900, 1800, 3600, 7200, 10800];

/** How long to wait before the next try, after `attempts` tries so far. */
export const backoffSeconds = (attempts: number) => WAITS[Math.max(0, Math.min(WAITS.length - 1, attempts - 1))]!;

/**
 * spend_cap: the account ran out of money or hit its monthly cap. Retrying won't help until someone pays.
 * auth: the key is wrong or was revoked. Retrying won't help until someone fixes the key.
 * rate_limit, server, network: worth trying again soon.
 * bad_request: the request itself is wrong; trying the same thing again gives the same answer.
 */
export type Failure = "spend_cap" | "auth" | "rate_limit" | "server" | "network" | "bad_request" | "unknown";

const SPEND = /enforced_spend_limit_reached|reached your (specified )?(workspace )?API usage limits|insufficient_quota|exceeded your current quota|credit balance is too low|insufficient (credits|balance|funds)|payment required/i;
const NETWORK = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|network|timed? ?out|aborted/i;

/** What kind of failure an error from an SDK, fetch or our own code is, and how long the provider asked us to wait. */
export function failureOf(e: unknown): { kind: Failure; retryAfter: number | null } {
  const err = (e ?? {}) as { status?: unknown; code?: unknown; message?: unknown; error?: { error?: { details?: { error_code?: unknown } }; code?: unknown }; headers?: unknown };
  const status = typeof err.status === "number" ? err.status : statusIn(String(err.message ?? ""));
  const text = [err.message, err.code, err.error?.code, err.error?.error?.details?.error_code].filter((x) => typeof x === "string").join(" ");
  const retryAfter = retryAfterOf(err.headers);
  if (SPEND.test(text) || status === 402) return { kind: "spend_cap", retryAfter: null };
  if (status === 401 || status === 403) return { kind: "auth", retryAfter: null };
  if (status === 429) return { kind: "rate_limit", retryAfter };
  if (status && status >= 500) return { kind: "server", retryAfter };
  if (status === 400 || status === 404 || status === 413 || status === 422) return { kind: "bad_request", retryAfter: null };
  if (NETWORK.test(text) || (e instanceof Error && e.name === "AbortError")) return { kind: "network", retryAfter: null };
  return { kind: "unknown", retryAfter: null };
}

/** True when trying again in a few seconds might work. */
export const retryable = (f: Failure) => f === "rate_limit" || f === "server" || f === "network" || f === "unknown";
/** True when the job should wait without using up its tries, because a person has to fix something first. */
export const needsPerson = (f: Failure) => f === "spend_cap" || f === "auth";

/** A status code written in an error message: "429 Too many requests", "DataForSEO returned 503", "status 502". */
function statusIn(message: string) {
  const m = message.match(/^(4\d\d|5\d\d)\b/) ?? message.match(/\b(?:status|returned|HTTP|code)\s*:?\s*(4\d\d|5\d\d)\b/i);
  return m ? Number(m[1]) : null;
}

function retryAfterOf(headers: unknown): number | null {
  const get = (k: string) =>
    headers && typeof (headers as { get?: unknown }).get === "function" ? (headers as Headers).get(k) : headers && typeof headers === "object" ? ((headers as Record<string, unknown>)[k] as string | undefined) : undefined;
  const v = Number(get("retry-after"));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** The message saved on a job that waits for a person. The hourly check looks for this prefix. */
export const PAUSED = "Paused:";

export type JobRow = { kind: string; last_error: string | null; workspace_id: string | null };

/** One line per kind of job, with how many and the latest error. */
export function summarize(rows: JobRow[]) {
  const by = new Map<string, { n: number; error: string; workspaces: Set<string> }>();
  for (const r of rows) {
    const g = by.get(r.kind) ?? { n: 0, error: "", workspaces: new Set<string>() };
    g.n++;
    g.error ||= (r.last_error ?? "").slice(0, 300);
    if (r.workspace_id) g.workspaces.add(r.workspace_id);
    by.set(r.kind, g);
  }
  return [...by].sort((a, b) => b[1].n - a[1].n).map(([kind, g]) => `${g.n} ${kind} ${g.n === 1 ? "job" : "jobs"}${g.workspaces.size ? ` in ${g.workspaces.size} ${g.workspaces.size === 1 ? "workspace" : "workspaces"}` : ""}: ${g.error || "no error saved"}`);
}
