import { askClaude, askJson } from "@/lib/claude";
import { cleanProfile, cleanTopics, PLAN_PROMPT, PLAN_SCHEMA, RESEARCH_PROMPT } from "@/lib/onboarding";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { take } from "@/lib/entitlements";
import { TASK_COST } from "@/lib/plans";
import { fetchSitePages, logoFor, normalizeSite } from "@/lib/site";
import { meteredRoute } from "@/lib/meter";

// Onboarding: research the brand, then return it with its 5 BOFU topics.
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const site = normalizeSite(String(body.website ?? ""));
  if (!site) return Response.json({ error: "Enter a website, like acme.com." }, { status: 400 });
  // Only editors and up may spend AI credits. Reading a site counts as one answer.
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const took = await take(body.workspaceId, "tasks", TASK_COST.ai);
  if (!took.ok) return took.response;
  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  try {
    const page = await fetchSitePages(site.url);
    // Pass 1 searches the web for the offering, buyers and competitors. Pass 2 writes the business and its topics as fixed JSON.
    const { text: notes } = await askClaude(RESEARCH_PROMPT(site.url, page.title, page.desc, page.text || "Not available. Look the company up on the web."), {
      searches: 3,
      maxTokens: 5000,
    });
    const data = await askJson<Record<string, unknown>>(PLAN_PROMPT(site.url, notes, page.text), PLAN_SCHEMA, { maxTokens: 5000 });
    const name = (typeof data.name === "string" && data.name.trim()) || page.siteName || site.domain;
    const profile = cleanProfile(data);
    const topics = cleanTopics(data.topics, name);
    if (!topics.length) throw new Error("No topics came back. Try again.");
    return Response.json({
      url: site.url,
      domain: site.domain,
      name,
      logo: page.icon || logoFor(site.domain),
      profile,
      topics,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Onboarding research failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("onboarding", handle);
