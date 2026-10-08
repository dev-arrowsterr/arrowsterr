// Render Cron Job runs this once a day: node scripts/daily-run.mjs
// It keeps calling the app's /api/cron until every brand's daily run is finished.
// ChatGPT, Gemini and AI Overview answers wait in DataForSEO's queue, so a run can take up to about an hour.
// Needs APP_URL (like https://arrowsterr.onrender.com) and CRON_SECRET (the same value as on the web service).

const url = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
const secret = (process.env.CRON_SECRET ?? "").trim();
if (!url || !secret) {
  console.error("Set APP_URL and CRON_SECRET on this cron job.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const started = Date.now();
const MAX_MS = 4 * 3600_000; // stop after 4 hours, whatever happens
let failures = 0;
for (let step = 1; Date.now() - started < MAX_MS; step++) {
  let data = null;
  let status = 0;
  try {
    const res = await fetch(`${url}/api/cron`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(15 * 60_000),
    });
    status = res.status;
    data = await res.json().catch(() => null);
  } catch (e) {
    data = { error: e instanceof Error ? e.message : String(e) };
  }
  console.log(`step ${step}:`, status, JSON.stringify(data));
  if (data?.done) {
    console.log("All daily runs are finished.");
    process.exit(0);
  }
  if (status === 401 || !data || data.error) {
    if (status === 401 || ++failures >= 5) process.exit(1);
    await sleep(15_000); // the app may be waking up or restarting
    continue;
  }
  failures = 0;
  // Only waiting on DataForSEO's queue (up to about 45 minutes). Check again in a minute.
  if (data.waiting) await sleep(60_000);
}
console.log("Stopped after 4 hours. Unfinished runs continue tomorrow.");
