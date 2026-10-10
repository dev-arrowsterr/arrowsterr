import { askClaude, askJson } from "@/lib/claude";
import { cleanProfile, RESEARCH_PROMPT, SITE_PROMPT, SITE_SCHEMA } from "@/lib/onboarding";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { take } from "@/lib/entitlements";
import { TASK_COST } from "@/lib/plans";
import { fetchSitePages, logoFor, normalizeSite } from "@/lib/site";
import { meteredRoute } from "@/lib/meter";

// Onboarding step 1: research the brand and its market. Returns the Brand Card, competitors and category position for the user to check.
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
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY is not set on Render." }, { status: 500 });

  try {
    const page = await fetchSitePages(site.url);
    // Pass 1 searches the web for the category and the closest competitors. Pass 2 writes the review as fixed JSON.
    const { text: notes } = await askClaude(RESEARCH_PROMPT(site.url, page.title, page.desc, page.text || "Not available. Look the company up on the web."), {
      searches: 4,
      maxTokens: 6000,
    });
    const data = await askJson<Record<string, unknown>>(SITE_PROMPT(site.url, notes, page.text), SITE_SCHEMA, { maxTokens: 6000 });
    const name = (typeof data.name === "string" && data.name.trim()) || page.siteName || site.domain;
    return Response.json({ url: site.url, domain: site.domain, name, logo: page.icon || logoFor(site.domain), profile: cleanProfile(data) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Reading the website failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("onboarding", handle);
