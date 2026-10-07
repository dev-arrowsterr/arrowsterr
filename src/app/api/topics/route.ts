import { askClaude, parseJson } from "@/lib/claude";
import { cleanTopicList } from "@/lib/topics";

// Suggest industry topics for a brand that was added before topics existed.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").slice(0, 100);
  const category = String(body.category ?? "").slice(0, 300);
  const prompts = (Array.isArray(body.prompts) ? body.prompts : []).slice(0, 25).map(String);
  if (!name) return Response.json({ error: "Missing brand" }, { status: 400 });
  try {
    const { text } = await askClaude(
      `${name} sells: ${category || "see the buyer questions below"}.
Buyer questions people ask in this market:
${prompts.map((p: string) => `- ${p}`).join("\n")}

List 6 to 8 topics buyers in this industry judge every brand on, like "ease of use", "pricing", "integrations", "customer support".
They must apply to every brand in the industry. 1 to 3 words each, lowercase.
Return JSON only: {"topics": ["..."]}`,
      { maxTokens: 2000 },
    );
    return Response.json({ topics: cleanTopicList(parseJson(text).topics) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
