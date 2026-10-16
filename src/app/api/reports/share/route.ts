import { guardWhiteLabel } from "@/lib/reportLinks";
import { reportContext, userIdOf } from "@/lib/reportServer";
import { adminClient, requireRole } from "@/lib/serverAuth";

// Freeze a page (Prompts, Competitors) and return a private link anyone can open. Editors only.
// Frozen links are on every plan. Before supabase/043_reports.sql they go to the older shared_reports table.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  if (!body.data || typeof body.data !== "object" || JSON.stringify(body.data).length > 3_000_000) return Response.json({ error: "Nothing to share." }, { status: 400 });
  const data = guardWhiteLabel(body.data as object, (await reportContext(auth.sb, body.workspaceId)).limits.whiteLabel);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "app.arrowsterr.com";
  const db = adminClient();
  if (db) {
    const { data: brand } = await auth.sb.from("brands").select("id").eq("id", body.brandId ?? "").eq("workspace_id", body.workspaceId).maybeSingle();
    const { data: link, error } = await db
      .from("report_links")
      .insert({ workspace_id: body.workspaceId, brand_id: brand?.id ?? null, mode: "frozen", snapshot: data, created_by: await userIdOf(auth.sb, request) })
      .select("token")
      .single();
    if (!error) return Response.json({ url: `https://${host}/r/${link.token}` });
    if (!/report_links/.test(error.message)) return Response.json({ error: error.message }, { status: 500 });
  }
  const { data: row, error } = await auth.sb
    .from("shared_reports")
    .insert({ workspace_id: body.workspaceId, brand_id: body.brandId ?? null, data })
    .select("token")
    .single();
  if (error) return Response.json({ error: error.message + (/shared_reports/.test(error.message) ? " Run supabase/011_shared_reports.sql in Supabase." : "") }, { status: 500 });
  return Response.json({ url: `https://${host}/r/${row.token}` });
}
