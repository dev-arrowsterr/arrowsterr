import "server-only";
import { entitlement } from "./entitlements";
import { periodOf } from "./plans";
import { adminClient } from "./serverAuth";

// Each plan records a set number of website visits a month, across all its brands.
// Visits are counted in memory and saved every 30 seconds, so a busy site never waits on the database.
// Past the plan's number, new visits are dropped until the next billing month. Any error lets visits through.

const sites = new Map<string, { ws: string | null; at: number }>();
const counts = new Map<string, { pending: number; used: number; limit: number; period: string; at: number }>();

async function workspaceOf(website: string) {
  const hit = sites.get(website);
  if (hit && Date.now() - hit.at < 600_000) return hit.ws;
  const db = adminClient();
  if (!db) return null;
  const { data } = await db.from("brands").select("workspace_id").eq("umami_website_id", website).limit(1).maybeSingle();
  const ws = (data?.workspace_id as string | undefined) ?? null;
  sites.set(website, { ws, at: Date.now() });
  return ws;
}

async function flush() {
  const db = adminClient();
  if (!db) return;
  for (const [ws, c] of counts) {
    try {
      const e = await entitlement(ws);
      const period = periodOf("pageviews", new Date(), e.anchor);
      if (period !== c.period) Object.assign(c, { used: 0, period });
      c.limit = e.limits.pageviewsPerMonth;
      const n = c.pending;
      c.pending = 0;
      const { data, error } = await db.rpc("add_usage", { p_ws: ws, p_metric: "pageviews", p_period: c.period, p_n: n });
      if (!error && typeof data === "number") c.used = data;
      c.at = Date.now();
    } catch {
      // Try again on the next round.
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** False when this visit is over the plan's monthly number and should be dropped. */
export async function allowVisit(body: string) {
  try {
    const event = JSON.parse(body) as { type?: string; payload?: { website?: string; name?: string } };
    const website = event.payload?.website;
    if (event.type !== "event" || !website) return true;
    const ws = await workspaceOf(website);
    if (!ws) return true;
    let c = counts.get(ws);
    if (!c) {
      const e = await entitlement(ws);
      c = { pending: 0, used: 0, limit: e.limits.pageviewsPerMonth, period: periodOf("pageviews", new Date(), e.anchor), at: 0 };
      counts.set(ws, c);
    }
    if (c.used + c.pending >= c.limit) return false;
    if (!event.payload?.name) c.pending++; // page views count; clicks and scrolls ride along free
    timer ??= setInterval(() => void flush(), 30_000);
    timer.unref?.();
    return true;
  } catch {
    return true;
  }
}
