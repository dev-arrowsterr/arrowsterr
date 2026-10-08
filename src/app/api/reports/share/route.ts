import { requireRole } from "@/lib/serverAuth";

// Freeze a client report and return a private link anyone can open. Editors only.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const data = body.data;
  if (!data || typeof data !== "object" || JSON.stringify(data).length > 1_000_000) return Response.json({ error: "Nothing to share." }, { status: 400 });
  const { data: row, error } = await auth.sb
    .from("shared_reports")
    .insert({ workspace_id: body.workspaceId, brand_id: body.brandId ?? null, data })
    .select("token")
    .single();
  if (error) return Response.json({ error: error.message + (/shared_reports/.test(error.message) ? " Run supabase/011_shared_reports.sql in Supabase." : "") }, { status: 500 });
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "app.arrowsterr.com";
  return Response.json({ url: `https://${host}/r/${row.token}` });
}
