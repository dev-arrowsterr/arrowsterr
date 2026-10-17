import { DEFAULT_DOC, TEMPLATES } from "@/lib/reportDoc";
import { DEFAULT_RANGE, parseRange } from "@/lib/reportRange";
import { migrationHint, REPORT_COLS, reportContext, userIdOf, type ReportRow } from "@/lib/reportServer";
import { adminClient, requireRole } from "@/lib/serverAuth";

// Make a saved report from a template, or copy one. Editors only, within the plan's report limit (docs/reports.md, section 4).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, { status: 500 });
  const workspaceId = body.workspaceId as string;

  // Copying: read the original as the caller, so they can only copy what they can see.
  let from: ReportRow | null = null;
  if (body.fromId) {
    const { data, error } = await auth.sb.from("reports").select(REPORT_COLS).eq("id", body.fromId).eq("workspace_id", workspaceId).maybeSingle();
    if (error) return Response.json({ error: migrationHint(error.message) }, { status: 500 });
    if (!data) return Response.json({ error: "That report is gone." }, { status: 404 });
    from = data as ReportRow;
  }
  const template = from ? null : TEMPLATES.find((t) => t.id === body.template);
  if (!from && !template) return Response.json({ error: "Pick a template." }, { status: 400 });

  const brandId = from?.brand_id ?? (typeof body.brandId === "string" ? body.brandId : "");
  const { data: brand } = await auth.sb.from("brands").select("id, name").eq("id", brandId).eq("workspace_id", workspaceId).maybeSingle();
  if (!brand) return Response.json({ error: "Pick a brand." }, { status: 400 });

  const { limits } = await reportContext(auth.sb, workspaceId);
  const { count, error: countError } = await db.from("reports").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).is("archived_at", null);
  if (countError) return Response.json({ error: migrationHint(countError.message) }, { status: 500 });
  if ((count ?? 0) >= limits.saved) {
    return Response.json({ error: `Your plan keeps ${limits.saved} report${limits.saved === 1 ? "" : "s"}. Archive one or upgrade to make more.`, limit: true }, { status: 403 });
  }

  const name = String(body.name ?? "").trim().slice(0, 120) || (from ? `${from.name} (copy)`.slice(0, 120) : `${template!.name} · ${(brand as { name: string }).name}`.slice(0, 120));
  const userId = await userIdOf(auth.sb, request);
  const { data: row, error } = await db
    .from("reports")
    .insert({
      workspace_id: workspaceId,
      brand_id: brandId,
      kind: from?.kind ?? template!.kind,
      name,
      doc: from ? from.doc : (template!.doc ?? DEFAULT_DOC),
      range: from ? parseRange(from.range) : template!.range ? parseRange(template!.range) : DEFAULT_RANGE,
      created_by: userId,
      updated_by: userId,
    })
    .select(REPORT_COLS)
    .single();
  if (error) return Response.json({ error: migrationHint(error.message) }, { status: 500 });
  return Response.json({ report: row });
}
