// Every read and write the app makes. Row level security in Supabase decides what each person may do.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Chat, Run } from "./chats";
import type { AgentResult, PlanBrief } from "./research";
import { limitsFor, METRICS, nextPlan, periodOf as periodFor, type Extras, type Metric, type PlanId } from "./plans";
import type { Brief } from "./briefTypes";
import type { BrandGuideline } from "./writerTypes";

export type Role = "owner" | "admin" | "editor" | "viewer";
export const ROLE_RANK: Record<Role, number> = { owner: 4, admin: 3, editor: 2, viewer: 1 };
export const atLeast = (role: Role | undefined, min: Role) => (role ? ROLE_RANK[role] >= ROLE_RANK[min] : false);

export type Workspace = { id: string; name: string; role: Role };
export type Brand = {
  id: string;
  workspace_id: string;
  url: string;
  domain: string;
  name: string;
  logo: string;
  category: string;
  prompts: string[];
  daily: boolean; // run every day on the server
  profile: Profile;
  topics: Topic[];
};

export type BusinessType = "saas" | "ecommerce" | "service" | "marketplace" | "local" | "other";
/** What the business sells and to whom, from the onboarding questions. */
export type Profile = {
  products?: string;
  customers?: string;
  features?: string;
  businessType?: BusinessType;
  country?: string;
  columns?: SheetColumn[]; // custom columns in the Content calendar
  planBrief?: PlanBrief; // last answers to the content plan questionnaire
  bank?: BankRow[]; // ideas typed into the Topic Bank, not on the calendar yet
};
/** One idea in the Topic Bank. */
export type BankRow = {
  id: string;
  keyword: string;
  stage: "bofu" | "mofu" | "tofu" | null;
  volume: number | null;
  kd: number | null;
  intent: string | null;
  notes: string | null;
  source: string;
  added: string;
};
export type SheetColumn = { id: string; name: string; type: "text" | "number" | "date" };
/** A buying category the brand wants to win, and the prompts that track it. */
export type Topic = { name: string; prompts: string[] };

