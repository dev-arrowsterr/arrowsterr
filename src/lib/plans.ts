// Every plan's price, limits and features, in one place. Billing, allowance checks, the daily job
// and the pricing page all read from here, so changing a plan is a change to this file only.
// Shared by the server and the browser.

export type PlanId = "trial" | "foundation" | "scale" | "thrive" | "agency" | "enterprise" | "legacy";
export type Reports = "basic" | "templates" | "share" | "whitelabel";

export type Plan = {
  id: PlanId;
  name: string;
  price: number; // US dollars a month, billed monthly
  annual: number; // US dollars a month, billed yearly
  prompts: number;
  brands: number;
  seats: number;
  competitors: number; // per brand
  historyDays: number;
  claudeEvery: number; // Claude is checked every N days. The other AIs are checked daily.
  checkNowPerDay: number; // prompts a day that can be re-checked on demand
  briefsPerMonth: number;
  plansPerMonth: number;
  planMaxKeywords: 30 | 60 | 120;
  researchPerDay: number; // keyword and domain lookups
  aiPerMonth: number; // fair use ceiling for writer messages, ideas, AI summaries and the report agent
  writer: "briefs" | "full";
  reports: Reports;
  alerts: boolean; // Slack, Zapier and the API
  sso: boolean;
};

const base = { sso: false } as const;

export const PLANS: Record<PlanId, Plan> = {
  foundation: { ...base, id: "foundation", name: "Foundation", price: 29, annual: 25, prompts: 12, brands: 1, seats: 1, competitors: 10, historyDays: 90, claudeEvery: 7, checkNowPerDay: 1, briefsPerMonth: 3, plansPerMonth: 1, planMaxKeywords: 30, researchPerDay: 5, aiPerMonth: 300, writer: "briefs", reports: "basic", alerts: false },
  scale: { ...base, id: "scale", name: "Scale", price: 49, annual: 42, prompts: 20, brands: 1, seats: 3, competitors: 25, historyDays: 180, claudeEvery: 7, checkNowPerDay: 5, briefsPerMonth: 15, plansPerMonth: 2, planMaxKeywords: 60, researchPerDay: 20, aiPerMonth: 1000, writer: "full", reports: "templates", alerts: false },
  thrive: { ...base, id: "thrive", name: "Thrive", price: 149, annual: 127, prompts: 40, brands: 3, seats: 5, competitors: 50, historyDays: 365, claudeEvery: 1, checkNowPerDay: 25, briefsPerMonth: 50, plansPerMonth: 8, planMaxKeywords: 120, researchPerDay: 50, aiPerMonth: 3000, writer: "full", reports: "share", alerts: true },
  agency: { ...base, id: "agency", name: "Agency", price: 399, annual: 339, prompts: 100, brands: 15, seats: 15, competitors: 50, historyDays: 730, claudeEvery: 1, checkNowPerDay: 100, briefsPerMonth: 150, plansPerMonth: 20, planMaxKeywords: 120, researchPerDay: 200, aiPerMonth: 10000, writer: "full", reports: "whitelabel", alerts: true },
  enterprise: { id: "enterprise", name: "Enterprise", price: 1500, annual: 1500, prompts: 500, brands: 1000, seats: 1000, competitors: 200, historyDays: 1095, claudeEvery: 1, checkNowPerDay: 500, briefsPerMonth: 500, plansPerMonth: 60, planMaxKeywords: 120, researchPerDay: 1000, aiPerMonth: 30000, writer: "full", reports: "whitelabel", alerts: true, sso: true },
  // 14 days of Scale, no card. Then read-only until a plan is picked.
  trial: { ...base, id: "trial", name: "Trial", price: 0, annual: 0, prompts: 20, brands: 1, seats: 3, competitors: 25, historyDays: 180, claudeEvery: 7, checkNowPerDay: 5, briefsPerMonth: 5, plansPerMonth: 1, planMaxKeywords: 60, researchPerDay: 20, aiPerMonth: 300, writer: "full", reports: "templates", alerts: false },
  // Workspaces made before billing existed keep what they had until they pick a plan.
  legacy: { ...base, id: "legacy", name: "Early access", price: 0, annual: 0, prompts: 50, brands: 3, seats: 15, competitors: 50, historyDays: 365, claudeEvery: 1, checkNowPerDay: 50, briefsPerMonth: 100, plansPerMonth: 10, planMaxKeywords: 120, researchPerDay: 200, aiPerMonth: 5000, writer: "full", reports: "whitelabel", alerts: true },
};

/** The plans sold on the pricing page, in order. */
export const LADDER: PlanId[] = ["foundation", "scale", "thrive", "agency", "enterprise"];

