import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailHtml, emailReady, esc, sendEmail } from "./email";
import { entitlement } from "./entitlements";
import { pts, weekOf, type Metric } from "./visibility";

// Notification emails people choose in Settings → Notifications (supabase/035_notifications.sql):
//   weekly: a Monday summary of each brand's AI visibility,
//   alerts: visibility moved by the alert size, or a competitor overtook a brand (Pro and up),
//   jobs:   a Content Plan or a brief finished or failed, sent to the person who started it.
// Every email carries a one-click unsubscribe link for its kind.

export type Kind = "weekly" | "alerts" | "jobs";
export const KINDS: Record<Kind, string> = {
  weekly: "the weekly summary",
  alerts: "visibility alerts",
  jobs: "Content Plan and brief updates",
};

const app = () => process.env.APP_URL?.trim().replace(/\/+$/, "") || "https://app.arrowsterr.com";
const secret = () => process.env.CRON_SECRET?.trim() || process.env.SUPABASE_SECRET_KEY?.trim() || "";
const DAY = 864e5;

/** A signature for an unsubscribe link, so nobody can turn off someone else's emails. */
function sign(user: string, ws: string, kind: Kind) {
  return createHmac("sha256", secret()).update(`${user}.${ws}.${kind}`).digest("base64url").slice(0, 32);
}

