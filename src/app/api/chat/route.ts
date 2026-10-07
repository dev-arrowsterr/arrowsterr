import { answerChat } from "@/lib/answer";
import { availableEngines, type Engine } from "@/lib/engines";
import { requireRole, takeAnswer } from "@/lib/serverAuth";

// One chat: ask one engine one prompt, then pull out the brands it named.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const engine = body.engine as Engine;
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 500) : "";
  const brand = typeof body.brand === "string" ? body.brand : "";
  const domain = typeof body.domain === "string" ? body.domain : "";
  if (!availableEngines().includes(engine) || !prompt || !brand) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  // Only editors and up may spend AI credits, and only within the daily limit.
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;

  const chat = await answerChat(engine, prompt, brand, domain);
  if (chat.error && !chat.text) return Response.json({ error: chat.error }, { status: 502 });
  return Response.json({ text: chat.text, sources: chat.sources, brands: chat.brands, error: chat.error ?? undefined });
}
