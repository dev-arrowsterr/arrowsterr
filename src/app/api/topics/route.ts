import { askJson } from "@/lib/claude";
import { CANDIDATE_TOPICS, cleanProfile, pickTopics, TOPICS_PROMPT, TOPICS_SCHEMA, type Candidate, type TopicRole } from "@/lib/onboarding";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { take } from "@/lib/entitlements";
import { TASK_COST } from "@/lib/plans";
import { meteredRoute } from "@/lib/meter";
import { bulkReport } from "@/lib/kwReport";

// Onboarding step 2: write 50 candidate topics, get Google volume for all of them, and pick the best 5.
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  const domain = typeof body.domain === "string" ? body.domain.trim().slice(0, 200) : "";
  if (!name || !domain) return Response.json({ error: "Add your brand name and website first." }, { status: 400 });
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const took = await take(body.workspaceId, "tasks", TASK_COST.ai);
  if (!took.ok) return took.response;
  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;

  try {
    const profile = cleanProfile(body.profile);
    const out = await askJson<{ topics: { topic: string; role: TopicRole; relevance: number; buyer: string; reason: string }[] }>(TOPICS_PROMPT(name, domain, profile), TOPICS_SCHEMA, { maxTokens: 8000 });
    const seen = new Set<string>();
    const cands = (out.topics ?? [])
      .map((t) => ({ ...t, topic: t.topic.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80) }))
      .filter((t) => t.topic && t.topic.split(" ").length <= 6 && !seen.has(t.topic) && seen.add(t.topic))
      .slice(0, CANDIDATE_TOPICS);
    if (!cands.length) throw new Error("No topics came back. Try again.");
    const { rows } = await bulkReport(cands.map((c) => c.topic), profile.country === "Global" ? "United States" : (profile.country ?? "United States"));
    const vol = new Map(rows.map((r) => [r.keyword, r.volume]));
    const all: Candidate[] = cands.map((c) => ({ ...c, relevance: Math.min(5, Math.max(1, Math.round(c.relevance))), volume: vol.get(c.topic) ?? null }));
    const picked = pickTopics(all);
    if (!picked.length) throw new Error("None of the topics have search volume. Check the brand details and try again.");
    return Response.json({ topics: picked, candidates: all.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Topics failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("onboarding", handle);