export function signedOk(user: string, ws: string, kind: string, sig: string) {
  if (!secret() || !(kind in KINDS)) return false;
  const want = Buffer.from(sign(user, ws, kind as Kind));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

export const unsubscribeUrl = (user: string, ws: string, kind: Kind) => `${app()}/api/notifications/unsubscribe?u=${user}&w=${ws}&k=${kind}&s=${sign(user, ws, kind)}`;

type Person = { user_id: string; email: string };

/** Members who get this kind of email: everyone, minus those who turned it off. Narrowed to `only` when given. */
async function recipients(db: SupabaseClient, ws: string, kind: Kind, only?: string[]): Promise<Person[]> {
  let q = db.from("workspace_members").select("user_id, email").eq("workspace_id", ws);
  if (only) q = q.in("user_id", only);
  const { data: members } = await q;
  const { data: prefs, error } = await db.from("notification_prefs").select(`user_id, ${kind}`).eq("workspace_id", ws);
  // Before 035_notifications.sql there are no choices yet, so everyone gets everything.
  const off = new Set(error ? [] : ((prefs ?? []) as unknown as Record<string, unknown>[]).filter((p) => p[kind] === false).map((p) => String(p.user_id)));
  return ((members ?? []) as Person[]).filter((m) => m.email && !off.has(m.user_id));
}

/** Send one email per person, each with their own unsubscribe link. Returns how many went out. */
async function sendEach(people: Person[], ws: string, kind: Kind, subject: string, build: (footer: string) => string) {
  let sent = 0;
  for (const p of people) {
    const url = unsubscribeUrl(p.user_id, ws, kind);
    const footer = `You get ${KINDS[kind]} for this workspace. <a href="${esc(url)}" style="color:#7a8499">Unsubscribe</a> or <a href="${esc(app())}/settings/notifications" style="color:#7a8499">change your emails</a>.`;
    try {
      if (await sendEmail([p.email], subject, build(footer), { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" })) sent++;
    } catch (e) {
      console.error(`Email ${kind} to ${p.email} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return sent;
}

/** Claim an email once per workspace, kind and period (email_log). False when it was already sent. */
async function claim(db: SupabaseClient, ws: string, kind: string, period: string) {
  const { error } = await db.from("email_log").insert({ workspace_id: ws, kind, period });
  return !error;
}

// ─────────────── alerts ───────────────

/** Email the day's visibility alert for a brand. Called after the Slack alert, once per brand and day. */
export async function emailAlert(db: SupabaseClient, ws: string, brand: { id: string; name: string }, day: string, reasons: string[]) {
  if (!emailReady() || !(await claim(db, ws, `alert:${brand.id}`, day))) return 0;
  const people = await recipients(db, ws, "alerts");
  return sendEach(people, ws, "alerts", `${brand.name}: AI visibility alert`, (footer) =>
    emailHtml(`${brand.name}'s AI visibility changed`, reasons, { label: "See what changed", url: `${app()}/prompts` }, { footer }),
  );
}

// ─────────────── jobs ───────────────

/** Tell the person who started a Content Plan or a brief that it finished or failed. */
export async function emailJob(db: SupabaseClient, ws: string, userId: string | null | undefined, msg: { subject: string; title: string; lines: string[]; button: string; path: string }) {
  if (!userId || !emailReady()) return 0;
  const people = await recipients(db, ws, "jobs", [userId]);
  return sendEach(people, ws, "jobs", msg.subject, (footer) => emailHtml(msg.title, msg.lines, { label: msg.button, url: `${app()}${msg.path}` }, { footer }));
}

// ─────────────── weekly summary ───────────────

/** The local weekday (0 Sunday), hour and date in a time zone. */
function localNow(tz: string | null) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", weekday: "short", hour: "numeric", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday), hour: Number(parts.hour), date: `${parts.year}-${parts.month}-${parts.day}` };
}

export function brandBlock(name: string, w: NonNullable<ReturnType<typeof weekOf>>) {
  const change = w.change === null ? "" : `<span style="font-size:14px;color:${w.change >= 0 ? "#0B7A54" : "#C2341F"}">${w.change >= 0 ? "▲" : "▼"} ${esc(pts(w.change))}</span>`;
  const cell = "padding:6px 0;font-size:14px;color:#3d4657;border-top:1px solid #eef0f4";
  const num = `${cell};text-align:right;font-family:Menlo,monospace`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e8f0;border-radius:12px;padding:16px">
<tr><td colspan="2" style="font-size:16px;font-weight:600;color:#061B44;padding-bottom:4px">${esc(name)}</td></tr>
<tr><td colspan="2" style="padding-bottom:10px"><span style="font-size:28px;font-weight:600;color:#061B44;font-family:Menlo,monospace">${w.visibility}%</span> <span style="font-size:13px;color:#7a8499">of AI answers named you</span> ${change}</td></tr>
${w.byEngine.map((e) => `<tr><td style="${cell}">${esc(e.engine)}</td><td style="${num}">${e.visibility}%</td></tr>`).join("")}
${w.top.length ? `<tr><td colspan="2" style="font-size:13px;font-weight:600;color:#7a8499;padding:12px 0 2px">Named most besides you</td></tr>${w.top.map((t) => `<tr><td style="${cell}">${esc(t.name)}</td><td style="${num}">${t.visibility}%</td></tr>`).join("")}` : ""}
</table>`;
}

/**
 * Monday from 8am in each workspace's time zone (Settings → General), once per week: the summary for every brand
 * with answers in the last 7 days. Runs about hourly from the worker and the cron.
 */
export async function sendWeekly(db: SupabaseClient) {
  if (!emailReady()) return { sent: 0 };
  let { data: list, error } = await db.from("workspaces").select("id, name, timezone");
  // Before 034_settings.sql there is no time zone. Use UTC.
  if (error) ({ data: list, error } = await db.from("workspaces").select("id, name"));
  if (error) throw new Error(error.message);
  let sent = 0;
  for (const w of (list ?? []) as { id: string; name: string; timezone?: string | null }[]) {
    let local;
    try {
      local = localNow(w.timezone ?? null);
    } catch {
      local = localNow(null);
    }
    if (local.weekday !== 1 || local.hour < 8) continue;
    const e = await entitlement(w.id);
    if (e.readOnly) continue;
    const { data: brands } = await db.from("brands").select("id, name").eq("workspace_id", w.id).order("created_at");
    if (!brands?.length) continue;
    if (!(await claim(db, w.id, "weekly", local.date))) continue;

    const since = new Date(Date.parse(`${local.date}T00:00:00Z`) - 14 * DAY).toISOString().slice(0, 10);
    const blocks: string[] = [];
    const lines: string[] = [];
    for (const b of brands) {
      const { data: rows } = await db.from("daily_metrics").select("day, engine, named, is_you, answers, mentions").eq("brand_id", b.id).gte("day", since).lt("day", local.date);
      const week = weekOf((rows ?? []) as Metric[], local.date);
      if (!week) continue;
      blocks.push(brandBlock(b.name, week));
      if (week.change !== null && Math.abs(week.change) >= 1) lines.push(`${b.name} ${week.change > 0 ? "rose" : "fell"} ${Math.abs(Math.round(week.change * 10) / 10)} points to ${week.visibility}%.`);
    }
    if (!blocks.length) continue;
    const people = await recipients(db, w.id, "weekly");
    sent += await sendEach(people, w.id, "weekly", `Your week in AI answers: ${w.name}`, (footer) =>
      emailHtml("Your week in AI answers", [`How ChatGPT, Gemini, Google's AI and the rest talked about ${w.name}'s brands over the last 7 days, against the week before.`, ...lines], { label: "Open Arrowsterr", url: `${app()}/prompts` }, { blocks, footer }),
    );
  }
  return { sent };
}
