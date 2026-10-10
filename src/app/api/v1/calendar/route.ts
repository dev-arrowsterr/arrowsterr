import { apiAuth } from "@/lib/integrations";

// A brand's Editorial Calendar.  ?brand_id=…
export async function GET(request: Request) {
  const a = await apiAuth(request);
  if ("denied" in a) return a.denied;
  const brandId = new URL(request.url).searchParams.get("brand_id") ?? "";
  const { data: site } = await a.db.from("sites").select("id").eq("brand_id", brandId).eq("workspace_id", a.ws).maybeSingle();
  if (!site) return Response.json({ error: "No Editorial Calendar for this brand yet." }, { status: 404 });
  const { data, error } = await a.db
    .from("calendar_items")
    .select("id, keyword, stage, volume, difficulty, status, due_date, owner, url, action, brief_status")
    .eq("site_id", site.id)
    .order("due_date", { nullsFirst: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ items: data });
}
