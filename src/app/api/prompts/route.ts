import { askClaude, parseJson } from "@/lib/claude";
import { cleanList, cleanProfile, MAX_TOPICS, PROMPTS_PER_TOPIC, PROMPTS_PROMPT } from "@/lib/onboarding";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { meteredRoute } from "@/lib/meter";

// Onboarding step 3: write the prompts to track for each topic.
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  const domain = typeof body.domain === "string" ? body.domain.trim().slice(0, 200) : "";
  const topics = cleanList(body.topics, MAX_TOPICS);
  if (!name || !domain || !topics.length) return Response.json({ error: "Pick at least one topic first." }, { status: 400 });
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;

  try {
    const { text } = await askClaude(PROMPTS_PROMPT(name, domain, cleanProfile(body.profile), topics), { maxTokens: 4000 });
    const list = parseJson(text).topics;
    const byName = new Map<string, string[]>();
    if (Array.isArray(list)) {
      for (const t of list as { topic?: unknown; prompts?: unknown }[]) {
        if (typeof t?.topic === "string") byName.set(t.topic.trim().toLowerCase(), cleanList(t.prompts, PROMPTS_PER_TOPIC));
      }
    }
    // Keep the user's topic order and wording. A topic Claude skipped still tracks its own name.
    const out = topics.map((topic, i) => {
      const prompts = byName.get(topic.toLowerCase()) ?? (Array.isArray(list) ? cleanList((list[i] as { prompts?: unknown })?.prompts, PROMPTS_PER_TOPIC) : []);
      return { name: topic, prompts: prompts.length ? prompts : [topic] };
    });
    return Response.json({ topics: out });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Prompts failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("onboarding", handle);
