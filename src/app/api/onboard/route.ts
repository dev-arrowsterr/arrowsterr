import { askClaude, parseJson } from "@/lib/claude";
import { cleanProfile, SITE_PROMPT } from "@/lib/onboarding";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { fetchSite, logoFor, normalizeSite } from "@/lib/site";

// Onboarding step 1: read the website and fill in the business questions for the user to check.
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
    const { text: reply } = await askClaude(SITE_PROMPT(site.url, page.title, page.desc, page.text || "Not available"), {
      searches: page.text ? 0 : 3,
      maxTokens: 2000,
    });
    let data: Record<string, unknown>;
    try {
      data = parseJson(reply);
    } catch {
      throw new Error(`Claude did not return JSON. It said: ${reply.slice(0, 200)}`);
    }
    const name = (typeof data.name === "string" && data.name.trim()) || page.siteName || site.domain;
    return Response.json({ url: site.url, domain: site.domain, name, logo: logoFor(site.domain), profile: cleanProfile(data) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Reading the website failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
