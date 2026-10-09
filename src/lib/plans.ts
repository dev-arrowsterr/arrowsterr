// Every plan's price, limits and features, in one place. Billing, allowance checks, the daily job
// and the pricing page all read from here, so changing a plan is a change to this file only.
// Shared by the server and the browser.

export type PlanId = "trial" | "foundation" | "scale" | "thrive" | "agency" | "enterprise" | "legacy";
export type Reports = "basic" | "templates" | "share" | "whitelabel";

export type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  price: number; // US dollars a month, billed monthly
  annual: number; // US dollars a month, billed yearly
  prompts: number; // shared by every brand in the workspace
  brands: number;
  seats: number;
  competitors: number; // per brand
  historyDays: number;
  checkEvery: number; // every AI is checked every N days: 7 is weekly, 1 is daily
  checkNowPerDay: number; // prompts a day that can be re-checked on demand
  briefsPerMonth: number;
  plansPerMonth: number;
  planMaxKeywords: 30 | 60 | 120;
  researchPerDay: number; // keyword and domain lookups
  aiPerMonth: number; // fair use ceiling for writer messages, ideas, AI summaries, new brands and the report agent
  pageviewsPerMonth: number; // visits recorded by the tracking script, across all brands
  writer: "none" | "full";
  reports: Reports;
  alerts: boolean; // Slack, Zapier and the API
  sso: boolean;
};

export const UNLIMITED = 1000;
const base = { sso: false } as const;

export const PLANS: Record<PlanId, Plan> = {
  foundation: { ...base, id: "foundation", name: "Foundation", tagline: "See how AI talks about your brand", price: 29, annual: 25, prompts: 50, brands: UNLIMITED, seats: 1, competitors: 5, historyDays: 90, checkEvery: 7, checkNowPerDay: 2, briefsPerMonth: 0, plansPerMonth: 0, planMaxKeywords: 30, researchPerDay: 0, aiPerMonth: 150, pageviewsPerMonth: 25_000, writer: "none", reports: "basic", alerts: false },
  scale: { ...base, id: "scale", name: "Scale", tagline: "Turn AI gaps into content that ranks", price: 49, annual: 42, prompts: 100, brands: UNLIMITED, seats: 3, competitors: 10, historyDays: 180, checkEvery: 7, checkNowPerDay: 5, briefsPerMonth: 5, plansPerMonth: 1, planMaxKeywords: 60, researchPerDay: 50, aiPerMonth: 1000, pageviewsPerMonth: 100_000, writer: "full", reports: "templates", alerts: false },
  thrive: { ...base, id: "thrive", name: "Thrive", tagline: "Daily tracking for growing teams", price: 149, annual: 127, prompts: 100, brands: UNLIMITED, seats: 5, competitors: 15, historyDays: 365, checkEvery: 1, checkNowPerDay: 25, briefsPerMonth: 20, plansPerMonth: 3, planMaxKeywords: 120, researchPerDay: 200, aiPerMonth: 3000, pageviewsPerMonth: 500_000, writer: "full", reports: "share", alerts: true },
  agency: { ...base, id: "agency", name: "Agency", tagline: "Every client, your brand on the report", price: 399, annual: 339, prompts: 250, brands: UNLIMITED, seats: 15, competitors: 25, historyDays: 730, checkEvery: 1, checkNowPerDay: 100, briefsPerMonth: 60, plansPerMonth: 10, planMaxKeywords: 120, researchPerDay: 500, aiPerMonth: 10000, pageviewsPerMonth: 2_000_000, writer: "full", reports: "whitelabel", alerts: true },
  enterprise: { id: "enterprise", name: "Enterprise", tagline: "Custom volume, security and support", price: 1500, annual: 1500, prompts: 1000, brands: UNLIMITED, seats: UNLIMITED, competitors: 50, historyDays: 1095, checkEvery: 1, checkNowPerDay: 500, briefsPerMonth: 200, plansPerMonth: 30, planMaxKeywords: 120, researchPerDay: 2000, aiPerMonth: 30000, pageviewsPerMonth: 10_000_000, writer: "full", reports: "whitelabel", alerts: true, sso: true },
  // 14 days of Scale with fewer prompts, checked every 3 days. No card. Then read-only until a plan is picked.
  trial: { ...base, id: "trial", name: "Trial", tagline: "", price: 0, annual: 0, prompts: 50, brands: UNLIMITED, seats: 3, competitors: 10, historyDays: 180, checkEvery: 3, checkNowPerDay: 5, briefsPerMonth: 3, plansPerMonth: 1, planMaxKeywords: 60, researchPerDay: 30, aiPerMonth: 300, pageviewsPerMonth: 25_000, writer: "full", reports: "templates", alerts: false },
  // Workspaces made before billing existed keep what they had until they pick a plan.
  legacy: { ...base, id: "legacy", name: "Early access", tagline: "", price: 0, annual: 0, prompts: 50, brands: UNLIMITED, seats: 15, competitors: 25, historyDays: 365, checkEvery: 1, checkNowPerDay: 50, briefsPerMonth: 100, plansPerMonth: 10, planMaxKeywords: 120, researchPerDay: 200, aiPerMonth: 5000, pageviewsPerMonth: 500_000, writer: "full", reports: "whitelabel", alerts: true },
};

/** The plans sold on the pricing page, in order. */
export const LADDER: PlanId[] = ["foundation", "scale", "thrive", "agency", "enterprise"];

/** Paid extras on top of a plan. Stored on the workspace as counts. */
export type Extras = { prompts?: number; brands?: number; seats?: number; daily?: boolean };

/** What a workspace can use: its plan plus any extras. */
export function limitsFor(plan: PlanId, extras: Extras = {}): Plan {
  const p = PLANS[plan] ?? PLANS.trial;
  return {
    ...p,
    prompts: p.prompts + (extras.prompts ?? 0),
    brands: p.brands + (extras.brands ?? 0),
    seats: p.seats + (extras.seats ?? 0),
    checkEvery: extras.daily ? 1 : p.checkEvery,
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

/** True when a brand's daily check is due today. Weekly plans spread their brands over the week. */
export function checkDue(brandSeed: number, every: number, day = Math.floor(Date.now() / 864e5)) {
  return every <= 1 || (day + brandSeed) % every === 0;
}

/** The first plan that includes a counted allowance, for "starts on Scale". */
export const firstWith = (m: Metric) => LADDER.find((id) => METRICS[m].limit(PLANS[id]) > 0) ?? null;

/** The next plan up, for the Boost button. */
export function nextPlan(plan: PlanId): PlanId | null {
  const i = LADDER.indexOf(plan === "trial" ? "scale" : plan === "legacy" ? "thrive" : plan);
  return i >= 0 && i < LADDER.length - 2 ? LADDER[i + 1] : null; // Enterprise is sold by talking to us
}

/** The counted allowances, by name. */
export type Metric = "briefs" | "plans" | "research" | "checknow" | "ai" | "pageviews";
export const METRICS: Record<Metric, { label: string; period: "month" | "day"; limit: (l: Plan) => number }> = {
  briefs: { label: "content briefs", period: "month", limit: (l) => l.briefsPerMonth },
  plans: { label: "content plans", period: "month", limit: (l) => l.plansPerMonth },
  research: { label: "research lookups", period: "day", limit: (l) => l.researchPerDay },
  checknow: { label: "on-demand checks", period: "day", limit: (l) => l.checkNowPerDay },
  ai: { label: "AI requests", period: "month", limit: (l) => l.aiPerMonth },
  pageviews: { label: "tracked visits", period: "month", limit: (l) => l.pageviewsPerMonth },
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
