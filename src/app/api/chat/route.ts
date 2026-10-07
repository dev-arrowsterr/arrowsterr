import { requireRole } from "@/lib/serverAuth";
import { askEngine, availableEngines, type Engine } from "@/lib/engines";
import { extractBrands } from "@/lib/extract";

// One chat: ask one engine one prompt, then pull out the brands it named.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  // Only editors and up may spend AI credits.
  const denied = await requireRole(request, body.workspaceId, "editor");
  if (denied) return denied;
  const engine = body.engine as Engine;
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 500) : "";
  const brand = typeof body.brand === "string" ? body.brand : "";
  const domain = typeof body.domain === "string" ? body.domain : "";
  if (!availableEngines().includes(engine) || !prompt || !brand) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  let answer;
  try {
    answer = await askEngine(engine, prompt);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`${engine} failed:`, message);
    return Response.json({ error: `${engine}: ${message.slice(0, 300)}` }, { status: 502 });
  }

  // No AI Overview was shown, so there is nothing to read.
  if (engine === "AI Overview" && answer.text.startsWith("_Google showed no AI Overview")) {
    return Response.json({ text: answer.text, sources: [], brands: [] });
  }

  try {
    const brands = await extractBrands(brand, domain, answer.text);
    return Response.json({ text: answer.text, sources: answer.sources, brands });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Brand extraction failed:", message);
    return Response.json({ text: answer.text, sources: answer.sources, brands: [], error: `Reading the answer failed: ${message.slice(0, 300)}` });
  }
}
