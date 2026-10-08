import { askClaude, parseJson } from "@/lib/claude";
import { requireRole, takeAnswer } from "@/lib/serverAuth";

// A short executive summary of the period, written from the numbers on the Summary report. One AI answer.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY is not set on Render." }, { status: 500 });
  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;
  const data = JSON.stringify(body.data ?? {}).slice(0, 12000);
  try {
    const { text } = await askClaude(
      `You write the executive summary at the top of a monthly marketing report for ${String(body.brand ?? "the brand").slice(0, 100)} (${String(body.domain ?? "").slice(0, 100)}). The reader is a busy business owner.

Numbers for the last ${Number(body.days) || 30} days, compared with the ${Number(body.days) || 30} days before (null means not connected):
${data}

Rules:
- Plain words a 9th grader understands. No jargon, no hype.
- Only use the numbers given. Never invent numbers or causes.
- Headline: one sentence on how the period went.
- 3 to 4 short points on what changed and why it matters.
- 3 next steps, each one concrete action.

Return JSON only: {"headline": "...", "points": ["..."], "next": ["..."]}`,
      { maxTokens: 1500 },
    );
    const out = parseJson(text) as { headline?: string; points?: string[]; next?: string[] };
    return Response.json({ headline: out.headline ?? "", points: out.points ?? [], next: out.next ?? [], at: new Date().toISOString() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Report summary failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
