import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { askClaude, parseJson } from "@/lib/claude";
import { fetchSite, logoFor, normalizeSite } from "@/lib/site";

const PROMPT = (url: string, title: string, desc: string, text: string) => `You help a company see how AI assistants like ChatGPT talk about it.

Website: ${url}
Page title: ${title}
Meta description: ${desc}
Page text: ${text}

Return JSON only, with no other text, in exactly this shape:
{"name": "brand name as customers say it", "category": "one short line on what the company sells", "prompts": ["25 questions"]}

Rules for the prompts:
- 25 questions a real buyer would type into ChatGPT when choosing a product or service in this company's category.
- Bottom of the funnel: asking for the best option, comparing options, looking for alternatives, or asking which one fits their needs.
- Write them the way real people type: plain words, one sentence, 6 to 15 words.
- Keep them broad enough that many buyers ask them. Avoid rare features and very niche use cases.
- Cover the main use cases, audiences and industries this company serves. No near duplicates.
- Never include the company's brand name or domain.`;

// Onboarding: read the website, then have Claude suggest the brand name and buyer prompts.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const site = normalizeSite(String(body.website ?? ""));
  if (!site) return Response.json({ error: "Enter a website, like acme.com." }, { status: 400 });
  // Only editors and up may spend AI credits. Reading a site counts as one answer.
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY is not set on Render." }, { status: 500 });

  try {
    const page = await fetchSite(site.url);
    // If we could not load the page, let Claude look the company up on the web.
    const { text: reply } = await askClaude(PROMPT(site.url, page.title, page.desc, page.text || "Not available"), {
      searches: page.text ? 0 : 3,
    });
    let data: Record<string, unknown>;
    try {
      data = parseJson(reply);
    } catch {
      throw new Error(`Claude did not return JSON. It said: ${reply.slice(0, 200)}`);
    }
    const prompts = Array.isArray(data.prompts)
      ? [...new Set(data.prompts.filter((p): p is string => typeof p === "string").map((p) => p.trim()).filter(Boolean))].slice(0, 25)
      : [];
    if (!prompts.length) throw new Error("Claude returned no prompts.");
    const name = (typeof data.name === "string" && data.name.trim()) || page.siteName || site.domain;
    return Response.json({
      url: site.url,
      domain: site.domain,
      name,
      logo: logoFor(site.domain),
      category: typeof data.category === "string" ? data.category.trim() : "",
      prompts,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Onboarding failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
