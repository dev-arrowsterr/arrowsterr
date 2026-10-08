import "server-only";

// Talks to Umami. Works with Umami Cloud (UMAMI_API_KEY) or your own Umami server
// (UMAMI_URL, UMAMI_USERNAME, UMAMI_PASSWORD). Moving between them is a settings change.

const cloud = () => Boolean(process.env.UMAMI_API_KEY?.trim()) && !process.env.UMAMI_URL?.trim();
export const umamiReady = () => Boolean(process.env.UMAMI_API_KEY?.trim() || (process.env.UMAMI_URL?.trim() && process.env.UMAMI_PASSWORD?.trim()));

/** Where the tracking script and event endpoint live upstream. Customers never see this address. */
export function trackerOrigin() {
  return cloud() ? "https://cloud.umami.is" : process.env.UMAMI_URL!.trim().replace(/\/+$/, "");
}

let token: { value: string; at: number } | null = null;
async function headers(): Promise<Record<string, string>> {
  if (cloud()) return { "x-umami-api-key": process.env.UMAMI_API_KEY!.trim(), Accept: "application/json" };
  if (!token || Date.now() - token.at > 6 * 3600_000) {
    const res = await fetch(`${trackerOrigin()}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: process.env.UMAMI_USERNAME?.trim() || "admin", password: process.env.UMAMI_PASSWORD?.trim() }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Umami login failed (${res.status}). Check UMAMI_USERNAME and UMAMI_PASSWORD.`);
    token = { value: (await res.json()).token, at: Date.now() };
  }
  return { Authorization: `Bearer ${token.value}`, Accept: "application/json" };
}

async function api<T>(path: string, init: { method?: string; body?: unknown; query?: Record<string, string | number> } = {}): Promise<T> {
  const base = cloud() ? "https://api.umami.is/v1" : `${trackerOrigin()}/api`;
  const qs = init.query ? `?${new URLSearchParams(Object.entries(init.query).map(([k, v]) => [k, String(v)]))}` : "";
  const res = await fetch(`${base}${path}${qs}`, {
    method: init.method ?? "GET",
    headers: { ...(await headers()), ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Umami returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function createWebsite(name: string, domain: string): Promise<string> {
  const w = await api<{ id: string }>("/websites", { method: "POST", body: { name: name.slice(0, 100), domain } });
  return w.id;
}

export type Range = { startAt: number; endAt: number };
export type Row = { x: string; y: number };
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "object" && v ? Number((v as { value?: number }).value ?? 0) : 0);

export async function stats(id: string, r: Range, filter: Record<string, string> = {}) {
  const s = await api<Record<string, unknown>>(`/websites/${id}/stats`, { query: { ...r, ...filter } });
  return { pageviews: num(s.pageviews), visitors: num(s.visitors), visits: num(s.visits), bounces: num(s.bounces), totaltime: num(s.totaltime) };
}

/** People on the site in the last 5 minutes. */
export async function active(id: string) {
  const a = await api<Record<string, unknown>>(`/websites/${id}/active`);
  return num(a.visitors ?? a.x ?? 0);
}

/**
 * One breakdown, like top pages or countries. Newer Umami calls pages "path" and older Umami calls them "url",
 * so each name in `types` is tried in turn. A breakdown this Umami doesn't have comes back empty.
 */
export async function metrics(id: string, types: string | string[], r: Range, filter: Record<string, string> = {}, limit = 500): Promise<Row[]> {
  let last: unknown;
  for (const type of Array.isArray(types) ? types : [types]) {
    try {
      const rows = await api<Row[]>(`/websites/${id}/metrics`, { query: { ...r, type, limit, ...filter } });
      return Array.isArray(rows) ? rows.filter((x) => x && typeof x.y === "number") : [];
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/** Pageviews and visitors per day. */
export async function series(id: string, r: Range, filter: Record<string, string> = {}) {
  const out = await api<{ pageviews?: Row[]; sessions?: Row[] }>(`/websites/${id}/pageviews`, {
    query: { ...r, unit: "day", timezone: "UTC", ...filter },
  });
  return { pageviews: out.pageviews ?? [], visitors: out.sessions ?? out.pageviews ?? [] };
}

// ─────────────── visitors ───────────────

type Raw = Record<string, unknown>;
const pick = (o: Raw, ...keys: string[]) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return null;
};
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export type Session = {
  id: string;
  browser: string | null;
  os: string | null;
  device: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  firstAt: string;
  lastAt: string;
  visits: number;
  views: number;
};
export type Activity = { at: string; visitId: string | null; path: string | null; query: string | null; referrer: string | null; title: string | null; event: string | null; sessionId: string | null };

function toSession(o: Raw): Session {
  return {
    id: String(pick(o, "id", "sessionId", "session_id")),
    browser: str(pick(o, "browser")),
    os: str(pick(o, "os")),
    device: str(pick(o, "device")),
    country: str(pick(o, "country")),
    region: str(pick(o, "region", "subdivision1")),
    city: str(pick(o, "city")),
    firstAt: String(pick(o, "firstAt", "first_at", "createdAt", "created_at") ?? ""),
    lastAt: String(pick(o, "lastAt", "last_at", "createdAt", "created_at") ?? ""),
    visits: Number(pick(o, "visits") ?? 1),
    views: Number(pick(o, "views") ?? 0),
  };
}
function toActivity(o: Raw): Activity {
  const type = Number(pick(o, "eventType", "event_type") ?? 1);
  return {
    at: String(pick(o, "createdAt", "created_at") ?? ""),
    visitId: str(pick(o, "visitId", "visit_id")),
    path: str(pick(o, "urlPath", "url_path")),
    query: str(pick(o, "urlQuery", "url_query")),
    referrer: str(pick(o, "referrerDomain", "referrer_domain")),
    title: str(pick(o, "pageTitle", "page_title")),
    event: type === 2 ? str(pick(o, "eventName", "event_name")) : null,
    sessionId: str(pick(o, "sessionId", "session_id")),
  };
}
const pageOf = (out: unknown): Raw[] => (Array.isArray(out) ? out : Array.isArray((out as Raw)?.data) ? ((out as Raw).data as Raw[]) : []);

/** Visitors in a period, most recent first. Up to `max`. */
export async function sessions(id: string, r: Range, max = 500): Promise<Session[]> {
  const out: Session[] = [];
  for (let page = 1; out.length < max && page <= 10; page++) {
    const rows = pageOf(await api(`/websites/${id}/sessions`, { query: { ...r, page, pageSize: 100, orderBy: "lastAt" } }));
    out.push(...rows.map(toSession));
    if (rows.length < 100) break;
  }
  return out.slice(0, max).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** Every pageview and action in a period, for all visitors. Throws if this Umami has no event list. */
export async function events(id: string, r: Range, max = 20_000): Promise<Activity[]> {
  const out: Activity[] = [];
  for (let page = 1; out.length < max && page <= 20; page++) {
    const rows = pageOf(await api(`/websites/${id}/events`, { query: { ...r, page, pageSize: 1000 } }));
    out.push(...rows.map(toActivity));
    if (rows.length < 1000) break;
  }
  return out;
}

/** One visitor's pageviews and actions, oldest first. */
export async function activity(id: string, sessionId: string, r: Range): Promise<Activity[]> {
  const rows = pageOf(await api(`/websites/${id}/sessions/${sessionId}/activity`, { query: r }));
  return rows.map(toActivity).sort((a, b) => a.at.localeCompare(b.at));
}

export { AI_SOURCES, aiSourceOf } from "./aiSources";
