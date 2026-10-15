import "server-only";
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailReady, esc, sendEmail } from "./email";
import { finish, type Job } from "./jobs";
import { sealOldConfigs } from "./plays";
import { MAX_ATTEMPTS, PAUSED, summarize, type JobRow } from "./retryPolicy";

// The hourly check (a "watch" job, queued once an hour by the worker). It tells the team about jobs that gave up
// and jobs waiting on a person (no credit, a refused key), by Sentry and by email to ALERT_EMAIL.
// It also encrypts any website logins saved before encryption.

export async function watch(db: SupabaseClient, job: Job) {
  await sealOldConfigs(db).catch((e) => console.error("Sealing website logins failed:", e instanceof Error ? e.message : e));
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const [dead, closed, paused] = await Promise.all([
    db.from("jobs").select("kind, last_error, workspace_id").eq("status", "dead").gte("finished_at", since).limit(1000),
    // Daily checks don't die on their last try: they save a failed answer and finish, so the run still adds up.
    db.from("jobs").select("kind, last_error, workspace_id").eq("kind", "check").eq("status", "done").gte("finished_at", since).gte("attempts", MAX_ATTEMPTS).not("last_error", "is", null).limit(1000),
    db.from("jobs").select("kind, last_error, workspace_id").eq("status", "queued").like("last_error", `${PAUSED}%`).limit(1000),
  ]);
  if (dead.error) throw new Error(dead.error.message);
  if (closed.error) throw new Error(closed.error.message);
  if (paused.error) throw new Error(paused.error.message);
  const gaveUp = summarize([...(dead.data ?? []), ...(closed.data ?? [])] as JobRow[]);
  const waiting = summarize((paused.data ?? []) as JobRow[]);
  if (gaveUp.length || waiting.length) await alert(gaveUp, waiting);
  await finish(job.id);
}

async function alert(gaveUp: string[], waiting: string[]) {
  const subject = waiting.length ? "Arrowsterr: jobs are waiting on you" : "Arrowsterr: jobs gave up in the last hour";
  const text = [...(waiting.length ? ["Waiting on a person (they try again every hour and keep their tries):", ...waiting] : []), ...(gaveUp.length ? ["Gave up after every try:", ...gaveUp] : [])].join("\n");
  console.error(`${subject}\n${text}`);
  Sentry.captureMessage(subject, { level: "error", extra: { gaveUp, waiting } });
  const to = (process.env.ALERT_EMAIL ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!to.length || !emailReady()) return;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111">
${waiting.length ? `<p><b>Waiting on you.</b> These try again every hour and keep their tries. Add credit or fix the key, and they finish on their own.</p><ul>${waiting.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
${gaveUp.length ? `<p><b>Gave up after every try in the last hour.</b> To run them again, in Supabase → SQL Editor: <code>select retry_dead_jobs();</code></p><ul>${gaveUp.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
</div>`;
  await sendEmail(to, subject, html).catch((e) => console.error("Alert email failed:", e instanceof Error ? e.message : e));
}
