import type { Brief } from "@/lib/briefTypes";
import { askClaude } from "@/lib/claude";
import { guidelineText } from "@/lib/guideline";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import type { BrandGuideline, ChatMessage } from "@/lib/writerTypes";
import { meteredRoute } from "@/lib/meter";
import { requirePaid, take } from "@/lib/entitlements";
import { TASK_COST } from "@/lib/plans";

// The writing assistant. It knows the brand guideline, the content brief and the draft, and helps the
// writer: ideas, edits in the brand's voice, checks, and on-brand HTML and CSS. One AI answer per message.
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const paid = await requirePaid(body.workspaceId);
  if (paid) return paid;
  const took = await take(body.workspaceId, "tasks", TASK_COST.agent);
  if (!took.ok) return took.response;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY is not set on Render." }, { status: 500 });
  const message = String(body.message ?? "").trim().slice(0, 4000);
  if (!message) return Response.json({ error: "Type a message." }, { status: 400 });

  const { data: site } = await auth.sb.from("sites").select("name, domain, guideline").eq("id", body.siteId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (!site) return Response.json({ error: "Website not found." }, { status: 404 });
  let brief: Brief | null = null;
  let keyword = "";
  if (body.docId) {
    const { data: doc } = await auth.sb.from("docs").select("calendar_item_id").eq("id", body.docId).maybeSingle();
    if (doc?.calendar_item_id) {
      const { data: item } = await auth.sb.from("calendar_items").select("keyword, brief").eq("id", doc.calendar_item_id).maybeSingle();
      brief = (item?.brief as Brief | null) ?? null;
      keyword = item?.keyword ?? "";
    }
  }
  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;

  const history = (Array.isArray(body.history) ? (body.history as ChatMessage[]) : []).slice(-8);
  const prompt = `You are the writing and web assistant inside Arrowsterr for ${site.name} (${site.domain}). A human writer owns the article. You help them: ideas, outlines, edits of their text in the brand's voice, checks against the brief and the brand, and on-brand HTML and CSS when they ask for code.

Follow the brand guideline closely:
${guidelineText(site.guideline as BrandGuideline | null)}

${
  brief
    ? `Content brief for this page (target keyword "${keyword}"):
Intent: ${brief.analysis.intent}
Format: ${brief.analysis.format}. Length: ${brief.brief.wordCount} words.
Must cover: ${brief.analysis.mustCover.join("; ")}
Questions: ${brief.brief.questions.join("; ")}
Make it yours: ${brief.brief.makeItYours.join("; ")}`
    : "No content brief is linked to this draft."
}

The writer's draft so far (may be cut short):
${String(body.docText ?? "").slice(0, 12000) || "(empty)"}

${body.selection ? `The writer selected this text:\n"""${String(body.selection).slice(0, 3000)}"""\n` : ""}
Conversation so far:
${history.map((m) => `${m.role === "user" ? "Writer" : "You"}: ${m.text.slice(0, 2000)}`).join("\n\n") || "(none)"}

Writer: ${message}

How to answer:
- Short and useful. Use Markdown: short paragraphs, "- " lists, "## " headings.
- When you rewrite or suggest text, give text that is ready to paste, in the brand's voice.
- When asked for code, give one self-contained \`\`\`html block with a <style> tag that uses the brand's colors, fonts and CSS variables. No JavaScript unless asked.
- Never invent facts, numbers, customers or quotes. Use [brackets] for anything the writer must fill in.`;

  try {
    const { text } = await askClaude(prompt, { maxTokens: 4000 });
    return Response.json({ reply: text.trim() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Writer assistant failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export const POST = meteredRoute("writer", handle);
