// The job worker: node scripts/worker.mjs
// Runs on Fly.io as arrowsterr-worker (fly.worker.toml). It does three things at once:
//   jobs: calls the app's /api/worker forever.
//   PDFs: asks /api/pdf/next for a report to print, opens its print page in Chromium, and sends the PDF back.
//   pages: asks /api/research/render-next for a page an article's research needs, reads it in Chromium,
//          and sends its headings, text, tables and date to /api/research/render-done (docs/content-v2.md).
// Needs APP_URL (like https://app.arrowsterr.com) and CRON_SECRET (the same value as the app's).
// Optional: LIMIT (jobs per tick, default 20), IDLE_MS (wait when there is nothing to do, default 20000),
// PDF_IDLE_MS (wait when no PDF is queued, default 4000), READ_IDLE_MS (wait when no page is queued, default 5000),
// READERS (pages read at once, default 2; 0 turns reading off). Without playwright-core, PDFs and pages stay off.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const url = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
const secret = (process.env.CRON_SECRET ?? "").trim();
if (!url || !secret) {
  console.error("Set APP_URL and CRON_SECRET on this worker.");
  process.exit(1);
}
const limit = Number(process.env.LIMIT) || 20;
const idle = Number(process.env.IDLE_MS) || 20_000;
const pdfIdle = Number(process.env.PDF_IDLE_MS) || 4_000;
const readIdle = Number(process.env.READ_IDLE_MS) || 5_000;
const readers = Math.max(0, Math.min(6, Number(process.env.READERS ?? 2) || 0));
const machine = (process.env.FLY_MACHINE_ID ?? "local").slice(0, 20);
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

// ─────────────── one Chromium for PDFs and pages ───────────────
let browser = null;
let launching = null;
async function chromiumOrNull() {
  try {
    return (await import("playwright-core")).chromium;
  } catch {
    return null;
  }
}
/** The shared browser, started again if it crashed. Loops asking at the same time share one launch. */
async function shared(chromium) {
  if (browser?.isConnected()) return browser;
  launching ??= chromium
    .launch({ args: ["--disable-dev-shm-usage"] })
    .then((b) => (browser = b))
    .finally(() => (launching = null));
  return launching;
}

async function pdfs(chromium) {
  const worker = `pdf-${machine}`;
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
      context = await (await shared(chromium)).newContext({ viewport: { width: 1100, height: 1400 } });
      const page = await context.newPage();
      const res = await page.goto(`${url}${job.path}`, { waitUntil: "networkidle", timeout: 120_000 });
      if (!res || !res.ok()) throw new Error(`Print page answered ${res?.status() ?? "nothing"}.`);
      const failed = await page.locator("[data-failed]").getAttribute("data-failed", { timeout: 1_000 }).catch(() => null);
      if (failed) throw new Error(failed);
      await page.waitForSelector("[data-ready]", { timeout: 120_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.emulateMedia({ media: "print" });
      // Page numbers in the bottom margin, small and grey, on every PDF.
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: '<div style="width:100%;padding:0 8mm;font:8px sans-serif;color:#8a8f99;text-align:right"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        margin: { top: "10mm", bottom: "14mm", left: "8mm", right: "8mm" },
      });
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
}

// ─────────────── pages for article research ───────────────
// 20 seconds a page, no logins, nothing on a private network. The app checked the address and robots.txt before
// handing it out; here every request the page makes is checked too, redirects one by one, and where it ended up.
const READ_MS = 20_000;
const READER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 ArrowsterrBot/1.0 (+https://arrowsterr.com/)";

// The same ranges as src/lib/netCheck.ts. This file runs alone on the worker, so it keeps its own copy.
function privateIp(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateIp(mapped[1]);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
}

const hosts = new Map(); // host -> { ok, at }, for 5 minutes
/** True for http(s) addresses whose every IP is public. */
async function publicUrl(address) {
  let u;
  try {
    u = new URL(address);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host)) return !privateIp(host);
  if (!host.includes(".") || /(^|\.)(localhost|local|internal|flycast)$/.test(host)) return false;
  const hit = hosts.get(host);
  if (hit && Date.now() - hit.at < 300_000) return hit.ok;
  let ok = false;
  try {
    const list = await lookup(host, { all: true });
    ok = list.length > 0 && !list.some((a) => privateIp(a.address));
  } catch {}
  if (hosts.size > 5000) hosts.clear();
  hosts.set(host, { ok, at: Date.now() });
  return ok;
}

