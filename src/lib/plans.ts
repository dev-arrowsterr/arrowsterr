// Every plan's price, limits and features, in one place. Billing, allowance checks, the daily job
// and the pricing page all read from here, so changing a plan is a change to this file only.
// Shared by the server and the browser.

export type PlanId = "free" | "trial" | "foundation" | "scale" | "thrive" | "agency" | "enterprise" | "legacy";
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
  researchPerMonth: number; // Keyword & Website Research: keyword and website lookups
  tasksPerMonth: number; // every action someone clicks costs tasks; tracking never does
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
  // Not sold. Kept so older rows still read.
  free: { ...base, id: "free", name: "Free", tagline: "", price: 0, annual: 0, prompts: 0, brands: 1, seats: 1, competitors: 0, historyDays: 30, checkEvery: 7, checkNowPerDay: 0, briefsPerMonth: 0, plansPerMonth: 0, planMaxKeywords: 30, researchPerMonth: 0, tasksPerMonth: 0, aiPerMonth: 0, pageviewsPerMonth: 0, writer: "none", reports: "basic", alerts: false },
  // Starter opens one toolset, picked by the customer: AI Visibility or SEO. See TRACKS.
  foundation: { ...base, id: "foundation", name: "Starter", tagline: "One toolset: AI Visibility or SEO", price: 29, annual: 24, prompts: 50, brands: UNLIMITED, seats: 2, competitors: 10, historyDays: 180, checkEvery: 1, checkNowPerDay: 3, briefsPerMonth: 0, plansPerMonth: 1, planMaxKeywords: 120, researchPerMonth: 0, tasksPerMonth: 3_000, aiPerMonth: 0, pageviewsPerMonth: 25_000, writer: "full", reports: "templates", alerts: false },
  scale: { ...base, id: "scale", name: "Pro", tagline: "AI Visibility and SEO together", price: 99, annual: 84, prompts: 100, brands: UNLIMITED, seats: 5, competitors: 15, historyDays: 365, checkEvery: 1, checkNowPerDay: 10, briefsPerMonth: 0, plansPerMonth: 1, planMaxKeywords: 120, researchPerMonth: 0, tasksPerMonth: 8_000, aiPerMonth: 0, pageviewsPerMonth: 250_000, writer: "full", reports: "templates", alerts: true },
  agency: { ...base, id: "agency", name: "Agency", tagline: "Every client, your brand on the report", price: 299, annual: 254, prompts: 300, brands: UNLIMITED, seats: 15, competitors: 25, historyDays: 730, checkEvery: 1, checkNowPerDay: 30, briefsPerMonth: 0, plansPerMonth: 1, planMaxKeywords: 120, researchPerMonth: 0, tasksPerMonth: 25_000, aiPerMonth: 0, pageviewsPerMonth: 2_000_000, writer: "full", reports: "whitelabel", alerts: true },
  enterprise: { id: "enterprise", name: "Enterprise", tagline: "Custom volume, security and support", price: 1500, annual: 1500, prompts: 1000, brands: UNLIMITED, seats: UNLIMITED, competitors: 50, historyDays: 1095, checkEvery: 1, checkNowPerDay: 500, briefsPerMonth: 0, plansPerMonth: 1, planMaxKeywords: 120, researchPerMonth: 0, tasksPerMonth: 150_000, aiPerMonth: 0, pageviewsPerMonth: 10_000_000, writer: "full", reports: "whitelabel", alerts: true, sso: true },
  // No longer sold. Workspaces that bought it keep it.
  thrive: { ...base, id: "thrive", name: "Thrive", tagline: "", price: 149, annual: 127, prompts: 50, brands: UNLIMITED, seats: 5, competitors: 15, historyDays: 365, checkEvery: 1, checkNowPerDay: 10, briefsPerMonth: 0, plansPerMonth: 1, planMaxKeywords: 120, researchPerMonth: 0, tasksPerMonth: 20_000, aiPerMonth: 0, pageviewsPerMonth: 500_000, writer: "full", reports: "templates", alerts: true },
  // 14 days of both toolsets with fewer prompts. No card. Then read-only until a plan is picked.
  trial: { ...base, id: "trial", name: "Trial", tagline: "", price: 0, annual: 0, prompts: 25, brands: UNLIMITED, seats: 3, competitors: 10, historyDays: 180, checkEvery: 1, checkNowPerDay: 5, briefsPerMonth: 0, plansPerMonth: 1, planMaxKeywords: 120, researchPerMonth: 0, tasksPerMonth: 1_000, aiPerMonth: 0, pageviewsPerMonth: 25_000, writer: "full", reports: "templates", alerts: false },
  // Workspaces made before billing existed keep what they had until they pick a plan.
  legacy: { ...base, id: "legacy", name: "Early access", tagline: "", price: 0, annual: 0, prompts: 50, brands: UNLIMITED, seats: 15, competitors: 25, historyDays: 365, checkEvery: 1, checkNowPerDay: 50, briefsPerMonth: 0, plansPerMonth: 1, planMaxKeywords: 120, researchPerMonth: 0, tasksPerMonth: 30_000, aiPerMonth: 0, pageviewsPerMonth: 500_000, writer: "full", reports: "whitelabel", alerts: true },
};

