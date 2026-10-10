import { askJson } from "@/lib/claude";
import { CANDIDATE_TOPICS, cleanProfile, pickTopics, TOPICS_PROMPT, TOPICS_SCHEMA, type Candidate } from "@/lib/onboarding";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { take } from "@/lib/entitlements";
import { TASK_COST } from "@/lib/plans";
import { meteredRoute } from "@/lib/meter";
import { bulkReport } from "@/lib/kwReport";
import { askEngine, availableEngines, type Engine } from "@/lib/engines";
import { extractBrands } from "@/lib/extract";

/** Ask one AI engine each topic and list the brands it names, so the user sees who owns each topic today. */
async function whoIsNamed(name: string, domain: string, topics: string[]) {
  const ready = availableEngines();
  const engine = (["ChatGPT", "AI Mode", "Gemini", "Claude"] as Engine[]).find((e) => ready.includes(e));
  if (!engine) return { engine: null, named: topics.map(() => [] as { name: string; domain: string; you: boolean }[]) };
  const named = await Promise.all(
    topics.map(async (t) => {
      try {
        const answer = await Promise.race([askEngine(engine, t), new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), 60_000))]);
        const brands = await extractBrands(name, domain, answer.text);
        return brands.slice(0, 6).map((b) => ({ name: b.name, domain: b.domain ?? "", you: b.name === name }));
      } catch {
        return [];
      }
    }),
  );
  return { engine, named };
}

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
    const out = await askJson<{ topics: { topic: string; group: string; relevance: number; buyer: string; reason: string }[] }>(TOPICS_PROMPT(name, domain, profile), TOPICS_SCHEMA, { maxTokens: 8000 });
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
    const { engine, named } = await whoIsNamed(name, domain, picked.map((t) => t.topic));
    return Response.json({ topics: picked.map((t, i) => ({ ...t, named: named[i] })), candidates: all.length, engine });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Topics failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("onboarding", handle);
