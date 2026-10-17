// Limits for the free tools on arrowsterr.com (docs/free-tools.md). Pure, so tests can check every rule.

export type FreeTool = "keyword";

/** Defaults. Each can be changed on the server: FREE_CAP_<TOOL>, FREE_PER_TOOL, FREE_PER_VISITOR, FREE_SPEND_DAY. */
export const FREE_DEFAULTS = {
  perTool: 5, // runs per visitor per tool a day
  perVisitor: 15, // runs per visitor across all tools a day
  spendDay: 15, // dollars across all free tools a day, then paid runs pause until midnight UTC
  caps: { keyword: 500 } as Record<FreeTool, number>,
  saveDays: { keyword: 30 } as Record<FreeTool, number>,
};

export type FreeLimits = { perTool: number; perVisitor: number; spendDay: number; cap: number };
export type FreeUsage = { mineTool: number; mineAll: number; toolToday: number; spentToday: number };

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && v?.trim() ? n : d;
};

export function freeLimits(tool: FreeTool, env: Record<string, string | undefined> = {}): FreeLimits {
  return {
    perTool: num(env.FREE_PER_TOOL, FREE_DEFAULTS.perTool),
    perVisitor: num(env.FREE_PER_VISITOR, FREE_DEFAULTS.perVisitor),
    spendDay: num(env.FREE_SPEND_DAY, FREE_DEFAULTS.spendDay),
    cap: num(env[`FREE_CAP_${tool.toUpperCase()}`], FREE_DEFAULTS.caps[tool]),
  };
}

/** Why a new run can't start, or null. "visitor" asks them to sign up; "busy" asks them to come back tomorrow. */
export function freeBlock(u: FreeUsage, l: FreeLimits): { kind: "visitor" | "busy"; error: string } | null {
  if (u.mineTool >= l.perTool || u.mineAll >= l.perVisitor) return { kind: "visitor", error: "You've used today's free runs. Sign up free to keep researching in Arrowsterr." };
  if (u.spentToday >= l.spendDay || u.toolToday >= l.cap) return { kind: "busy", error: "This tool is very busy today. Try again tomorrow, or sign up free to use it in the app." };
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
