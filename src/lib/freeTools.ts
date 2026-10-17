import "server-only";
import { createHash } from "node:crypto";
import { DAY, readCache, writeCache } from "./cache";
import { esc, sendEmail } from "./email";
import { freeBlock, freeLimits, FREE_TOOLS, utcDayStart, type FreeTool } from "./freeLimits";
import { adminClient } from "./serverAuth";

// The guard every free tool on arrowsterr.com goes through (docs/free-tools.md):
//   1. Only arrowsterr.com may call it (CORS), and a Cloudflare Turnstile token is checked when TURNSTILE_SECRET is set.
//   2. A saved result for the same input comes back free and counts toward no limit.
//   3. A new run needs room under the visitor's limits, the tool's daily cap and the daily spend for all free tools.
//   4. The run and what it cost are saved in free_runs. Passing the daily spend emails FREE_ALERT_EMAIL once a day.

const ORIGINS = ["https://arrowsterr.com", "https://www.arrowsterr.com", "http://localhost:3322"];
export const cors = (request: Request) => {
  const o = request.headers.get("origin") ?? "";
  return { "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0], "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" };
};
export const reply = (request: Request, body: unknown, status = 200) => Response.json(body, { status, headers: cors(request) });

const ipOf = (request: Request) => (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
const hashIp = (ip: string) => createHash("sha256").update(`free:${ip}:${process.env.SUPABASE_SECRET_KEY ?? ""}`).digest("hex").slice(0, 32);

/** True when Turnstile is off, or the token is good. */
async function human(token: unknown, ip: string) {
  const secret = process.env.TURNSTILE_SECRET?.trim();
  if (!secret) return true;
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(8_000),
    });
    return Boolean(((await res.json()) as { success?: boolean }).success);
  } catch {
    return false;
  }
}

/** One email a day when the free tools pass their daily spend. */
async function alarm(spent: number, limit: number) {
  const day = utcDayStart().slice(0, 10);
  if ((await readCache(`free:alarm:${day}`, DAY)) !== undefined) return;
  await writeCache(`free:alarm:${day}`, true);
  const to = (process.env.FREE_ALERT_EMAIL ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  console.error(`Free tools passed $${limit} today ($${spent.toFixed(2)}). Paid runs are paused until midnight UTC.`);
  await sendEmail(to, "Free tools paused for today", `<p>The free tools on arrowsterr.com spent $${esc(spent.toFixed(2))} today, past the $${esc(String(limit))} limit (FREE_SPEND_DAY).</p><p>New paid runs are paused until midnight UTC. Saved results still work.</p>`).catch(() => {});
}

export type FreeRun<T> = { result: T; cost: number };

/** Run a free tool through the guard. key is the cleaned input; run does the paid work and says what it cost. */
export async function freeRun<T>(request: Request, body: Record<string, unknown>, tool: FreeTool, key: string, run: () => Promise<FreeRun<T>>): Promise<Response> {
  const db = adminClient();
  if (!db) return reply(request, { error: "This tool is resting. Please try again later." }, 503);
  const ip = ipOf(request);
  if (!(await human(body.token, ip))) return reply(request, { error: "Please confirm you're human, then try again.", human: true }, 403);

  const saveFrom = new Date(Date.now() - FREE_TOOLS[tool].saveDays * DAY).toISOString();
  const { data: saved, error } = await db.from("free_runs").select("result, created_at").eq("tool", tool).eq("key", key).not("result", "is", null).gte("created_at", saveFrom).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return reply(request, { error: /free_runs/.test(error.message) ? "This tool is not set up yet." : "Something went wrong. Please try again." }, 503);
  if (saved?.result) return reply(request, { ...(saved.result as object), cached: true, at: saved.created_at });

  const ipHash = hashIp(ip);
  const dayStart = utcDayStart();
  const dayAgo = new Date(Date.now() - DAY).toISOString();
  const [mineTool, mineAll, toolToday, spend] = await Promise.all([
    db.from("free_runs").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).eq("tool", tool).gte("created_at", dayAgo),
    db.from("free_runs").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", dayAgo),
    db.from("free_runs").select("id", { count: "exact", head: true }).eq("tool", tool).gte("created_at", dayStart),
    db.from("free_runs").select("cost").gte("created_at", dayStart).gt("cost", 0).limit(20000),
  ]);
  const spentToday = ((spend.data ?? []) as { cost: number | string }[]).reduce((n, r) => n + Number(r.cost), 0);
  const limits = freeLimits(tool, process.env);
  const block = freeBlock({ mineTool: mineTool.count ?? 0, mineAll: mineAll.count ?? 0, toolToday: toolToday.count ?? 0, spentToday }, limits);
  if (block) {
    if (limits.paid && spentToday >= limits.spendDay) void alarm(spentToday, limits.spendDay);
    return reply(request, { error: block.error, limit: true, signup: block.kind === "visitor" }, 429);
  }

  // The row counts toward the limits from the start, so many runs at once can't slip past them.
  const { data: row } = await db.from("free_runs").insert({ tool, key, ip_hash: ipHash }).select("id").single();
  try {
    const { result, cost } = await run();
    if (row) await db.from("free_runs").update({ result, cost: Math.round(cost * 1e6) / 1e6 }).eq("id", row.id);
    return reply(request, { ...(result as object), cached: false, at: new Date().toISOString() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // A failed run doesn't use up the visitor's runs.
    if (row) await db.from("free_runs").delete().eq("id", row.id);
    // Errors about the visitor's own input (a site that didn't answer, a page that isn't HTML) are shown as they are.
    if ((e as { visitor?: boolean }).visitor) return reply(request, { error: message }, 422);
    console.error(`Free tool ${tool} failed:`, message);
    return reply(request, { error: "Something went wrong. Please try again in a minute." }, 500);
  }
}