/** Paid extras on top of a plan. Stored on the workspace as counts. */
export type Extras = { prompts?: number; brands?: number; seats?: number; dailyClaude?: boolean };

/** What a workspace can use: its plan plus any extras. */
export function limitsFor(plan: PlanId, extras: Extras = {}): Plan {
  const p = PLANS[plan] ?? PLANS.trial;
  return {
    ...p,
    prompts: p.prompts + (extras.prompts ?? 0),
    brands: p.brands + (extras.brands ?? 0),
    seats: p.seats + (extras.seats ?? 0),
    claudeEvery: extras.dailyClaude ? 1 : p.claudeEvery,
  };
}

/** AI answers a day the workspace may use: every prompt on every AI, plus on-demand checks. */
export const dailyAnswers = (l: Plan, engines = 6) => (l.prompts + l.checkNowPerDay) * engines;

/**
 * How many of each brand's prompts the plan checks, in the order the brands were added.
 * After a downgrade, brands and prompts past the plan's limits are paused, never deleted.
 */
export function promptAllowance(brands: { id: string; prompts: string[] | null }[], limits: Pick<Plan, "brands" | "prompts">) {
  const out = new Map<string, number>();
  let left = limits.prompts;
  brands.forEach((b, i) => {
    const n = i < limits.brands ? Math.max(0, Math.min(b.prompts?.length ?? 0, left)) : 0;
    out.set(b.id, n);
    left -= n;
  });
  return out;
}

/** The next plan up, for the Boost button. */
export function nextPlan(plan: PlanId): PlanId | null {
  const i = LADDER.indexOf(plan === "trial" ? "scale" : plan === "legacy" ? "thrive" : plan);
  return i >= 0 && i < LADDER.length - 2 ? LADDER[i + 1] : null; // Enterprise is sold by talking to us
}

/** The counted allowances, by name. */
export type Metric = "briefs" | "plans" | "research" | "checknow" | "ai";
export const METRICS: Record<Metric, { label: string; period: "month" | "day"; limit: (l: Plan) => number }> = {
  briefs: { label: "content briefs", period: "month", limit: (l) => l.briefsPerMonth },
  plans: { label: "content plans", period: "month", limit: (l) => l.plansPerMonth },
  research: { label: "research lookups", period: "day", limit: (l) => l.researchPerDay },
  checknow: { label: "on-demand checks", period: "day", limit: (l) => l.checkNowPerDay },
  ai: { label: "AI requests", period: "month", limit: (l) => l.aiPerMonth },
};

/**
 * The start of the billing month that holds `at`, for a plan that started on `anchor`.
 * A plan bought on the 31st resets on the last day of shorter months.
 */
export function cycleStart(anchor: Date, at = new Date()) {
  const day = anchor.getUTCDate();
  const on = (y: number, m: number) => new Date(Date.UTC(y, m, Math.min(day, new Date(Date.UTC(y, m + 1, 0)).getUTCDate())));
  let start = on(at.getUTCFullYear(), at.getUTCMonth());
  if (start > at) start = on(at.getUTCFullYear(), at.getUTCMonth() - 1);
  return start;
}

/** The next reset of a billing month. */
export function cycleEnd(anchor: Date, at = new Date()) {
  const s = cycleStart(anchor, at);
  const day = anchor.getUTCDate();
  const y = s.getUTCFullYear();
  const m = s.getUTCMonth() + 1;
  return new Date(Date.UTC(y, m, Math.min(day, new Date(Date.UTC(y, m + 1, 0)).getUTCDate())));
}

/**
 * The counting window for a metric, in UTC. Daily ones: "2026-10-09".
 * Monthly ones follow the billing date when there is one ("2026-10-14"), else the calendar month ("2026-10").
 */
export function periodOf(m: Metric, at = new Date(), anchor?: string | null) {
  if (METRICS[m].period === "day") return at.toISOString().slice(0, 10);
  return anchor ? cycleStart(new Date(anchor), at).toISOString().slice(0, 10) : at.toISOString().slice(0, 7);
}

/** Plans sold by card, and the Stripe price lookup key for each. */
export const SELF_SERVE: PlanId[] = ["foundation", "scale", "thrive", "agency"];
export type Interval = "month" | "year";
export const lookupKey = (plan: PlanId, interval: Interval) => `arrowsterr_${plan}_${interval}`;
export function planOfLookup(key: string | null | undefined): { plan: PlanId; interval: Interval } | null {
  const m = /^arrowsterr_([a-z]+)_(month|year)$/.exec(key ?? "");
  return m && SELF_SERVE.includes(m[1] as PlanId) ? { plan: m[1] as PlanId, interval: m[2] as Interval } : null;
}
