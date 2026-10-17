import { cleanKit } from "@/lib/brandKit";
import { cleanVoice, MAX_TEXT, MIN_URLS, sampleUrls } from "@/lib/brandVoice";
import { distillVoice } from "@/lib/brandVoiceServer";
import { take } from "@/lib/entitlements";
import { meteredRoute } from "@/lib/meter";
import { TASK_COST } from "@/lib/plans";
import { requireRole, takeAnswer } from "@/lib/serverAuth";

const err = (error: string, status = 400) => Response.json({ error }, { status });
const SETUP = "Run supabase/047_brand_voice.sql in Supabase first.";
const COLS = "brand_id, sample_urls, sample_text, voice, distilled_at, updated_at";
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

// Brand Voice for one brand (docs/content-v2.md). Reads and writes go through the person's own access (row level security).
//   get: { brandId }                                viewers: the saved voice row, or null
//   distill: { brandId, urls, text }                editors: read the pages, ask the agent, return the voice. Nothing is saved yet.
//   save: { brandId, urls, text, voice, distilled }  editors: save what the person checked. distilled: the voice came from a new distill.
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, body.action === "get" ? "viewer" : "editor");
  if ("denied" in auth) return auth.denied;
  const ws = String(body.workspaceId);
  const { data: brand } = await auth.sb.from("brands").select("id, name, domain").eq("id", String(body.brandId ?? "")).eq("workspace_id", ws).maybeSingle();
  if (!brand) return err("That brand is not in this workspace.", 404);

  if (body.action === "get") {
    const { data, error } = await auth.sb.from("brand_voices").select(COLS).eq("brand_id", brand.id).maybeSingle();
    if (error && /brand_voices/.test(error.message)) return Response.json({ row: null, setup: SETUP });
    if (error) return err(error.message, 500);
    return Response.json({ row: data ?? null });
  }

  const { urls, bad } = sampleUrls(String(body.urls ?? ""));
  const text = String(body.text ?? "").slice(0, MAX_TEXT);
  if (bad.length) return err(`Not a web address: ${bad.slice(0, 3).join(", ")}`);

  if (body.action === "distill") {
    if (!process.env.ANTHROPIC_API_KEY) return err("ANTHROPIC_API_KEY is not set on the server.", 500);
    if (urls.length < MIN_URLS && words(text) < 150) return err("Add 3 to 5 links, or paste at least 150 words.");
    const limited = await takeAnswer(auth.sb, ws);
    if (limited) return limited;
    const took = await take(ws, "tasks", TASK_COST.guideline);
    if (!took.ok) return took.response;
    // The Brand Kit's tone, when there is one, is a hint the samples can overrule.
    const { data: kitRow } = await auth.sb.from("brand_kits").select("kit").eq("workspace_id", ws).eq("key", brand.id).maybeSingle();
    try {
      const out = await distillVoice({ name: brand.name, domain: brand.domain }, { urls, text }, kitRow?.kit ? cleanKit(kitRow.kit) : null);
      return Response.json(out);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("Brand Voice failed:", message);
      return err(message, 502);
    }
  }

  if (body.action === "save") {
    const now = new Date().toISOString();
    const row = { brand_id: brand.id, workspace_id: ws, sample_urls: urls, sample_text: text, voice: cleanVoice(body.voice), updated_at: now, ...(body.distilled ? { distilled_at: now } : {}) };
    const { data, error } = await auth.sb.from("brand_voices").upsert(row, { onConflict: "brand_id" }).select(COLS).single();
    if (error) return err(/brand_voices/.test(error.message) ? SETUP : error.message, 500);
    return Response.json({ row: data });
  }

  return err("Unknown action.");
}

export const POST = meteredRoute("brand voice", handle);
