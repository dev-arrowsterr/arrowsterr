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

type Range = { startAt: number; endAt: number };
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "object" && v ? Number((v as { value?: number }).value ?? 0) : 0);

export async function stats(id: string, r: Range, filter: Record<string, string> = {}) {
  const s = await api<Record<string, unknown>>(`/websites/${id}/stats`, { query: { ...r, ...filter } });
  return { pageviews: num(s.pageviews), visitors: num(s.visitors), visits: num(s.visits) };
}

export async function metrics(id: string, type: "referrer" | "url", r: Range, filter: Record<string, string> = {}) {
  const rows = await api<{ x: string; y: number }[]>(`/websites/${id}/metrics`, { query: { ...r, type, limit: 500, ...filter } });
  return Array.isArray(rows) ? rows : [];
}

export async function series(id: string, r: Range, filter: Record<string, string> = {}) {
  const out = await api<{ pageviews?: { x: string; y: number }[]; sessions?: { x: string; y: number }[] }>(`/websites/${id}/pageviews`, {
    query: { ...r, unit: "day", timezone: "UTC", ...filter },
  });
  return out.sessions ?? out.pageviews ?? [];
}

// ─────────────── AI sources ───────────────

/** Sites that send visitors from AI assistants, by assistant. */
export const AI_SOURCES: Record<string, string[]> = {
  ChatGPT: ["chatgpt.com", "chat.openai.com"],
  Perplexity: ["perplexity.ai", "www.perplexity.ai"],
  Gemini: ["gemini.google.com", "bard.google.com"],
  Claude: ["claude.ai"],
  Copilot: ["copilot.microsoft.com", "copilot.cloud.microsoft"],
  "Other AI": ["chat.deepseek.com", "grok.com", "meta.ai", "you.com", "phind.com", "poe.com", "chat.mistral.ai"],
};
export function aiSourceOf(referrer: string): string | null {
  const d = referrer.toLowerCase().replace(/^www\./, "");
  for (const [name, list] of Object.entries(AI_SOURCES)) if (list.some((x) => d === x.replace(/^www\./, "") || d.endsWith(`.${x}`))) return name;
  return null;
}
