// Industry Research, shared by the server and the browser: the audience sections we read from SparkToro,
// turning their replies into one simple row shape, and matching rows to the sites AI cites.

export type SectionId = "websites" | "press" | "reddit" | "social" | "youtube" | "podcasts";
export type ResearchRow = { name: string; url: string | null; score: number | null; reach: number | null };
export type Research = {
  brand_id: string;
  status: "running" | "done" | "failed";
  error: string | null;
  audience: string;
  sections: Partial<Record<SectionId, ResearchRow[]>>;
  started_at: string;
  updated_at: string | null;
};

/** The sections, in the order they show. paths: where SparkToro serves each one (the docs list two styles). credits: SparkToro's price. */
export const SECTIONS: { id: SectionId; label: string; paths: string[]; credits: number }[] = [
  { id: "websites", label: "Websites", paths: ["/v3/websites", "/v3/search/websites"], credits: 2 },
  { id: "youtube", label: "YouTube", paths: ["/v3/youtube", "/v3/search/youtube"], credits: 1 },
  { id: "podcasts", label: "Podcasts", paths: ["/v3/podcasts", "/v3/search/podcasts"], credits: 1 },
  { id: "press", label: "Press", paths: ["/v3/press", "/v3/search/press"], credits: 2 },
  { id: "social", label: "Social accounts", paths: ["/v3/social", "/v3/search/social-new"], credits: 2 },
  { id: "reddit", label: "Reddit", paths: ["/v3/reddit", "/v3/search/reddit"], credits: 2 },
];
export const CREATE_CREDITS = 10;
export const REFRESH_DAYS = 30;
const MAX_ROWS = 25;

const NAME_KEYS = ["name", "title", "display_name", "domain", "website", "publication", "subreddit", "handle", "username", "channel", "podcast"];
const URL_KEYS = ["url", "link", "website_url", "profile_url", "website", "domain"];
const SCORE_KEYS = ["affinity", "affinity_score", "score", "audience_percentage", "percentage", "percent", "pct", "share"];
const REACH_KEYS = ["followers", "subscribers", "audience_size", "reach", "members", "visits"];
const PENDING = /^(pending|processing|queued|running|in[_ ]progress|building|generating)$/i;

const first = <T>(o: Record<string, unknown>, keys: string[], ok: (v: unknown) => v is T): T | null => {
  for (const k of keys) if (ok(o[k])) return o[k] as T;
  return null;
};
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** True when SparkToro says the report or section is still being built. */
export function isPending(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  return [o.status, o.state, (o.data as Record<string, unknown> | undefined)?.status].some((s) => typeof s === "string" && PENDING.test(s.trim()));
}

/** The list inside a reply: the reply itself, or its data, results or items, or the first list it holds. */
function listOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  const o = body as Record<string, unknown>;
  for (const k of ["data", "results", "items", "rows"]) {
    if (Array.isArray(o[k])) return o[k] as unknown[];
    if (o[k] && typeof o[k] === "object") {
      const inner = listOf(o[k]);
      if (inner.length) return inner;
    }
  }
  return (Object.values(o).find(Array.isArray) as unknown[] | undefined) ?? [];
}

const asUrl = (v: string | null, section: SectionId, name: string): string | null => {
  const s = v?.trim();
  if (s && /^https?:\/\//i.test(s)) return s;
  if (s && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s)) return `https://${s}`;
  if (section === "reddit") {
    const sub = name.replace(/^\/?r\//i, "").trim();
    if (/^[a-z0-9_]+$/i.test(sub)) return `https://www.reddit.com/r/${sub}`;
  }
  return null;
};

/**
 * One SparkToro section as simple rows: a name, a link, the audience score and the reach.
 * Rows without a name are dropped. Scores between 0 and 1 are read as shares and shown as percent.
 */
export function normalizeSection(section: SectionId, body: unknown): ResearchRow[] {
  const rows: ResearchRow[] = [];
  const seen = new Set<string>();
  for (const raw of listOf(body)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    let name = first(o, NAME_KEYS, isText)?.trim() ?? null;
    if (!name) continue;
    if (section === "reddit" && !/^r\//i.test(name) && /^[a-z0-9_]+$/i.test(name)) name = `r/${name}`;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const score = first(o, SCORE_KEYS, isNum);
    rows.push({
      name,
      url: asUrl(first(o, URL_KEYS, isText), section, name),
      score: score === null ? null : score > 0 && score <= 1 ? Math.round(score * 1000) / 10 : Math.round(score * 10) / 10,
      reach: first(o, REACH_KEYS, isNum),
    });
    if (rows.length >= MAX_ROWS) break;
  }
  return rows;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

/**
 * How many AI answers cite each audience row: a website or publication by its site,
 * a subreddit by threads in it. Returns null for rows we can't match (social accounts, channels, shows).
 */
export function aiCites(section: SectionId, row: ResearchRow, chats: { sources: { url: string }[] }[]): number | null {
  if (section === "websites" || section === "press") {
    const host = row.url ? hostOf(row.url) : "";
    if (!host) return null;
    return chats.filter((c) => c.sources.some((s) => hostOf(s.url) === host || hostOf(s.url).endsWith(`.${host}`))).length;
  }
  if (section === "reddit") {
    const sub = row.name.replace(/^r\//i, "").toLowerCase();
    if (!/^[a-z0-9_]+$/.test(sub)) return null;
    return chats.filter((c) => c.sources.some((s) => /(^|\.)reddit\.com$/.test(hostOf(s.url)) && new RegExp(`/r/${sub}(/|$)`, "i").test(s.url))).length;
  }
  return null;
}
