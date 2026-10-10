import { apiAuth } from "@/lib/integrations";

// Who the API key belongs to. Zapier calls this to test a connection.
export async function GET(request: Request) {
  const a = await apiAuth(request);
  if ("denied" in a) return a.denied;
  const { data } = await a.db.from("workspaces").select("id, name, plan").eq("id", a.ws).maybeSingle();
  return Response.json({ workspace: data });
}
