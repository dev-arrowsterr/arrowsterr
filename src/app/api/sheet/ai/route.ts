import { askClaude, parseJson } from "@/lib/claude";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { cleanOps, type SheetKind } from "@/lib/sheetAi";
import { meteredRoute } from "@/lib/meter";
import { take } from "@/lib/entitlements";

// Turn a plain request, like "schedule the BOFU pages 2 a week", into changes to the Planner or the Calendar.
// Nothing changes here. The page shows the changes and applies them when the user clicks Apply. One AI answer.
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const took = await take(body.workspaceId, "ai");
  if (!took.ok) return took.response;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY is not set on Render." }, { status: 500 });
  const kind: SheetKind = body.kind === "plan" ? "plan" : "calendar";
  const instruction = String(body.instruction ?? "").trim().slice(0, 1000);
  if (!instruction) return Response.json({ error: "Type what you want done." }, { status: 400 });
  const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 400) as Record<string, unknown>[];
  const custom = (Array.isArray(body.columns) ? body.columns : []).filter((c: unknown): c is { id: string; name: string } => typeof (c as { id?: unknown })?.id === "string").slice(0, 20);
  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;

  const ops =
    kind === "plan"
      ? `- {"op":"select","ids":[...]} ticks rows so the user can review them.
- {"op":"approve","ids":[...]} adds rows to the content calendar.`
      : `- {"op":"update","ids":[...],"set":{...}} changes rows. Fields: status ("planned", "brief", "writing", "published"), due_date ("YYYY-MM-DD" or null), owner, stage ("bofu", "mofu", "tofu"), theme, notes, keyword${custom.length ? `, and these custom columns by id: ${custom.map((c: { id: string; name: string }) => `${c.id} (${String(c.name).slice(0, 40)})`).join(", ")}` : ""}. Use one update per row when rows get different values, like dates.
- {"op":"delete","ids":[...]} removes rows.
- {"op":"add","keywords":["..."]} adds new keywords.
- {"op":"select","ids":[...]} ticks rows so the user can review them.`;

  try {
    const { text } = await askClaude(
      `You help someone edit their ${kind === "plan" ? "keyword plan (rows are pages they could write or update)" : "content calendar (rows are pages they plan to write or update)"} for ${String(body.domain ?? "their site").slice(0, 100)}. Today is ${String(body.today ?? new Date().toISOString().slice(0, 10)).slice(0, 10)}.

Rows as JSON (id is the row id; stage: bofu = ready to buy, mofu = comparing, tofu = learning; kd is keyword difficulty 0 to 100; due is the due date):
${JSON.stringify(rows).slice(0, 60000)}

The request:
"""${instruction}"""

Changes you can make:
${ops}

Rules:
- Do exactly what was asked, on the rows that fit. Use only ids from the rows above.
- Weekdays only for dates unless asked otherwise.
- If the request is unclear or asks for something you cannot do, make no changes and say why in the reply.
- reply: one or two plain sentences on what you did, a 9th grader could read it.

Return JSON only: {"reply": "...", "ops": [...]}`,
      { maxTokens: 8000 },
    );
    const out = parseJson(text) as { reply?: string; ops?: unknown };
    const ids = new Set(rows.map((r) => String(r.id)));
    return Response.json({ reply: String(out.reply ?? ""), ops: cleanOps(out.ops, kind, ids, custom.map((c: { id: string }) => c.id)) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Sheet AI failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("sheet AI", handle);
