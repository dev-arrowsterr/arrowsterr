import { askJson } from "@/lib/claude";
import { cleanList, cleanPrompts, cleanProfile, MAX_TOPICS, PROMPTS_PROMPT, PROMPTS_SCHEMA } from "@/lib/onboarding";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { take } from "@/lib/entitlements";
import { TASK_COST } from "@/lib/plans";
import { meteredRoute } from "@/lib/meter";

// Onboarding step 3: write 10 prompts per topic, each from a different angle, best fit first.
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  const domain = typeof body.domain === "string" ? body.domain.trim().slice(0, 200) : "";
  const topics = cleanList(body.topics, MAX_TOPICS);
  if (!name || !domain || !topics.length) return Response.json({ error: "Pick at least one topic first." }, { status: 400 });
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const took = await take(body.workspaceId, "tasks", TASK_COST.ai);
  if (!took.ok) return took.response;
  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;

  try {
    const out = await askJson<{ topics: { topic: string; prompts: { text: string; angle: string }[] }[] }>(PROMPTS_PROMPT(name, domain, cleanProfile(body.profile), topics), PROMPTS_SCHEMA, {
      maxTokens: 8000,
      model: process.env.PROMPTS_MODEL || "claude-haiku-5-5",
    });
    const byName = new Map((out.topics ?? []).map((t) => [t.topic.trim().toLowerCase(), t.prompts ?? []]));
    // Keep the user's topic order and wording. One shared list catches near duplicates across topics.
    const seen: Set<string>[] = [];
    const result = topics.map((topic, i) => ({ name: topic, prompts: cleanPrompts(byName.get(topic.toLowerCase()) ?? out.topics?.[i]?.prompts ?? [], topic, seen, name) }));
    return Response.json({ topics: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Prompts failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("onboarding", handle);
