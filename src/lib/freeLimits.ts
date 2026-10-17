// Limits for the free tools on arrowsterr.com (docs/free-tools.md). Pure, so tests can check every rule.

export type FreeTool = "keyword" | "crawlers" | "llms" | "answer" | "authority" | "speed" | "links";

/**
 * Each tool's limits. perTool is new runs per visitor a day; cap is new runs for everyone a day; saveDays is how long
 * a result is reused for free; paid tools stop when the day's spend passes FREE_SPEND_DAY. Server settings can change
 * them: FREE_CAP_<TOOL>, FREE_PER_TOOL (paid tools), FREE_PER_VISITOR, FREE_SPEND_DAY.
 */
export const FREE_TOOLS: Record<FreeTool, { perTool: number; cap: number; saveDays: number; paid: boolean }> = {
  keyword: { perTool: 5, cap: 500, saveDays: 30, paid: true },
  crawlers: { perTool: 20, cap: 3000, saveDays: 1, paid: false },
  llms: { perTool: 10, cap: 1000, saveDays: 7, paid: false },
  answer: { perTool: 20, cap: 3000, saveDays: 1, paid: false },
  authority: { perTool: 20, cap: 2000, saveDays: 7, paid: false },
  speed: { perTool: 10, cap: 1500, saveDays: 1, paid: false },
  links: { perTool: 5, cap: 300, saveDays: 1, paid: false },
};

export const FREE_DEFAULTS = {
  perVisitor: 40, // new runs per visitor across all tools a day
  spendDay: 15, // dollars across all free tools a day, then paid tools pause until midnight UTC
};

export type FreeLimits = { perTool: number; perVisitor: number; spendDay: number; cap: number; paid: boolean };
export type FreeUsage = { mineTool: number; mineAll: number; toolToday: number; spentToday: number };

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && v?.trim() ? n : d;
};

export function freeLimits(tool: FreeTool, env: Record<string, string | undefined> = {}): FreeLimits {
  const t = FREE_TOOLS[tool];
  return {
    perTool: t.paid ? num(env.FREE_PER_TOOL, t.perTool) : t.perTool,
    perVisitor: num(env.FREE_PER_VISITOR, FREE_DEFAULTS.perVisitor),
    spendDay: num(env.FREE_SPEND_DAY, FREE_DEFAULTS.spendDay),
    cap: num(env[`FREE_CAP_${tool.toUpperCase()}`], t.cap),
    paid: t.paid,
  };
}

/** Why a new run can't start, or null. "visitor" asks them to sign up; "busy" asks them to come back tomorrow. */
export function freeBlock(u: FreeUsage, l: FreeLimits): { kind: "visitor" | "busy"; error: string } | null {
  if (u.mineTool >= l.perTool || u.mineAll >= l.perVisitor) return { kind: "visitor", error: "You've used today's free runs. Sign up free to keep researching in Arrowsterr." };
  if ((l.paid && u.spentToday >= l.spendDay) || u.toolToday >= l.cap) return { kind: "busy", error: "This tool is very busy today. Try again tomorrow, or sign up free to use it in the app." };
  return null;
}

/** A keyword as the tool takes it: lowercase, single spaces, 2 to 80 characters, no links or code. Null when it won't do. */
export function cleanKeyword(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const k = input.normalize("NFKC").toLowerCase().replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (k.length < 2 || k.length > 80) return null;
  if (/https?:\/\/|www\.|[<>{}[\]\\|^`;]/.test(k)) return null;
  if (!/\p{L}|\p{N}/u.test(k)) return null;
  if (k.split(" ").length > 10) return null;
  return k;
}

/** The start of today in UTC, when the daily counts and the spend alarm reset. */
export const utcDayStart = (now = Date.now()) => new Date(Math.floor(now / 864e5) * 864e5).toISOString();

/** A website address as the tools take it: https://host/path, no login, no odd ports. Null when it won't do. */
export function cleanUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (!s || s.length > 2000) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  if (u.port && !["80", "443"].includes(u.port)) return null;
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || host.endsWith(".local") || host.endsWith(".internal") || host === "localhost") return null;
  u.hash = "";
  return u.toString();
}

/** Just the domain: example.com from any address. Null when it won't do. */
export function cleanDomain(input: unknown): string | null {
  const u = cleanUrl(input);
  return u ? new URL(u).hostname.replace(/^www\./, "") : null;
}