// Runs inside the page: headings, the main text, tables and the published date.
function extract() {
  const text = (el) => (el?.innerText ?? el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const headings = [...document.querySelectorAll("h1, h2, h3, h4")]
    .filter((h) => h.getClientRects().length > 0)
    .map((h) => ({ level: Number(h.tagName[1]), text: text(h) }))
    .filter((h) => h.text)
    .slice(0, 200);
  const meta = (sel) => document.querySelector(sel)?.getAttribute("content") || null;
  let published =
    meta('meta[property="article:published_time"]') || meta('meta[itemprop="datePublished"]') || meta('meta[name="date"]') || meta('meta[name="publish-date"]') || meta('meta[name="pubdate"]');
  const inLd = (x) => {
    if (!x || typeof x !== "object") return null;
    if (Array.isArray(x)) {
      for (const y of x) {
        const found = inLd(y);
        if (found) return found;
      }
      return null;
    }
    return typeof x.datePublished === "string" ? x.datePublished : inLd(x["@graph"]);
  };
  for (const s of published ? [] : document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      published = inLd(JSON.parse(s.textContent || ""));
    } catch {}
    if (published) break;
  }
  published ||= document.querySelector("[itemprop=datePublished]")?.getAttribute("datetime") || document.querySelector("article time[datetime], time[datetime]")?.getAttribute("datetime") || null;
  const main = document.querySelector("article") || document.querySelector("main, [role=main]") || document.body;
  for (const el of main.querySelectorAll("script, style, noscript, svg, nav, footer, aside, form, iframe, [aria-hidden=true]")) el.remove();
  const tables = [...main.querySelectorAll("table")]
    .slice(0, 10)
    .map((t) => [...t.rows].slice(0, 50).map((r) => [...r.cells].slice(0, 12).map((c) => text(c).slice(0, 300))))
    .filter((t) => t.length > 1);
  let body = (main.innerText || "").trim();
  if (main !== document.body && body.split(/\s+/).length < 150) body = (document.body.innerText || "").trim();
  return {
    title: document.querySelector('meta[property="og:title"]')?.getAttribute("content") || document.title || null,
    headings,
    body: body.slice(0, 60_000),
    word_count: body.split(/\s+/).filter(Boolean).length,
    tables,
    published_at: published,
    login: Boolean(document.querySelector('input[type="password"]')),
  };
}

async function readPage(chromium, address) {
  const context = await (await shared(chromium)).newContext({ userAgent: READER_UA, viewport: { width: 1280, height: 1600 }, acceptDownloads: false, serviceWorkers: "block" });
  const deadline = Date.now() + READ_MS;
  const left = () => Math.max(1_000, deadline - Date.now());
  try {
    await context.route("**/*", async (route) => {
      const req = route.request();
      try {
        if (["image", "media", "font"].includes(req.resourceType())) return await route.abort();
        if (!(await publicUrl(req.url()))) return await route.abort("blockedbyclient");
        if (!req.isNavigationRequest()) return await route.continue();
        // Redirects are followed one at a time, so a public page can't send the browser into a private network.
        const res = await route.fetch({ maxRedirects: 0, timeout: left() });
        const to = res.headers().location;
        if (res.status() >= 300 && res.status() < 400 && to && !(await publicUrl(new URL(to, req.url()).toString()))) return await route.abort("blockedbyclient");
        return await route.fulfill({ response: res });
      } catch {
        await route.abort().catch(() => {});
      }
    });
    const page = await context.newPage();
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    const res = await page.goto(address, { waitUntil: "domcontentloaded", timeout: READ_MS });
    const status = res?.status() ?? 0;
    if (status === 401 || status === 403 || status === 407) return { ok: false, reason: "blocked", error: `The page answered ${status}.` };
    if (!res || status >= 400) return { ok: false, reason: "failed", error: `The page answered ${status || "nothing"}.` };
    const type = res.headers()["content-type"] ?? "";
    if (type && !/html|xml/i.test(type)) return { ok: false, reason: "blocked", error: "Not a web page." };
    await page.waitForLoadState("networkidle", { timeout: left() }).catch(() => {}); // busy pages are read as they are at 20 seconds
    const final = page.url();
    if (!(await publicUrl(final))) return { ok: false, reason: "private", error: "The page went to a private network." };
    const read = await Promise.race([page.evaluate(extract), sleep(5_000).then(() => Promise.reject(new Error("Timeout: reading the page took too long.")))]);
    if (read.login && read.word_count < 300) return { ok: false, reason: "blocked", error: "The page asks for a login." };
    delete read.login;
    return { ok: true, final_url: final, ...read };
  } finally {
    await context.close().catch(() => {});
  }
}

async function pages(chromium, n) {
  const worker = `read-${machine}-${n}`;
  let failures = 0;
  while (!stop) {
    let task = null;
    try {
      const res = await fetch(`${url}/api/research/render-next?worker=${worker}`, { method: "POST", headers: auth, signal: AbortSignal.timeout(130_000) });
      if (res.status === 401) {
        console.error("Wrong CRON_SECRET.");
        process.exit(1);
      }
      task = await res.json().catch(() => null);
    } catch (e) {
      task = { error: e instanceof Error ? e.message : String(e) };
    }
    if (!task || task.error) {
      failures++;
      console.error("page poll failed:", JSON.stringify(task));
      await sleep(Math.min(120_000, 5_000 * 2 ** Math.min(failures, 5)));
      continue;
    }
    failures = 0;
    if (task.idle) {
      await sleep(readIdle);
      continue;
    }
    const started = Date.now();
    let result;
    try {
      const late = sleep(READ_MS + 15_000).then(() => ({ ok: false, reason: "timeout", error: "The page took longer than 20 seconds." }));
      result = await Promise.race([readPage(chromium, task.url), late]);
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 300);
      result = { ok: false, reason: /timeout/i.test(message) ? "timeout" : /ERR_BLOCKED_BY_CLIENT/.test(message) ? "private" : "failed", error: message };
    }
    const sent = await fetch(`${url}/api/research/render-done?id=${task.id}&worker=${worker}`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(result), signal: AbortSignal.timeout(60_000) })
      .then((r) => r.ok)
      .catch(() => false);
    console.log(`page ${task.id}: ${result.ok ? `${result.word_count} words` : result.reason} in ${Date.now() - started} ms${sent ? "" : " (not saved)"}`);
  }
}

const chromium = await chromiumOrNull();
if (!chromium) console.log("No playwright-core here, so report PDFs and page reading are off.");
await Promise.all([jobs(), ...(chromium ? [pdfs(chromium), ...Array.from({ length: readers }, (_, i) => pages(chromium, i))] : [])]);
await browser?.close().catch(() => {});
