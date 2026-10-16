import { aiContext } from "@/lib/aiSettings";
import { askClaude } from "@/lib/claude";
import { requireTrack, take } from "@/lib/entitlements";
import { meteredRoute } from "@/lib/meter";
import { TASK_COST } from "@/lib/plans";
import { requireRole } from "@/lib/serverAuth";
import { SOURCES, type SocialSource } from "@/lib/social";
import { BUILTIN_SKILLS } from "@/lib/zippieSkills";

// A reply to one post found by social listening, written with Zippie's community-replies rules.
// The person posts it. Nothing is posted for them.

const RULES = BUILTIN_SKILLS.find((s) => s.key === "community-replies")!.instructions;

const PROMPT = (o: { you: string; domain: string; about: string; notes: string; source: string; name: string; isYou: boolean; title: string; text: string; url: string }) => `You write a reply for someone who works at ${o.you} (${o.domain}).${o.about ? `\n${o.about}` : ""}
${o.notes}

The post is on ${o.source}. It is about ${o.isYou ? `${o.you}, the writer's own brand` : `${o.name}, a competitor of ${o.you}`}.
Title: ${o.title}
Text: ${o.text || "(only the title is known)"}
Link: ${o.url}

Rules:
${RULES}
- Write plain words at about a 9th grade level. No em dashes. No hashtags or emoji.
- Keep it under 120 words unless the post needs more.
- If the post is a complaint about ${o.you}, own it and offer a concrete next step.
- If it is about a competitor, help first. Bring up ${o.you} only if it truly fits, and say the writer works there.

Return only the reply text.`;

async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = Number(body.mentionId);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Bad request" }, { status: 400 });
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const locked = await requireTrack(body.workspaceId, "visibility");
  if (locked) return locked;

  const { data: m } = await auth.sb.from("mentions").select("brand_id, name, is_you, source, url, title, snippet").eq("id", id).eq("workspace_id", body.workspaceId).maybeSingle();
  if (!m) return Response.json({ error: "Post not found." }, { status: 404 });
  const { data: brand } = await auth.sb.from("brands").select("name, domain, profile").eq("id", m.brand_id).maybeSingle();
  if (!brand) return Response.json({ error: "Brand not found." }, { status: 404 });

  const took = await take(body.workspaceId, "tasks", TASK_COST.ai);
  if (!took.ok) return took.response;

  try {
    const card = (brand.profile as { card?: { who?: string[]; howTo?: string[] } } | null)?.card;
    const about = card ? [card.who?.length ? `Who it serves: ${card.who.join("; ")}` : "", card.howTo?.length ? `What it does: ${card.howTo.join("; ")}` : ""].filter(Boolean).join("\n") : "";
    const { text } = await askClaude(
      PROMPT({ you: brand.name, domain: brand.domain, about, notes: await aiContext(auth.sb, body.workspaceId), source: SOURCES[m.source as SocialSource]?.label ?? m.source, name: m.name, isYou: m.is_you, title: m.title, text: m.snippet, url: m.url }),
      { maxTokens: 1200 },
    );
    const reply = text.trim();
    if (!reply) throw new Error("The draft came back empty. Try again.");
    return Response.json({ text: reply });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Reply draft failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("social reply", handle);
