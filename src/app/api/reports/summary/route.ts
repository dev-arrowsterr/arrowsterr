import { askClaude, parseJson } from "@/lib/claude";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { meteredRoute } from "@/lib/meter";
import { take } from "@/lib/entitlements";
import { TASK_COST } from "@/lib/plans";
import { summaryInput } from "@/lib/reportBuild";
import { parseDoc } from "@/lib/reportDoc";
import { buildSaved, migrationHint, REPORT_COLS, type ReportRow } from "@/lib/reportServer";

// A short executive summary of the period, written from the numbers on the client report. One AI answer.
// With reportId, the numbers are built here for the report's dates and the summary is saved on the report
// with those dates, so it only ever shows next to the numbers it was written from.
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  let row: ReportRow | null = null;
  let key = "";
  let period = "";
  if (body.reportId) {
    const { data, error } = await auth.sb.from("reports").select(REPORT_COLS).eq("id", body.reportId).eq("workspace_id", body.workspaceId).maybeSingle();
    if (error) return Response.json({ error: migrationHint(error.message) }, { status: 500 });
    if (!data) return Response.json({ error: "That report is gone." }, { status: 404 });
    row = data as ReportRow;
    try {
      const built = await buildSaved(auth.sb, row);
      if (!built.snapshot.ai) return Response.json({ error: "There are no AI answers in these dates to write about yet." }, { status: 400 });
      body.data = summaryInput(built.snapshot);
      body.brand = built.snapshot.brand.name;
      body.domain = built.snapshot.brand.domain;
      key = built.range.key;
      period = built.range.compareLabel ? `${built.range.label}, compared with ${built.range.compareLabel}` : built.range.label;
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }
  const took = await take(body.workspaceId, "tasks", TASK_COST.ai);
  if (!took.ok) return took.response;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });
  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;
  const data = JSON.stringify(body.data ?? {}).slice(0, 12000);
  try {
    const { text } = await askClaude(
      `You write the executive summary at the top of a monthly marketing report for ${String(body.brand ?? "the brand").slice(0, 100)} (${String(body.domain ?? "").slice(0, 100)}). The reader is a busy business owner.

Numbers for ${period || `the last ${Number(body.days) || 30} days, compared with the ${Number(body.days) || 30} days before`} (null means not connected or no comparison):
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
    const clean = (x: unknown) => (Array.isArray(x) ? x.filter((p): p is string => typeof p === "string").slice(0, 6) : []);
    const summary = { headline: String(out.headline ?? ""), points: clean(out.points), next: clean(out.next), at: new Date().toISOString() };
    if (row) {
      const doc = { ...parseDoc(row.doc), summary: { ...summary, key } };
      const { error } = await auth.sb.from("reports").update({ doc, updated_at: new Date().toISOString() }).eq("id", row.id);
      if (error) return Response.json({ error: migrationHint(error.message) }, { status: 500 });
      return Response.json({ ...summary, key });
    }
    return Response.json(summary);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Report summary failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("report summary", handle);
