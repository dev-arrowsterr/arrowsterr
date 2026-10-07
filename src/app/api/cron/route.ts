import { createHash, timingSafeEqual } from "node:crypto";
import { answerChat } from "@/lib/answer";
import type { Chat } from "@/lib/chats";
import { availableEngines, type Engine } from "@/lib/engines";
import { adminClient } from "@/lib/serverAuth";

// The daily job. scripts/daily-run.mjs calls this over and over until it answers done: true.
// Each call starts today's runs if needed, then answers a few chats for one run.

const BATCH = 6; // chats per call, so each call ends in a few minutes
const CONCURRENCY = 3;
const DAY_MS = 20 * 3600_000; // a brand with a run in the last 20 hours is skipped

const hash = (s: string) => createHash("sha256").update(s).digest();
function allowed(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return Boolean(secret) && timingSafeEqual(hash(secret!), hash(given));
}

type Row = { id: string; workspace_id: string; brand_id: string; engines: string[]; prompts: string[] | null; chats: Chat[] };

export async function POST(request: Request) {
  if (!allowed(request)) return Response.json({ error: "Wrong or missing CRON_SECRET." }, { status: 401 });
  const sb = adminClient();
  if (!sb) return Response.json({ error: "Add SUPABASE_SECRET_KEY on Render." }, { status: 500 });
  const engines = availableEngines();
  if (!engines.length) return Response.json({ done: true, message: "No engine keys are set." });
  const fail = (error: { message: string }) => Response.json({ error: error.message }, { status: 500 });

  // Close daily runs that never finished, so a crashed job does not block tomorrow.
  const stale = new Date(Date.now() - DAY_MS).toISOString();
  let res = await sb.from("runs").update({ status: "done" }).eq("source", "daily").eq("status", "running").lt("at", stale);
  if (res.error) return fail(res.error);

  // Start a daily run for every brand that has daily runs on and no run in the last 20 hours.
  const brands = await sb.from("brands").select("id, workspace_id, prompts").eq("daily", true);
  if (brands.error) return fail(brands.error);
  const recent = await sb.from("runs").select("brand_id").gte("at", stale);
  if (recent.error) return fail(recent.error);
  const ran = new Set((recent.data ?? []).map((r) => r.brand_id));
  const fresh = (brands.data ?? [])
    .filter((b) => !ran.has(b.id) && b.prompts?.length)
    .map((b) => ({ workspace_id: b.workspace_id, brand_id: b.id, source: "daily", status: "running", engines, prompts: b.prompts, chats: [] }));
  if (fresh.length) {
    res = await sb.from("runs").insert(fresh);
    if (res.error) return fail(res.error);
  }

  // Work on the oldest unfinished daily run.
  const next = await sb
    .from("runs")
    .select("id, workspace_id, brand_id, engines, prompts, chats")
    .eq("source", "daily")
    .eq("status", "running")
    .order("at")
    .limit(1)
    .maybeSingle();
  if (next.error) return fail(next.error);
  const run = next.data as Row | null;
  if (!run) return Response.json({ done: true, started: fresh.length });

  const brand = await sb.from("brands").select("name, domain").eq("id", run.brand_id).maybeSingle();
  if (brand.error) return fail(brand.error);
  if (!brand.data) {
    await sb.from("runs").update({ status: "done" }).eq("id", run.id);
    return Response.json({ done: false, run: run.id, skipped: "brand removed" });
  }

  const have = new Set(run.chats.map((c) => `${c.engine}\n${c.prompt}`));
  const pending = run.engines
    .filter((e): e is Engine => engines.includes(e as Engine))
    .flatMap((engine) => (run.prompts ?? []).map((prompt) => ({ engine, prompt })))
    .filter((j) => !have.has(`${j.engine}\n${j.prompt}`));
  const batch = pending.slice(0, BATCH);

  const results: Chat[] = [];
  let limited = false;
  let i = 0;
  const worker = async () => {
    while (i < batch.length && !limited) {
      const job = batch[i++];
      const { data: ok, error } = await sb.rpc("take_answer", { p_ws: run.workspace_id });
      if (error) throw new Error(error.message);
      if (!ok) {
        limited = true;
        break;
      }
      results.push(await answerChat(job.engine, job.prompt, brand.data!.name, brand.data!.domain));
    }
  };
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  // Saved chats drop the long answer text to keep rows small, the same as manual runs.
  const slim = results.map((c) => ({ ...c, answered: Boolean(c.text), text: "" }));
  const status = limited ? "limited" : pending.length <= results.length ? "done" : "running";
  res = await sb.from("runs").update({ chats: [...run.chats, ...slim], status }).eq("id", run.id);
  if (res.error) return fail(res.error);
  return Response.json({ done: false, run: run.id, answered: results.length, left: pending.length - results.length, status });
}
