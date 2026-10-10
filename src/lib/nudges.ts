import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailHtml, emailReady, sendEmail } from "./email";
import { entitlement } from "./entitlements";
import { periodOf, TASK_PACKS } from "./plans";

// Emails that help people before they hit a wall: tasks at 80% for the month, and a trial with 3 days left.
// Each one goes out once per workspace and period (email_log). Runs from the worker or the cron, about hourly.

const app = () => (process.env.APP_URL?.trim().replace(/\/+$/, "") || "https://app.arrowsterr.com") + "/billing";
const DAY = 864e5;

async function admins(db: SupabaseClient, ws: string) {
  const { data } = await db.from("workspace_members").select("email, role").eq("workspace_id", ws).in("role", ["owner", "admin"]);
  return [...new Set((data ?? []).map((m) => m.email as string | null).filter((e): e is string => Boolean(e)))];
}

/** Send one email once. The log row goes in first, so two runs at once never send twice. */
async function once(db: SupabaseClient, ws: string, kind: string, period: string, send: () => Promise<boolean>) {
  const { error } = await db.from("email_log").insert({ workspace_id: ws, kind, period });
  if (error) return false; // already sent, or 023_emails.sql not run yet
  try {
    if (await send()) return true;
  } catch (e) {
    console.error(`Email ${kind} failed:`, e instanceof Error ? e.message : e);
  }
  await db.from("email_log").delete().eq("workspace_id", ws).eq("kind", kind).eq("period", period);
  return false;
}

export async function sendNudges(db: SupabaseClient) {
  if (!emailReady()) return { sent: 0, skipped: "RESEND_API_KEY is not set." };
  const { data: list, error } = await db.from("workspaces").select("id, name, plan, trial_ends_at");
  if (error) throw new Error(error.message);
  let sent = 0;
  const now = Date.now();

  for (const w of list ?? []) {
    const e = await entitlement(w.id);
    if (e.readOnly) continue;

    // Trial ending in 3 days or less.
    if (w.plan === "trial" && w.trial_ends_at) {
      const left = Date.parse(w.trial_ends_at) - now;
      if (left > 0 && left <= 3 * DAY) {
        const days = Math.max(1, Math.ceil(left / DAY));
        const ok = await once(db, w.id, "trial3", String(w.trial_ends_at).slice(0, 10), async () =>
          sendEmail(
            await admins(db, w.id),
            `Your Arrowsterr trial ends in ${days} day${days === 1 ? "" : "s"}`,
            emailHtml(
              `${days} day${days === 1 ? "" : "s"} left on your trial`,
              [
                `Your trial for ${w.name} ends soon. After that the workspace turns read-only. Nothing is deleted.`,
                "Pick Starter for one toolset, AI Visibility or Organic Research, from $29 a month. Or get both on Pro.",
              ],
              { label: "Pick a plan", url: app() },
            ),
          ),
        );
        if (ok) sent++;
      }
    }

    // Tasks at 80% or more of the month.
    const limit = e.limits.tasksPerMonth;
    if (limit > 0) {
      const period = periodOf("tasks", new Date(), e.anchor);
      const { data: row } = await db.from("usage_counters").select("used").eq("workspace_id", w.id).eq("metric", "tasks").eq("period", period).maybeSingle();
      const used = Number(row?.used ?? 0);
      if (used >= limit * 0.8) {
        const pack = TASK_PACKS[0];
        const ok = await once(db, w.id, "tasks80", period, async () =>
          sendEmail(
            await admins(db, w.id),
            `You've used ${Math.round((used / limit) * 100)}% of this month's tasks`,
            emailHtml(
              `${(limit - Math.min(used, limit)).toLocaleString("en-US")} tasks left this month`,
              [
                `${w.name} has used ${used.toLocaleString("en-US")} of its ${limit.toLocaleString("en-US")} tasks on ${e.limits.name}.`,
                `Top up any time with a task pack, from ${pack.tasks.toLocaleString("en-US")} tasks for $${pack.price}. Pack tasks never expire.${e.credits ? ` You have ${e.credits.toLocaleString("en-US")} pack tasks already.` : ""}`,
              ],
              { label: "Buy tasks", url: app() },
            ),
          ),
        );
        if (ok) sent++;
      }
    }
  }
  return { sent };
}
