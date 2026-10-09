import { askClaude, parseJson } from "@/lib/claude";
import { requireRole, takeAnswer } from "@/lib/serverAuth";

const PROMPT = (brand: string, domain: string, date: string, data: string) => `You plan content for ${brand} (${domain}) so AI assistants like ChatGPT, Claude, Gemini and Perplexity name it more often.

Here is what AI answers say today, as JSON:
${data}

Fields:
- missed: prompts where AI rarely names ${brand}, with the brands it names instead.
- weak: prompts where AI names ${brand} but low in the list.
- sites: the sites AI cites most when it answers these prompts.
- planned: keywords already on the calendar. Do not repeat them.

Suggest 6 pieces of content to publish around ${date}. Each must target one of the prompts above, or a close search that feeds them.
9th-grade words, short sentences. No em dashes. Never invent numbers.

Return JSON only:
{"ideas": [{"title": "working title", "keyword": "main keyword, 2 to 6 words, lowercase", "stage": "bofu" | "mofu" | "tofu", "angle": "one sentence on the angle and format", "why": "one sentence tied to a prompt or brand in the data"}]}`;

// Content ideas for one day of the editorial calendar, from the brand's AI visibility gaps.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const brand = typeof body.brand === "string" ? body.brand.slice(0, 100) : "";
  const domain = typeof body.domain === "string" ? body.domain.slice(0, 200) : "";
  const date = typeof body.date === "string" ? body.date.slice(0, 10) : "";
  const data = JSON.stringify(body.data ?? {});
  if (!brand || !domain || data.length > 30000) return Response.json({ error: "Bad request" }, { status: 400 });
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;

  try {
    const { text } = await askClaude(PROMPT(brand, domain, date, data), { maxTokens: 2500 });
    const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
    const list = Array.isArray(parseJson(text).ideas) ? (parseJson(text).ideas as Record<string, unknown>[]) : [];
    return Response.json({
      ideas: list
        .slice(0, 8)
        .map((i) => ({
          title: str(i.title, 160),
          keyword: str(i.keyword, 80).toLowerCase(),
          stage: ["bofu", "mofu", "tofu"].includes(i.stage as string) ? i.stage : null,
          angle: str(i.angle, 300),
          why: str(i.why, 300),
        }))
        .filter((i) => i.keyword),
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