/** A brand's topics. Prompts saved before topics existed show under "Other prompts". */
export function topicsOf(b: Pick<Brand, "topics" | "prompts">): Topic[] {
  const topics = (b.topics ?? []).filter((t) => t?.name);
  const inTopic = new Set(topics.flatMap((t) => t.prompts));
  const loose = b.prompts.filter((p) => !inTopic.has(p));
  return loose.length ? [...topics, { name: "Other prompts", prompts: loose }] : topics;
}
/** Every prompt in a set of topics, once each. */
export const flatPrompts = (topics: Topic[]) => [...new Set(topics.flatMap((t) => t.prompts.map((p) => p.trim()).filter(Boolean)))];
export type SavedRun = Run & { id: string };
export type Member = { user_id: string; email: string | null; role: Role };
export type Invite = { id: string; email: string; role: Role; token: string; created_at: string };

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export async function listWorkspaces(sb: SupabaseClient, userId: string): Promise<Workspace[]> {
  const rows = check(
    await sb.from("workspace_members").select("role, workspaces(id, name)").eq("user_id", userId),
  ) as unknown as { role: Role; workspaces: { id: string; name: string } | null }[];
  return rows
    .filter((r) => r.workspaces)
    .map((r) => ({ id: r.workspaces!.id, name: r.workspaces!.name, role: r.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createWorkspace(sb: SupabaseClient, name: string): Promise<string> {
  return check(await sb.rpc("create_workspace", { p_name: name })) as string;
}

export async function renameWorkspace(sb: SupabaseClient, id: string, name: string) {
  check(await sb.from("workspaces").update({ name }).eq("id", id));
}

export async function acceptInvite(sb: SupabaseClient, token: string): Promise<string> {
  return check(await sb.rpc("accept_invite", { p_token: token })) as string;
}

const BRAND_COLS = "id, workspace_id, url, domain, name, logo, category, prompts, daily, profile, topics";

export async function listBrands(sb: SupabaseClient, workspaceId: string): Promise<Brand[]> {
  return check(
    await sb.from("brands").select(BRAND_COLS).eq("workspace_id", workspaceId).order("created_at"),
  ) as Brand[];
}

export async function addBrand(sb: SupabaseClient, b: Omit<Brand, "id" | "daily" | "profile" | "topics"> & Partial<Pick<Brand, "profile" | "topics">>): Promise<Brand> {
  return check(await sb.from("brands").insert(b).select(BRAND_COLS).single()) as Brand;
}

export async function saveBrand(sb: SupabaseClient, b: Brand) {
  check(await sb.from("brands").update({ name: b.name, prompts: b.prompts, category: b.category, logo: b.logo, daily: b.daily, profile: b.profile, topics: b.topics }).eq("id", b.id));
}

export async function deleteBrand(sb: SupabaseClient, id: string) {
  check(await sb.from("brands").delete().eq("id", id));
}

/** Runs from the last `days` days, oldest first. */
export async function listRuns(sb: SupabaseClient, brandId: string, days = 180): Promise<SavedRun[]> {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  return check(
    await sb.from("runs").select("id, at, engines, chats").eq("brand_id", brandId).gte("at", since).order("at"),
  ) as SavedRun[];
}

/** Saved chats drop the long answer text to keep rows small. */
const slim = (chats: Chat[]) => chats.map((c) => ({ ...c, answered: c.answered ?? Boolean(c.text), text: "" }));

export async function startRun(sb: SupabaseClient, workspaceId: string, brandId: string, userId: string, run: Run): Promise<string> {
  const row = check(
    await sb
      .from("runs")
      .insert({ workspace_id: workspaceId, brand_id: brandId, created_by: userId, at: run.at, engines: run.engines, chats: [] })
      .select("id")
      .single(),
  ) as { id: string };
  return row.id;
}

export async function saveRunChats(sb: SupabaseClient, runId: string, chats: Chat[]) {
  check(await sb.from("runs").update({ chats: slim(chats) }).eq("id", runId));
}

export type Answer = { engine: string; prompt: string; text: string; at: string };

/** Rows for the answers table: every chat that has text. */
export const answerRows = (chats: Chat[], ctx: { workspace_id: string; brand_id: string; run_id: string | null; at: string }) =>
  chats.filter((c) => c.text && !c.error).map((c) => ({ ...ctx, engine: c.engine, prompt: c.prompt, text: c.text }));

/** Save full answers. Skipped when the answers table is missing, so a run never fails over it. */
export async function saveAnswers(sb: SupabaseClient, rows: ReturnType<typeof answerRows>) {
  if (!rows.length) return;
  const { error } = await sb.from("answers").insert(rows);
  if (error) console.warn("Answers not saved:", error.message);
}

/** The latest full answer from each model for one prompt. Empty when none are saved. */
export async function latestAnswers(sb: SupabaseClient, brandId: string, prompt: string): Promise<Answer[]> {
  const { data, error } = await sb.from("answers").select("engine, prompt, text, at").eq("brand_id", brandId).eq("prompt", prompt).order("at", { ascending: false }).limit(40);
  if (error) return [];
  const seen = new Set<string>();
  return (data as Answer[]).filter((a) => !seen.has(a.engine) && seen.add(a.engine));
}

export async function listMembers(sb: SupabaseClient, workspaceId: string): Promise<Member[]> {
  return check(await sb.from("workspace_members").select("user_id, email, role").eq("workspace_id", workspaceId).order("created_at")) as Member[];
}

export async function setMemberRole(sb: SupabaseClient, workspaceId: string, userId: string, role: Role) {
  check(await sb.from("workspace_members").update({ role }).eq("workspace_id", workspaceId).eq("user_id", userId));
}

export async function removeMember(sb: SupabaseClient, workspaceId: string, userId: string) {
  check(await sb.from("workspace_members").delete().eq("workspace_id", workspaceId).eq("user_id", userId));
}

export async function listInvites(sb: SupabaseClient, workspaceId: string): Promise<Invite[]> {
  return check(
    await sb.from("workspace_invites").select("id, email, role, token, created_at").eq("workspace_id", workspaceId).is("accepted_at", null).order("created_at"),
  ) as Invite[];
}

export async function createInvite(sb: SupabaseClient, workspaceId: string, userId: string, email: string, role: Role): Promise<Invite> {
  return check(
    await sb
      .from("workspace_invites")
      .insert({ workspace_id: workspaceId, email: email.trim().toLowerCase(), role, invited_by: userId })
      .select("id, email, role, token, created_at")
      .single(),
  ) as Invite;
}

export async function revokeInvite(sb: SupabaseClient, id: string) {
  check(await sb.from("workspace_invites").delete().eq("id", id));
}

export type Usage = {
  brands: number;
  brandLimit: number;
  prompts: number;
  promptLimit: number;
  answersToday: number;
  answerLimit: number;
};

/** Limits and what this workspace has used. AI answers reset each day at midnight UTC. */
export async function getUsage(sb: SupabaseClient, workspaceId: string): Promise<Usage> {
  const today = new Date().toISOString().slice(0, 10);
  const [ws, brands, usage] = await Promise.all([
    sb.from("workspaces").select("brand_limit, prompt_limit, daily_answer_limit").eq("id", workspaceId).single(),
    sb.from("brands").select("prompts").eq("workspace_id", workspaceId),
    sb.from("usage").select("answers").eq("workspace_id", workspaceId).eq("day", today).maybeSingle(),
  ]);
  const w = check(ws) as { brand_limit: number; prompt_limit: number; daily_answer_limit: number };
  const b = check(brands) as { prompts: string[] }[];
  const u = check(usage) as { answers: number } | null;
  return {
    brands: b.length,
    brandLimit: w.brand_limit,
    prompts: b.reduce((n, x) => n + x.prompts.length, 0),
    promptLimit: w.prompt_limit,
    answersToday: u?.answers ?? 0,
    answerLimit: w.daily_answer_limit,
  };
}

/** The workspace's plan and how much of each allowance it used. Null before 015_billing.sql. */
export async function getPlanUsage(sb: SupabaseClient, workspaceId: string) {
  const { data, error } = await sb.from("workspaces").select("*").eq("id", workspaceId).maybeSingle();
  if (error || !data?.plan) return null;
  const w = data as {
    plan: PlanId;
    plan_status: string;
    trial_ends_at: string | null;
    period_end: string | null;
    extras: Extras;
    billing_anchor?: string | null;
    billing_interval?: "month" | "year" | null;
    cancel_at?: string | null;
    stripe_customer_id?: string | null;
  };
  const anchor = w.billing_anchor ?? null;
  const periodOf = (m: Metric) => periodFor(m, new Date(), anchor);
  const limits = limitsFor(w.plan, w.extras ?? {});
  const metrics = Object.keys(METRICS) as Metric[];
  const { data: rows } = await sb.from("usage_counters").select("metric, period, used").eq("workspace_id", workspaceId).in("period", [...new Set(metrics.map((m) => periodOf(m)))]);
  const used = (m: Metric) => ((rows ?? []) as { metric: string; period: string; used: number }[]).find((r) => r.metric === m && r.period === periodOf(m))?.used ?? 0;
  const trialLeft = w.plan === "trial" && w.trial_ends_at ? Math.max(0, Math.ceil((Date.parse(w.trial_ends_at) - Date.now()) / 864e5)) : null;
  return {
    plan: w.plan,
    name: limits.name,
    status: trialLeft === 0 ? "read_only" : w.plan_status,
    trialLeft,
    periodEnd: w.period_end,
    interval: w.billing_interval ?? null,
    cancelAt: w.cancel_at ?? null,
    customer: Boolean(w.stripe_customer_id),
    limits,
    boost: nextPlan(w.plan),
    allowances: metrics.map((m) => ({ metric: m, label: METRICS[m].label, period: METRICS[m].period, used: used(m), limit: METRICS[m].limit(limits) })),
  };
}
export type PlanUsage = NonNullable<Awaited<ReturnType<typeof getPlanUsage>>>;

// ─────────────── research ───────────────

export type Site = { id: string; workspace_id: string; brand_id: string | null; domain: string; name: string; profile: Profile };
const SITE_COLS = "id, workspace_id, brand_id, domain, name, profile";

/** The workspace's websites. Brands without one get one, made from the brand, when an editor opens Research. */
export async function listSites(sb: SupabaseClient, workspaceId: string, brands: Brand[], canEdit: boolean): Promise<Site[]> {
  let sites = check(await sb.from("sites").select(SITE_COLS).eq("workspace_id", workspaceId).order("created_at")) as Site[];
  const missing = brands.filter((b) => !sites.some((s) => s.brand_id === b.id || s.domain === b.domain));
  if (canEdit && missing.length) {
    const rows = missing.map((b) => ({ workspace_id: workspaceId, brand_id: b.id, domain: b.domain, name: b.name, profile: b.profile ?? {} }));
    check(await sb.from("sites").upsert(rows, { onConflict: "workspace_id,domain", ignoreDuplicates: true }));
    sites = check(await sb.from("sites").select(SITE_COLS).eq("workspace_id", workspaceId).order("created_at")) as Site[];
  }
  return sites;
}

/**
 * The research website for a brand. Every brand has exactly one, made on first use,
 * and it always follows the brand's business answers.
 */
export async function siteForBrand(sb: SupabaseClient, brand: Brand, canEdit: boolean): Promise<Site | null> {
  const find = async () =>
    (check(await sb.from("sites").select(SITE_COLS).eq("workspace_id", brand.workspace_id).or(`brand_id.eq.${brand.id},domain.eq."${brand.domain}"`)) as Site[]).sort(
      (a, b) => Number(b.brand_id === brand.id) - Number(a.brand_id === brand.id),
    )[0] ?? null;
  let site = await find();
  if (!site && canEdit) {
    check(await sb.from("sites").upsert({ workspace_id: brand.workspace_id, brand_id: brand.id, domain: brand.domain, name: brand.name, profile: brand.profile ?? {} }, { onConflict: "workspace_id,domain", ignoreDuplicates: true }));
    site = await find();
  }
  if (!site) return null;
  // The brand's answers win, but settings that only live on the website (calendar columns, plan answers, Topic Bank) are kept.
  const { columns, planBrief, bank } = site.profile ?? {};
  const profile: Profile = { ...(brand.profile ?? {}), ...(columns ? { columns } : {}), ...(planBrief ? { planBrief } : {}), ...(bank ? { bank } : {}) };
  if (canEdit && (site.brand_id !== brand.id || JSON.stringify(site.profile) !== JSON.stringify(profile) || site.name !== brand.name)) {
    check(await sb.from("sites").update({ brand_id: brand.id, profile, name: brand.name }).eq("id", site.id));
    site = { ...site, brand_id: brand.id, profile, name: brand.name };
  }
  return site;
}

export async function addSite(sb: SupabaseClient, s: Omit<Site, "id" | "brand_id">): Promise<Site> {
  return check(await sb.from("sites").insert(s).select(SITE_COLS).single()) as Site;
}

export async function saveSite(sb: SupabaseClient, s: Site) {
  check(await sb.from("sites").update({ name: s.name, profile: s.profile }).eq("id", s.id));
}

export async function deleteSite(sb: SupabaseClient, id: string) {
  check(await sb.from("sites").delete().eq("id", id));
}

export type CalendarStatus = "planned" | "brief" | "writing" | "published";
export type CalendarItem = {
  id: string;
  site_id: string;
  keyword: string;
  secondary: string[];
  stage: "bofu" | "mofu" | "tofu" | null;
  theme: string | null;
  volume: number | null;
  difficulty: number | null;
  intent: string | null;
  cpc: number | null;
  status: CalendarStatus;
  due_date: string | null;
  owner: string | null;
  url: string | null;
  notes: string | null;
  source: string | null;
  created_at: string;
  action: "new" | "update";
  current_url: string | null;
  current_rank: number | null;
  brief_status: "running" | "done" | "failed" | null;
  brief_error: string | null;
  brief_at: string | null;
  extra?: Record<string, string | number | null>; // values for custom columns
};
export type NewCalendarItem = Omit<
  CalendarItem,
  "id" | "status" | "due_date" | "owner" | "url" | "notes" | "created_at" | "action" | "current_url" | "current_rank" | "brief_status" | "brief_error" | "brief_at" | "extra"
> &
  Partial<Pick<CalendarItem, "status" | "action" | "current_url" | "current_rank" | "notes" | "due_date">>;
const CAL_COLS =
  "id, site_id, keyword, secondary, stage, theme, volume, difficulty, intent, cpc, status, due_date, owner, url, notes, source, created_at, action, current_url, current_rank, brief_status, brief_error, brief_at";

export async function listCalendar(sb: SupabaseClient, siteId: string): Promise<CalendarItem[]> {
  const res = await sb.from("calendar_items").select(`${CAL_COLS}, extra`).eq("site_id", siteId).order("created_at");
  // Before 013_calendar_columns.sql the extra column is missing. Load without it.
  if (res.error && /extra/.test(res.error.message)) return check(await sb.from("calendar_items").select(CAL_COLS).eq("site_id", siteId).order("created_at")) as CalendarItem[];
  return check(res) as CalendarItem[];
}

/** Add pages to the calendar. A keyword already on it is skipped. Returns how many were new. */
export async function addCalendarItems(sb: SupabaseClient, workspaceId: string, items: NewCalendarItem[]): Promise<number> {
  if (!items.length) return 0;
  const rows = check(
    await sb
      .from("calendar_items")
      .upsert(
        items.map((i) => ({ ...i, workspace_id: workspaceId })),
        { onConflict: "site_id,keyword", ignoreDuplicates: true },
      )
      .select("id"),
  ) as { id: string }[];
  return rows.length;
}

/** The brief for one calendar item, with its status. Loaded only when the item is opened. */
export async function getBrief(sb: SupabaseClient, id: string) {
  return check(await sb.from("calendar_items").select("brief, brief_status, brief_error, brief_at").eq("id", id).single()) as {
    brief: Brief | null;
    brief_status: CalendarItem["brief_status"];
    brief_error: string | null;
    brief_at: string | null;
  };
}

/** The calendar item for a keyword on a site, made if it is not there yet. Returns its id. */
export async function ensureCalendarItem(sb: SupabaseClient, workspaceId: string, siteId: string, keyword: string): Promise<string> {
  await addCalendarItems(sb, workspaceId, [{ site_id: siteId, keyword, secondary: [], stage: null, theme: null, volume: null, difficulty: null, intent: null, cpc: null, source: "agentic writer" }]);
  const row = check(await sb.from("calendar_items").select("id").eq("site_id", siteId).eq("keyword", keyword).single()) as { id: string };
  return row.id;
}

/** Tie a draft to a calendar item, so its brief shows in the Agentic Writer. */
export async function linkDoc(sb: SupabaseClient, docId: string, itemId: string) {
  check(await sb.from("docs").update({ calendar_item_id: itemId }).eq("id", docId));
}

/** Save the brief after someone edits its document. */
export async function saveBrief(sb: SupabaseClient, id: string, brief: Brief) {
  check(await sb.from("calendar_items").update({ brief }).eq("id", id));
}

export async function updateCalendarItem(sb: SupabaseClient, id: string, patch: Partial<CalendarItem>) {
  check(await sb.from("calendar_items").update(patch).eq("id", id));
}

export async function deleteCalendarItems(sb: SupabaseClient, ids: string[]) {
  check(await sb.from("calendar_items").delete().in("id", ids));
}

export type KeywordRun = { id: string; status: "running" | "done" | "failed"; step: string; error: string | null; result: AgentResult; created_at: string; finished_at: string | null };

export async function listKeywordRuns(sb: SupabaseClient, siteId: string): Promise<KeywordRun[]> {
  return check(
    await sb.from("keyword_runs").select("id, status, step, error, result, created_at, finished_at").eq("site_id", siteId).order("created_at", { ascending: false }).limit(10),
  ) as KeywordRun[];
}

export async function saveKeywordRunResult(sb: SupabaseClient, id: string, result: AgentResult) {
  check(await sb.from("keyword_runs").update({ result }).eq("id", id));
}

// ─────────────── writer ───────────────

export type DocMeta = { id: string; site_id: string; calendar_item_id: string | null; title: string; words: number; updated_at: string };
export type Doc = DocMeta & { content: Record<string, unknown> };
const DOC_META = "id, site_id, calendar_item_id, title, words, updated_at";

export async function listDocs(sb: SupabaseClient, siteId: string): Promise<DocMeta[]> {
  return check(await sb.from("docs").select(DOC_META).eq("site_id", siteId).order("updated_at", { ascending: false })) as DocMeta[];
}

export async function getDoc(sb: SupabaseClient, id: string): Promise<Doc> {
  return check(await sb.from("docs").select(`${DOC_META}, content`).eq("id", id).single()) as Doc;
}

/** A new draft. A calendar item has at most one draft: if it exists already, that one comes back. */
export async function createDoc(sb: SupabaseClient, d: { workspace_id: string; site_id: string; calendar_item_id?: string | null; title: string; content: Record<string, unknown> }): Promise<Doc> {
  if (d.calendar_item_id) {
    const { data } = await sb.from("docs").select(`${DOC_META}, content`).eq("calendar_item_id", d.calendar_item_id).maybeSingle();
    if (data) return data as Doc;
  }
  return check(await sb.from("docs").insert(d).select(`${DOC_META}, content`).single()) as Doc;
}

export async function saveDoc(sb: SupabaseClient, id: string, d: { title: string; content: Record<string, unknown>; words: number }) {
  check(await sb.from("docs").update({ ...d, updated_at: new Date().toISOString() }).eq("id", id));
}

export async function deleteDoc(sb: SupabaseClient, id: string) {
  check(await sb.from("docs").delete().eq("id", id));
}

export async function getGuideline(sb: SupabaseClient, siteId: string): Promise<BrandGuideline | null> {
  const row = check(await sb.from("sites").select("guideline").eq("id", siteId).single()) as { guideline: BrandGuideline | null };
  return row.guideline;
}
