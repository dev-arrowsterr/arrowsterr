import { parseDoc } from "@/lib/reportDoc";
import { parseRange } from "@/lib/reportRange";
import { buildSaved, migrationHint, REPORT_COLS, type ReportRow } from "@/lib/reportServer";
import { requireRole } from "@/lib/serverAuth";

// A saved client report's numbers for its dates (docs/reports.md, sections 9 and 23). Members only.
// The editor may send its unsaved blocks and dates, so the preview updates before the save lands.
export const maxDuration = 120;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "viewer");
  if ("denied" in auth) return auth.denied;
  const { data, error } = await auth.sb.from("reports").select(REPORT_COLS).eq("id", body.reportId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (error) return Response.json({ error: migrationHint(error.message) }, { status: 500 });
  if (!data) return Response.json({ error: "That report is gone." }, { status: 404 });
  const row = data as ReportRow;
  if (row.kind !== "client") return Response.json({ error: "This report is built in the browser." }, { status: 400 });
  try {
    const built = await buildSaved(auth.sb, row, { doc: body.doc ? parseDoc(body.doc) : undefined, range: body.range ? parseRange(body.range) : undefined });
    return Response.json(built);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Report data failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
