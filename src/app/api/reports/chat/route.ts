import { askJson } from "@/lib/claude";
import { take } from "@/lib/entitlements";
import { meteredRoute } from "@/lib/meter";
import { TASK_COST } from "@/lib/plans";
import { summaryInput } from "@/lib/reportBuild";
import { CHAT_SCHEMA, chatPrompt, cleanChat, type ChatTurn } from "@/lib/reportChat";
import { parseDoc } from "@/lib/reportDoc";
import { parseRange } from "@/lib/reportRange";
import { buildSaved, migrationHint, REPORT_COLS, type ReportRow } from "@/lib/reportServer";
import { cleanTheme } from "@/lib/reportTheme";
import { requireRole, takeAnswer } from "@/lib/serverAuth";

// Zippie in the report editor (docs/reports.md, section 31.4). One message in; a reply and checked changes out.
//   { reportId, message, history: ChatTurn[], doc, range, name, title, theme }
// The numbers Zippie reads are built here from the report's own data, never taken from the browser.
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const message = String(body.message ?? "").trim().slice(0, 2000);
  if (!message) return Response.json({ error: "Type a message." }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { data, error } = await auth.sb.from("reports").select(REPORT_COLS).eq("id", body.reportId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (error) return Response.json({ error: migrationHint(error.message) }, { status: 500 });
  if (!data) return Response.json({ error: "That report is gone." }, { status: 404 });
  const row = data as ReportRow;
  const doc = parseDoc(body.doc ?? row.doc);
  const range = parseRange(body.range ?? row.range);
  const theme = cleanTheme(body.theme);

  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;
  const took = await take(body.workspaceId, "tasks", TASK_COST.ai);
  if (!took.ok) return took.response;

  try {
    const [built, kit] = await Promise.all([
      buildSaved(auth.sb, row, { doc, range }),
      auth.sb.from("brand_kits").select("key").eq("workspace_id", body.workspaceId).eq("key", "workspace").maybeSingle(),
    ]);
    const history: ChatTurn[] = (Array.isArray(body.history) ? body.history : [])
      .filter((t: unknown): t is ChatTurn => Boolean(t) && typeof (t as ChatTurn).text === "string" && ((t as ChatTurn).role === "you" || (t as ChatTurn).role === "zippie"))
      .slice(-8)
      .map((t: ChatTurn) => ({ role: t.role, text: t.text.slice(0, 1200) }));
    const r = built.range;
    const out = await askJson<Record<string, unknown>>(
      chatPrompt({
        brand: built.snapshot.brand.name,
        period: r.compareLabel ? `${r.label}, compared with ${r.compareLabel}` : r.label,
        numbers: built.snapshot.ai ? summaryInput(built.snapshot) : "No AI answers in these dates yet.",
        doc,
        name: String(body.name ?? row.name).slice(0, 120),
        title: String(body.title ?? "").slice(0, 80),
        theme,
        history,
        message,
        brandKit: Boolean(kit.data),
      }),
      CHAT_SCHEMA,
      { maxTokens: 1500 },
    );
    return Response.json(cleanChat(out, theme));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Report chat failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export const POST = meteredRoute("report chat", handle);
