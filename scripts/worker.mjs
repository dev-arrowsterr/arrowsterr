// The job worker: node scripts/worker.mjs
// Run it as a Render Background Worker. It calls the app's /api/worker forever.
// Needs APP_URL (like https://arrowsterr.onrender.com) and CRON_SECRET (the same value as on the web service).
// Optional: LIMIT (jobs per tick, default 20), IDLE_MS (wait when there is nothing to do, default 20000).

const url = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
const secret = (process.env.CRON_SECRET ?? "").trim();
if (!url || !secret) {
  console.error("Set APP_URL and CRON_SECRET on this worker.");
  process.exit(1);
}
const limit = Number(process.env.LIMIT) || 20;
const idle = Number(process.env.IDLE_MS) || 20_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let stop = false;
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => (stop = true));

let failures = 0;
while (!stop) {
  let data = null;
  let status = 0;
  try {
    const res = await fetch(`${url}/api/worker?limit=${limit}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(6 * 60_000),
    });
    status = res.status;
    data = await res.json().catch(() => null);
  } catch (e) {
    data = { error: e instanceof Error ? e.message : String(e) };
  }
  if (status === 401) {
    console.error("Wrong CRON_SECRET.");
    process.exit(1);
  }
  if (!data || data.error) {
    failures++;
    console.error("tick failed:", status, JSON.stringify(data));
    await sleep(Math.min(120_000, 5_000 * 2 ** Math.min(failures, 5))); // the app may be waking up or restarting
    continue;
  }
  failures = 0;
  if (data.claimed) console.log("tick:", JSON.stringify(data));
  if (data.idle) await sleep(idle);
}
