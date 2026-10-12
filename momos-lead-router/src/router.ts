import { NOT_A_FIT_URL, ROUTES, type AE, type Region } from "./config.ts";
import { decide, type Decision } from "./claude.ts";
import type { Lead } from "./lead.ts";
import { notify } from "./notify.ts";
import { regionFromLocation } from "./regions.ts";
import { runChecks, type Checks } from "./verify.ts";

export type Routed = {
  outcome: "routed" | "not_fit" | "rejected";
  ae?: AE;
  redirectUrl: string;
  region: Region;
  decision?: Decision;
  checks: Checks;
  claudeError?: string;
  ms: number;
};

type Deps = {
  decide: typeof decide;
  runChecks: typeof runChecks;
  notify: typeof notify;
};
const realDeps: Deps = { decide, runChecks, notify };

export async function routeLead(lead: Lead, deps: Deps = realDeps): Promise<Routed> {
  const started = Date.now();
  const checks = await deps.runChecks(lead);

  // Junk we can reject without asking Claude.
  if (!checks.emailValid || checks.disposableEmail || checks.domainAcceptsMail === false) {
    return { outcome: "rejected", redirectUrl: NOT_A_FIT_URL, region: "unknown", checks, ms: Date.now() - started };
  }

  let decision: Decision | undefined;
  let claudeError: string | undefined;
  try {
    decision = await deps.decide(lead, checks);
  } catch (err) {
    // Never lose a lead because Claude was slow or down. Route on form fields and flag it.
    claudeError = err instanceof Error ? err.message : String(err);
  }

  // The form's own country/state wins. Claude fills the gap when the form doesn't say.
  const formRegion = regionFromLocation(lead.country, lead.state);
  const region: Region = formRegion !== "unknown" ? formRegion : (decision?.region ?? "unknown");

  let result: Routed;
  if (decision && (!decision.legit || decision.icpFit === "not_fit")) {
    result = {
      outcome: decision.legit ? "not_fit" : "rejected",
      redirectUrl: NOT_A_FIT_URL,
      region,
      decision,
      checks,
      ms: Date.now() - started,
    };
  } else {
    const ae = ROUTES[region];
    result = { outcome: "routed", ae, redirectUrl: ae.bookingUrl, region, decision, checks, claudeError, ms: Date.now() - started };
  }

  // Alert in the background so the visitor isn't kept waiting.
  deps.notify(lead, result).catch((err) => console.error("notify failed", err));
  return result;
}

// Framer's webhook and the in-page call can both fire for one submission.
// Share one decision between them so Claude runs once and Slack pings once.
const cache = new Map<string, { at: number; promise: Promise<Routed> }>();
const TTL_MS = 10 * 60 * 1000;

export function routeLeadOnce(lead: Lead): Promise<Routed> {
  const k = `${(lead.email ?? "").toLowerCase()}|${(lead.company ?? "").toLowerCase()}`;
  const now = Date.now();
  for (const [key, v] of cache) if (now - v.at > TTL_MS) cache.delete(key);
  const hit = cache.get(k);
  if (hit) return hit.promise;
  const promise = routeLead(lead);
  cache.set(k, { at: now, promise });
  promise.catch(() => cache.delete(k));
  return promise;
}
