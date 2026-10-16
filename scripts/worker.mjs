// The job worker: node scripts/worker.mjs
// Runs on Fly.io as arrowsterr-worker (fly.worker.toml). It does two things at once:
//   jobs: calls the app's /api/worker forever.
//   PDFs: asks /api/pdf/next for a report to print, opens its print page in Chromium, and sends the PDF back.
// Needs APP_URL (like https://app.arrowsterr.com) and CRON_SECRET (the same value as the app's).
// Optional: LIMIT (jobs per tick, default 20), IDLE_MS (wait when there is nothing to do, default 20000),
// PDF_IDLE_MS (wait when no PDF is queued, default 4000). Without playwright-core the PDF side stays off.

const url = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
const secret = (process.env.CRON_SECRET ?? "").trim();
if (!url || !secret) {
  console.error("Set APP_URL and CRON_SECRET on this worker.");
  process.exit(1);
}
const limit = Number(process.env.LIMIT) || 20;
const idle = Number(process.env.IDLE_MS) || 20_000;
const pdfIdle = Number(process.env.PDF_IDLE_MS) || 4_000;
const auth = { Authorization: `Bearer ${secret}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let stop = false;
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => (stop = true));

async function jobs() {
  let failures = 0;
  while (!stop) {
    let data = null;
    let status = 0;
    try {
      const res = await fetch(`${url}/api/worker?limit=${limit}`, { method: "POST", headers: auth, signal: AbortSignal.timeout(6 * 60_000) });
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
}

async function pdfs() {
  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    console.log("No playwright-core here, so report PDFs are off.");
    return;
  }
  const worker = `pdf-${(process.env.FLY_MACHINE_ID ?? "local").slice(0, 20)}`;
  let browser = null;
  let failures = 0;
  while (!stop) {
    let job = null;
    try {
      const res = await fetch(`${url}/api/pdf/next?worker=${worker}`, { method: "POST", headers: auth, signal: AbortSignal.timeout(30_000) });
      if (res.status === 401) {
        console.error("Wrong CRON_SECRET.");
        process.exit(1);
      }
      job = await res.json().catch(() => null);
    } catch (e) {
      job = { error: e instanceof Error ? e.message : String(e) };
    }
    if (!job || job.error) {
      failures++;
      console.error("pdf poll failed:", JSON.stringify(job));
      await sleep(Math.min(120_000, 5_000 * 2 ** Math.min(failures, 5)));
      continue;
    }
    failures = 0;
    if (job.idle) {
      await sleep(pdfIdle);
      continue;
    }
    const started = Date.now();
    let context = null;
    try {
      if (!browser?.isConnected()) browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
      context = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
      const page = await context.newPage();
      const res = await page.goto(`${url}${job.path}`, { waitUntil: "networkidle", timeout: 120_000 });
      if (!res || !res.ok()) throw new Error(`Print page answered ${res?.status() ?? "nothing"}.`);
      const failed = await page.locator("[data-failed]").getAttribute("data-failed", { timeout: 1_000 }).catch(() => null);
      if (failed) throw new Error(failed);
      await page.waitForSelector("[data-ready]", { timeout: 120_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.emulateMedia({ media: "print" });
      const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "10mm", bottom: "10mm", left: "8mm", right: "8mm" } });
      const done = await fetch(`${url}/api/pdf/done?id=${job.id}`, { method: "POST", headers: { ...auth, "Content-Type": "application/pdf" }, body: pdf, signal: AbortSignal.timeout(60_000) });
      if (!done.ok) throw new Error(`Upload failed: ${done.status} ${await done.text().catch(() => "")}`.slice(0, 500));
      console.log(`pdf ${job.id}: ${Math.round(pdf.length / 1024)} KB in ${Date.now() - started} ms`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`pdf ${job.id} failed:`, message);
      await fetch(`${url}/api/pdf/fail?id=${job.id}`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ error: message }), signal: AbortSignal.timeout(30_000) }).catch(() => {});
    } finally {
      await context?.close().catch(() => {});
    }
  }
  await browser?.close().catch(() => {});
}

await Promise.all([jobs(), pdfs()]);
