import "server-only";
import { cycleEnd, limitsFor, METRICS, nextPlan, PLANS, periodOf, type Extras, type Metric, type Plan, type PlanId } from "./plans";
import { onRefund } from "./meter";
import { adminClient } from "./serverAuth";

// What a workspace may use right now, and the allowance checks every paid route runs.
// Counting needs the server's secret key. Without it, or before 015_billing.sql, nothing is blocked.

export type Entitlement = { plan: PlanId; status: string; limits: Plan; readOnly: boolean; trialEndsAt: string | null; periodEnd: string | null; anchor: string | null };

const cache = new Map<string, { at: number; e: Entitlement }>();

export async function entitlement(workspaceId: string): Promise<Entitlement> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < 60_000) return hit.e;
  const db = adminClient();
  const legacy: Entitlement = { plan: "legacy", status: "active", limits: PLANS.legacy, readOnly: false, trialEndsAt: null, periodEnd: null, anchor: null };
  if (!db) return legacy;
  const { data, error } = await db.from("workspaces").select("*").eq("id", workspaceId).maybeSingle();
  if (error || !data?.plan) return legacy; // before 015_billing.sql
  const w = data as { plan: PlanId; plan_status: string; trial_ends_at: string | null; period_end: string | null; extras: Extras; billing_anchor?: string | null };
  const trialOver = w.plan === "trial" && w.trial_ends_at !== null && Date.parse(w.trial_ends_at) < Date.now();
  const e: Entitlement = {
    plan: w.plan,
    status: trialOver ? "read_only" : w.plan_status,
    limits: limitsFor(w.plan, w.extras ?? {}),
    readOnly: trialOver || w.plan_status === "read_only" || w.plan_status === "canceled",
    trialEndsAt: w.trial_ends_at,
    periodEnd: w.period_end,
    anchor: w.billing_anchor ?? null, // before 017_stripe.sql, months follow the calendar
  };
  cache.set(workspaceId, { at: Date.now(), e });
  return e;
}

/** Forget a workspace's cached plan, after a change. */
export const forgetEntitlement = (workspaceId: string) => cache.delete(workspaceId);

const resetText = (m: Metric, anchor: string | null) => {
  if (METRICS[m].period === "day") return "They reset tomorrow";
  const d = new Date();
  const next = anchor ? cycleEnd(new Date(anchor), d) : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return `They reset on ${next.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
};

/** A friendly "limit reached" answer, with the plan to boost to. */
function limitReached(e: Entitlement, m: Metric, limit: number) {
  const up = nextPlan(e.plan);
  const label = METRICS[m].label;
  const error = `You've used ${METRICS[m].period === "day" ? "today's" : "this month's"} ${limit} ${label} on ${e.limits.name}. ${resetText(m, e.anchor)}${up ? `, or boost to ${PLANS[up].name} now` : ""}.`;
  return Response.json({ error, limit: true, metric: m, boost: up }, { status: 429 });
}

function readOnly(e: Entitlement) {
  const error = e.plan === "trial" ? "Your free trial has ended. Pick a plan to keep going. Your data is safe." : "This workspace is read-only until billing is sorted out. Your data is safe.";
  return Response.json({ error, readOnly: true }, { status: 402 });
}

/** Stop changes when the trial ended or billing failed. Returns a Response to send back, or null to go on. */
export async function requireActive(workspaceId: string): Promise<Response | null> {
  const e = await entitlement(workspaceId);
  return e.readOnly ? readOnly(e) : null;
}

export type Taken = { ok: true; giveBack: () => Promise<void>; used: number; limit: number; period: string } | { ok: false; response: Response };

/**
 * Use n of a counted allowance. In a metered route it is handed back on its own when the route fails
 * or spends nothing. Elsewhere, call giveBack().
 * Fails open (allows) when counting is not set up, so a missing migration never blocks customers.
 */
export async function take(workspaceId: string, metric: Metric, n = 1, opts: { refundIfFree?: boolean } = {}): Promise<Taken> {
  const e = await entitlement(workspaceId);
  if (e.readOnly) return { ok: false, response: readOnly(e) };
  const limit = METRICS[metric].limit(e.limits);
  const period = periodOf(metric, new Date(), e.anchor);
  const db = adminClient();
  const noop = { ok: true as const, giveBack: async () => {}, used: 0, limit, period };
  if (!db) return noop;
  const { data, error } = await db.rpc("take_allowance", { p_ws: workspaceId, p_metric: metric, p_period: period, p_limit: limit, p_n: n });
  if (error) {
    if (!/take_allowance|usage_counters/.test(error.message)) console.error("Allowance check failed:", error.message);
    return noop;
  }
  if (data === -1) return { ok: false, response: limitReached(e, metric, limit) };
  const giveBack = async () => {
    await db.rpc("give_back", { p_ws: workspaceId, p_metric: metric, p_period: period, p_n: n });
  };
  // Inside a metered route, a failed or free (saved) result hands the allowance back on its own.
  onRefund(giveBack, opts.refundIfFree ?? true);
  return { ok: true, used: Number(data), limit, giveBack, period };
}

/** What a workspace used this period, for the Billing page. */
export async function usageOf(workspaceId: string) {
  const e = await entitlement(workspaceId);
  const db = adminClient();
  const periods = (Object.keys(METRICS) as Metric[]).map((m) => ({ m, p: periodOf(m, new Date(), e.anchor) }));
  const { data } = db ? await db.from("usage_counters").select("metric, period, used").eq("workspace_id", workspaceId).in("period", [...new Set(periods.map((x) => x.p))]) : { data: [] };
  const rows = (data ?? []) as { metric: Metric; period: string; used: number }[];
  return {
    plan: e.plan,
    name: e.limits.name,
    status: e.status,
    readOnly: e.readOnly,
    trialEndsAt: e.trialEndsAt,
    periodEnd: e.periodEnd,
    limits: e.limits,
    boost: nextPlan(e.plan),
    allowances: periods.map(({ m, p }) => ({ metric: m, label: METRICS[m].label, period: METRICS[m].period, used: rows.find((r) => r.metric === m && r.period === p)?.used ?? 0, limit: METRICS[m].limit(e.limits) })),
  };
}
