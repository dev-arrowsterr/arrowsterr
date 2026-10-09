import { askClaude, parseJson } from "@/lib/claude";
import { cleanList, cleanProfile, MAX_TOPICS, TOPICS_PROMPT } from "@/lib/onboarding";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { meteredRoute } from "@/lib/meter";

// Onboarding step 2: suggest bottom-of-funnel topics from the business answers.
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  const domain = typeof body.domain === "string" ? body.domain.trim().slice(0, 200) : "";
  if (!name || !domain) return Response.json({ error: "Add your brand name and website first." }, { status: 400 });
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;

  try {
    const { text } = await askClaude(TOPICS_PROMPT(name, domain, cleanProfile(body.profile)), { maxTokens: 1000 });
    const topics = cleanList(parseJson(text).topics, MAX_TOPICS);
    if (!topics.length) throw new Error("Claude returned no topics.");
    return Response.json({ topics });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Topics failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("onboarding", handle);
