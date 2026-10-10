import { apiAuth } from "@/lib/integrations";

// The workspace's brands.
export async function GET(request: Request) {
  const a = await apiAuth(request);
  if ("denied" in a) return a.denied;
  const { data, error } = await a.db.from("brands").select("id, name, domain, created_at").eq("workspace_id", a.ws).order("created_at");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ brands: data });
}
