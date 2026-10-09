import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { adminClient } from "./serverAuth";

// The hidden cost ledger. Every paid call (Claude, DataForSEO, OpenAI, Gemini, Perplexity) adds its
// real cost to the meter for the current request or job, and the total is saved per workspace.
// Customers never see it. It powers margin per plan, per customer, and the cost alert.

// US dollars per million tokens, and per web search. Update when providers change prices.
const CLAUDE: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-haiku-4-5": [1, 5],
};
export const CLAUDE_SEARCH = 0.01;

type Refund = { giveBack: () => Promise<void>; ifFree: boolean };
type Meter = { cost: number; parts: Record<string, number>; refunds: Refund[] };
const store = new AsyncLocalStorage<Meter>();

/** Add a cost to whatever request or job is running now. Does nothing outside a meter. */
export function charge(part: string, usd: number) {
  const m = store.getStore();
  if (!m || !Number.isFinite(usd) || usd <= 0) return;
  m.cost += usd;
  m.parts[part] = (m.parts[part] ?? 0) + usd;
}

export function claudeCost(model: string, input: number, output: number, searches = 0) {
  const [i, o] = CLAUDE[model] ?? CLAUDE["claude-sonnet-5-5"];
  return (input * i + output * o) / 1e6 + searches * CLAUDE_SEARCH;
}

/**
 * Hand an allowance back automatically when the route fails, or (ifFree) when it spent nothing,
 * like a saved result. Used by take() in entitlements.
 */
export function onRefund(giveBack: () => Promise<void>, ifFree: boolean) {
  store.getStore()?.refunds.push({ giveBack, ifFree });
}

/** The meter's total so far, for routes that want to report it. */
export const meterTotal = () => store.getStore()?.cost ?? 0;

/**
 * Run work with a meter, then save what it cost to the workspace's ledger.
 * Saving never blocks or fails the work.
 */
export async function metered<T>(workspaceId: string | null | undefined, action: string, fn: () => Promise<T>): Promise<T> {
  const m: Meter = { cost: 0, parts: {}, refunds: [] };
  try {
    return await store.run(m, fn);
  } finally {
    if (workspaceId && m.cost > 0) void save(workspaceId, action, m);
  }
}

async function save(workspaceId: string, action: string, m: Meter) {
  const db = adminClient();
  if (!db) return;
  const { error } = await db.from("cost_ledger").insert({ workspace_id: workspaceId, action, cost: Math.round(m.cost * 1e6) / 1e6, parts: m.parts });
  if (error && !/cost_ledger/.test(error.message)) console.error("Cost ledger:", error.message);
}

/**
 * Wrap a POST route so everything it spends lands on its workspace's ledger, and allowances it took
 * are handed back if it fails or spent nothing. Reads workspaceId from the JSON body.
 */
export function meteredRoute(action: string, handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    const body = (await request.clone().json().catch(() => ({}))) as { workspaceId?: unknown };
    return metered(typeof body.workspaceId === "string" ? body.workspaceId : null, action, async () => {
      const m = store.getStore()!;
      let res: Response | null = null;
      try {
        res = await handler(request);
        return res;
      } finally {
        const failed = !res || res.status >= 400;
        for (const r of m.refunds) if (failed || (r.ifFree && m.cost === 0)) await r.giveBack().catch(() => {});
      }
    });
  };
}
