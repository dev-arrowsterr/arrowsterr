import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { entitlement } from "./entitlements";
import type { EventName } from "./integrationTypes";
import { adminClient } from "./serverAuth";

// Slack alerts, API keys and webhooks. Slack, Zapier and the API are on Pro and up (the plan's `alerts`).

const app = () => process.env.APP_URL?.trim().replace(/\/+$/, "") || "https://app.arrowsterr.com";
export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** A new API key. Only its hash is saved, so it is shown once. */
export function newKey() {
  const key = `aw_live_${randomBytes(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, 14), hash: hashKey(key) };
}

/** The workspace an API request belongs to, from its key. Returns a Response when the key is missing, wrong or not allowed. */
export async function apiAuth(request: Request): Promise<{ db: SupabaseClient; ws: string } | { denied: Response }> {
  const deny = (error: string, status: number) => ({ denied: Response.json({ error }, { status }) });
  const db = adminClient();
  if (!db) return deny("The API is not set up on the server.", 500);
  const key = request.headers.get("x-api-key")?.trim() || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!key || !key.startsWith("aw_live_")) return deny("Add your API key in the X-API-Key header.", 401);
  const { data } = await db.from("api_keys").select("id, workspace_id, revoked_at").eq("hash", hashKey(key)).maybeSingle();
  if (!data || data.revoked_at) return deny("This API key is not valid.", 401);
  const e = await entitlement(data.workspace_id);
  if (e.readOnly) return deny("This workspace is read-only.", 402);
  if (!e.limits.alerts) return deny("The API is on Pro and up.", 403);
  await db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { db, ws: data.workspace_id };
}

export async function slackSend(url: string, text: string, lines: string[] = []) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*${text}*${lines.length ? `\n${lines.map((l) => `• ${l}`).join("\n")}` : ""}` } },
        { type: "context", elements: [{ type: "mrkdwn", text: `<${app()}|Open Arrowsterr>` }] },
      ],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Slack returned ${res.status}: ${(await res.text()).slice(0, 120)}`);
}

/** Send an event to every webhook that listens for it. A webhook that is gone (410) is removed, the way Zapier asks. */
export async function dispatch(db: SupabaseClient, ws: string, event: EventName, payload: Record<string, unknown>) {
  const e = await entitlement(ws);
  if (!e.limits.alerts) return;
  const { data: hooks } = await db.from("webhooks").select("id, url, event").eq("workspace_id", ws);
  await Promise.all(
    (hooks ?? [])
      .filter((h) => h.event === event || h.event === "*")
      .map(async (h) => {
        try {
          const res = await fetch(h.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, ...payload }), signal: AbortSignal.timeout(10_000) });
          if (res.status === 410) await db.from("webhooks").delete().eq("id", h.id);
        } catch (err) {
          console.error("Webhook failed:", err instanceof Error ? err.message : err);
        }
      }),
  );
}

type Metric = { day: string; engine: string; named: string; is_you: boolean; answers: number; mentions: number };

/** Visibility by brand name for one day, counting only the given AIs. */
function shares(rows: Metric[], engines: Set<string>) {
  const answers = rows.filter((r) => r.named === "" && engines.has(r.engine)).reduce((n, r) => n + r.answers, 0);
  const by = new Map<string, { name: string; you: boolean; mentions: number }>();
  for (const r of rows) {
    if (!r.named || !engines.has(r.engine)) continue;
    const k = r.named.toLowerCase();
    const x = by.get(k) ?? { name: r.named, you: r.is_you, mentions: 0 };
    x.mentions += r.mentions;
    by.set(k, x);
  }
  return [...by.values()].map((x) => ({ ...x, visibility: answers ? Math.round((x.mentions / answers) * 1000) / 10 : 0 }));
}

/**
 * After a brand's daily numbers are saved: send the day's result to webhooks, and a Slack alert when
 * visibility moved by the workspace's alert size or a competitor overtook the brand.
 * Only AIs checked on both days are compared, since Claude and Perplexity run weekly.
 */
export async function afterDaily(db: SupabaseClient, ws: string, brandId: string, day: string) {
  const e = await entitlement(ws);
  if (!e.limits.alerts) return;
  const since = new Date(Date.parse(`${day}T00:00:00Z`) - 14 * 864e5).toISOString().slice(0, 10);
  const { data } = await db.from("daily_metrics").select("day, engine, named, is_you, answers, mentions").eq("brand_id", brandId).gte("day", since).lte("day", day);
  const rows = (data ?? []) as Metric[];
  const days = [...new Set(rows.map((r) => r.day))].sort();
  const prevDay = days.filter((d) => d < day).pop();
  const { data: brand } = await db.from("brands").select("id, name, domain").eq("id", brandId).maybeSingle();
  if (!brand) return;
  const today = rows.filter((r) => r.day === day);
  const before = prevDay ? rows.filter((r) => r.day === prevDay) : [];
  const on = (list: Metric[]) => new Set(list.filter((r) => r.named === "" && r.answers > 0).map((r) => r.engine));
  const both = prevDay ? new Set([...on(today)].filter((x) => on(before).has(x))) : on(today);
  const now = shares(today, both);
  const was = shares(before, both);
  const you = now.find((x) => x.you)?.visibility ?? 0;
  const youBefore = prevDay ? (was.find((x) => x.you)?.visibility ?? 0) : null;
  const change = youBefore === null ? null : Math.round((you - youBefore) * 10) / 10;
  const rivals = now.filter((x) => !x.you).sort((a, b) => b.visibility - a.visibility);
  const result = {
    brand: { id: brand.id, name: brand.name, domain: brand.domain },
    day,
    visibility: you,
    previous: youBefore,
    change,
    competitors: rivals.slice(0, 5).map((r) => ({ name: r.name, visibility: r.visibility })),
  };
  await dispatch(db, ws, "daily.result", result);
  if (youBefore === null) return;

  const { data: cfg } = await db.from("integrations").select("slack_webhook, alert_points").eq("workspace_id", ws).maybeSingle();
  const points = cfg?.alert_points ?? 5;
  const reasons: string[] = [];
  if (change !== null && Math.abs(change) >= points) reasons.push(`AI visibility ${change < 0 ? "fell" : "rose"} ${Math.abs(change)} points, to ${you}%`);
  for (const r of rivals) {
    const prev = was.find((x) => x.name.toLowerCase() === r.name.toLowerCase())?.visibility ?? 0;
    if (r.visibility > you && prev <= youBefore) reasons.push(`${r.name} overtook you: ${r.visibility}% vs your ${you}%`);
  }
  if (!reasons.length) return;
  await dispatch(db, ws, "visibility.alert", { ...result, reasons });
  if (cfg?.slack_webhook) {
    await slackSend(cfg.slack_webhook, `${brand.name}: AI visibility ${change! < 0 ? "dropped" : change! > 0 ? "changed" : "alert"}`, reasons).catch((err) =>
      console.error("Slack alert failed:", err instanceof Error ? err.message : err),
    );
  }
}