/** What each action costs in tasks. About half a cent of our cost per task. Tracking prompts is never counted. */
export const TASK_COST = {
  keyword: 10, // one keyword overview, or one list of ideas
  bulk: (n: number) => Math.max(5, Math.ceil(n / 10)), // enriching many keywords at once
  domain: 10, // a website's keywords, pages and competitors
  gap: 25, // a competitive analysis
  pages: 40, // every page of your site on Google
  brief: 100, // a full content brief
  agent: 15, // a writer agent job: a section, a table or links
  stats: 30, // a writer agent job that searches the web for stats
  widget: 25, // an interactive element
  ai: 3, // a small AI job: ideas, a summary, prompt suggestions
  guideline: 10, // reading a site for its brand guideline
} as const;

/** The two toolsets. Starter opens one of them; Pro and up open both. */
export type Track = "visibility" | "seo";
export const TRACKS: Record<Track, { label: string; short: string; text: string }> = {
  visibility: { label: "AI Visibility", short: "AI Visibility", text: "50 prompts checked daily across AI, competitors, sources and reports" },
  seo: { label: "SEO toolset", short: "SEO", text: "Keyword, domain and competitive research, Topic Bank, briefs and the Agentic Writer" },
};
/** Starter's limits for each toolset: the AI Visibility side tracks prompts, the SEO side gets the tasks. */
const STARTER: Record<Track, Partial<Plan>> = {
  visibility: { prompts: 50, tasksPerMonth: 300, writer: "none" },
  seo: { prompts: 0, checkNowPerDay: 0, tasksPerMonth: 3_000 },
};
/** Which toolsets a plan opens. A Starter without a pick yet opens AI Visibility. */
export function access(plan: PlanId, track?: Track | null): Record<Track, boolean> {
  if (plan === "foundation") return { visibility: track !== "seo", seo: track === "seo" };
  return { visibility: true, seo: true };
}

/** Task packs to buy when a month's tasks run out. They never expire. */
export const TASK_PACKS = [
  { id: "t1k", tasks: 1_000, price: 15 },
  { id: "t5k", tasks: 5_000, price: 59 },
  { id: "t20k", tasks: 20_000, price: 199 },
] as const;
export type PackId = (typeof TASK_PACKS)[number]["id"];

/** The plan that really applies: a trial that ended, or a canceled plan, turns read-only. */
export function effectivePlan(plan: PlanId, status: string, trialEndsAt: string | null): { plan: PlanId; status: string } {
  const trialOver = plan === "trial" && trialEndsAt !== null && Date.parse(trialEndsAt) < Date.now();
  if (trialOver || status === "canceled") return { plan, status: "read_only" };
  return { plan, status };
}

/** The plans sold on the pricing page, in order. */
export const LADDER: PlanId[] = ["foundation", "scale", "agency", "enterprise"];

/** Paid extras on top of a plan. Stored on the workspace as counts. */
export type Extras = { prompts?: number; brands?: number; seats?: number; daily?: boolean; track?: Track; trackAt?: string };

/** What a workspace can use: its plan plus any extras. */
export function limitsFor(plan: PlanId, extras: Extras = {}): Plan {
  const sold = PLANS[plan] ?? PLANS.trial;
  const p: Plan = plan === "foundation" ? { ...sold, ...STARTER[extras.track ?? "visibility"] } : sold;
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
  const i = LADDER.indexOf(plan === "trial" ? "foundation" : plan === "legacy" || plan === "thrive" ? "scale" : plan);
  return i >= 0 && i < LADDER.length - 2 ? LADDER[i + 1] : null; // Enterprise is sold by talking to us
}

/** The counted allowances, by name. */
export type Metric = "tasks" | "checknow" | "pageviews";
export const METRICS: Record<Metric, { label: string; period: "month" | "day"; limit: (l: Plan) => number }> = {
  tasks: { label: "tasks", period: "month", limit: (l) => l.tasksPerMonth },
  checknow: { label: "on-demand checks", period: "day", limit: (l) => l.checkNowPerDay },
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
export const SELF_SERVE: PlanId[] = ["foundation", "scale", "agency"];
export type Interval = "month" | "year";
// v3 prices follow the task plans. Older keys still map, so earlier subscribers keep their plan.
export const lookupKey = (plan: PlanId, interval: Interval) => `arrowsterr_v3_${plan}_${interval}`;
export function planOfLookup(key: string | null | undefined): { plan: PlanId; interval: Interval } | null {
  const m = /^arrowsterr_(?:v3_)?([a-z]+)_(month|year)$/.exec(key ?? "");
  return m && [...SELF_SERVE, "thrive"].includes(m[1] as PlanId) ? { plan: m[1] as PlanId, interval: m[2] as Interval } : null;
}
