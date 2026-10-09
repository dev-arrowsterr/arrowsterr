import { askClaude, parseJson } from "@/lib/claude";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { meteredRoute } from "@/lib/meter";
import { take } from "@/lib/entitlements";

const PROMPT = (brand: string, domain: string, data: string) => `You are an AI search visibility analyst. You help ${brand} (${domain}) show up more often in answers from ChatGPT, Claude, Gemini, Perplexity and Google AI Overviews.

Here is what the AI answers looked like in the chosen period, as JSON:
${data}

Fields:
- scores: visibility (share of answers that name the brand, 0 to 100), sentiment (0 to 100), position (average spot in the list, 1 is best), rank among brands.
- siteTypes: share of all citations by site type.
- topSites: the sites AI answers cite most, with type and the share of answers that cite them.
- ownPages: the brand's own pages that AI cites, with the share of answers and how many prompts cite each.
- competitorPages: competitor pages AI cites most.
- missedPrompts: prompts where the brand is never named, and who gets named instead.

Write for a busy marketer. 9th-grade words, short sentences, direct "you". No em dashes. Be specific: name real sites, pages and prompts from the data. Never invent numbers.

Return JSON only, in exactly this shape:
{
  "summary": "2 or 3 sentences on where the brand stands and the single biggest opportunity",
  "actions": [
    {"title": "short imperative, under 10 words", "why": "one sentence with a number from the data", "how": "one or two sentences on exactly what to do"}
  ],
  "pages": [
    {"url": "one of the ownPages urls", "verdict": "strong" | "okay" | "weak", "note": "one short sentence on why it works or what to fix"}
  ]
}
Give 4 to 6 actions, most valuable first. Give one entry in pages for each of the ownPages (up to 10).`;

// A short AI read of the sources data: a summary, actions, and a note on each of your cited pages.
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const brand = typeof body.brand === "string" ? body.brand.slice(0, 100) : "";
  const domain = typeof body.domain === "string" ? body.domain.slice(0, 200) : "";
  const data = JSON.stringify(body.data ?? {});
  if (!brand || !domain || data.length > 30000) return Response.json({ error: "Bad request" }, { status: 400 });
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const took = await take(body.workspaceId, "ai");
  if (!took.ok) return took.response;
  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;

  try {
    const { text } = await askClaude(PROMPT(brand, domain, data), { maxTokens: 3000 });
    const out = parseJson(text);
    const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
    const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
    return Response.json({
      summary: str(out.summary, 800),
      actions: list(out.actions)
        .slice(0, 6)
        .map((a) => ({ title: str(a.title, 120), why: str(a.why, 400), how: str(a.how, 600) }))
        .filter((a) => a.title),
      pages: list(out.pages)
        .slice(0, 10)
        .map((p) => ({ url: str(p.url, 1000), verdict: ["strong", "okay", "weak"].includes(p.verdict as string) ? p.verdict : "okay", note: str(p.note, 300) }))
        .filter((p) => p.url),
      at: new Date().toISOString(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Insights failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("sources summary", handle);
