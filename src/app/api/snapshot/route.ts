import { createHash } from "node:crypto";
import { readAnswer } from "@/lib/answer";
import { askClaude, parseJson } from "@/lib/claude";
import type { Chat } from "@/lib/chats";
import { dfsReady } from "@/lib/dataforseo";
import { askEngine, type Engine } from "@/lib/engines";
import { adminClient } from "@/lib/serverAuth";
import { fetchSite, logoFor, normalizeSite } from "@/lib/site";

// Free AI Snapshot for arrowsterr.com: a quick look at how AI answers a brand's buyer questions.
// Public, so it is capped: 3 new snapshots per visitor a day, a daily total (SNAPSHOT_DAILY_CAP, default 200),
// and the same domain within 7 days comes back from the saved result for free.
// Cost: about $0.10 each (4 prompts × 3 Google and ChatGPT answers through DataForSEO, plus Haiku).

export const maxDuration = 180;
const ENGINES: Engine[] = ["ChatGPT", "AI Mode", "AI Overview"];
const PER_IP = 3;
const DAY = 864e5;

const ORIGINS = ["https://arrowsterr.com", "https://www.arrowsterr.com", "http://localhost:3322"];
const cors = (request: Request) => {
  const o = request.headers.get("origin") ?? "";
  return { "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0], "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" };
};
const json = (request: Request, body: unknown, status = 200) => Response.json(body, { status, headers: cors(request) });

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: cors(request) });
}

const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error("Timed out")), ms))]);

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const site = normalizeSite(String(body.website ?? ""));
  if (!site) return json(request, { error: "Enter your website, like acme.com." }, 400);
  if (!dfsReady() || !process.env.ANTHROPIC_API_KEY) return json(request, { error: "The snapshot is resting. Please try again later." }, 503);
  const db = adminClient();
  if (!db) return json(request, { error: "The snapshot is resting. Please try again later." }, 503);

  // A saved result for this domain from the last 7 days costs nothing.
  const since = (ms: number) => new Date(Date.now() - ms).toISOString();
  const { data: saved, error: savedErr } = await db.from("snapshots").select("result").eq("domain", site.domain).not("result", "is", null).gte("created_at", since(7 * DAY)).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (savedErr && /snapshots/.test(savedErr.message)) return json(request, { error: "The snapshot is not set up yet." }, 503);
  if (saved?.result) return json(request, { ...saved.result, cached: true });

  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
  const ipHash = createHash("sha256").update(`${ip}:${process.env.SUPABASE_SECRET_KEY ?? ""}`).digest("hex").slice(0, 32);
  const [{ count: mine }, { count: today }] = await Promise.all([
    db.from("snapshots").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", since(DAY)),
    db.from("snapshots").select("id", { count: "exact", head: true }).gte("created_at", since(DAY)),
  ]);
  if ((mine ?? 0) >= PER_IP) return json(request, { error: "You've run 3 snapshots today. Start a free trial to track your brand every day.", limit: true }, 429);
  if ((today ?? 0) >= (Number(process.env.SNAPSHOT_DAILY_CAP) || 200)) return json(request, { error: "Lots of snapshots today. Please try again tomorrow, or start a free trial.", limit: true }, 429);
  const { data: row } = await db.from("snapshots").insert({ domain: site.domain, ip_hash: ipHash }).select("id").single();

  try {
    // 1. Read the site and write the questions its buyers ask AI.
    const page = await fetchSite(site.url);
    const { text } = await askClaude(
      `You help a business see how AI assistants talk about it. Read its website.

Website: ${site.url}
Title: ${page.title}
Description: ${page.desc}
Text: ${(page.text || "Not available").slice(0, 6000)}

Answer with JSON only: {"name": "the brand name", "category": "what it sells, in 2 to 5 words", "prompts": ["4 questions a buyer would ask ChatGPT when choosing a product like this. Never name the brand. Write them the way people type, like: best crm for small business"]}`,
      { model: "claude-haiku-5-5", maxTokens: 800, searches: page.text ? 0 : 2 },
    );
    const j = parseJson(text);
    const name = String(j.name || page.siteName || site.domain).slice(0, 80);
    const category = String(j.category ?? "").slice(0, 80);
    const prompts = (Array.isArray(j.prompts) ? j.prompts : []).map((p) => String(p).trim().slice(0, 200)).filter(Boolean).slice(0, 4);
    if (!prompts.length) throw new Error("We could not read this website. Check the address and try again.");

    // 2. Ask each AI each question, in parallel, and read which brands it named.
    const chats: Chat[] = await Promise.all(
      prompts.flatMap((prompt) =>
        ENGINES.map(async (engine) => {
          try {
            const a = await withTimeout(askEngine(engine, prompt), 120_000);
            return await readAnswer(engine, prompt, a, name, site.domain);
          } catch (e) {
            return { engine, prompt, text: "", sources: [], brands: [], error: e instanceof Error ? e.message : String(e) } as Chat;
          }
        }),
      ),
    );

    // 3. Score: the share of answers that name the brand, by AI and by question, and who AI names instead.
    const answered = chats.filter((c) => !c.error && c.text && c.shown !== false);
    const isYou = (b: { name: string }) => b.name.toLowerCase() === name.toLowerCase();
    const named = (list: Chat[]) => list.filter((c) => c.brands.some(isYou));
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
    const rivals = new Map<string, number>();
    for (const c of answered) for (const b of c.brands) if (!isYou(b)) rivals.set(b.name, (rivals.get(b.name) ?? 0) + 1);
    const result = {
      name,
      domain: site.domain,
      logo: logoFor(site.domain),
      category,
      score: pct(named(answered).length, answered.length),
      answers: answered.length,
      engines: ENGINES.map((e) => {
        const list = answered.filter((c) => c.engine === e);
        return { engine: e === "AI Overview" ? "AI Overviews" : e, named: named(list).length, answers: list.length };
      }),
      prompts: prompts.map((p) => ({
        prompt: p,
        results: ENGINES.map((e) => {
          const c = chats.find((x) => x.prompt === p && x.engine === e);
          const you = c?.brands.find(isYou);
          const top = c?.brands.slice().sort((a, b) => a.position - b.position)[0];
          return { engine: e === "AI Overview" ? "AI Overviews" : e, ok: Boolean(c && !c.error && c.text && c.shown !== false), named: Boolean(you), position: you?.position ?? null, top: top && !isYou(top) ? top.name : null };
        }),
      })),
      competitors: [...rivals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, count]) => ({ name: n, share: pct(count, answered.length) })),
      at: new Date().toISOString(),
    };
    if (row) await db.from("snapshots").update({ result }).eq("id", row.id);
    return json(request, result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Snapshot failed:", message);
    return json(request, { error: message.length < 160 ? message : "Something went wrong. Please try again." }, 500);
  }
}
