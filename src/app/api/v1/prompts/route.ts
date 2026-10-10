import { apiAuth } from "@/lib/integrations";

// A brand's tracked prompts, by topic.  ?brand_id=…
export async function GET(request: Request) {
  const a = await apiAuth(request);
  if ("denied" in a) return a.denied;
  const brandId = new URL(request.url).searchParams.get("brand_id") ?? "";
  const { data } = await a.db.from("brands").select("id, name, prompts, topics").eq("id", brandId).eq("workspace_id", a.ws).maybeSingle();
  if (!data) return Response.json({ error: "Brand not found. Get its id from /api/v1/brands." }, { status: 404 });
  return Response.json({ brand: { id: data.id, name: data.name }, prompts: data.prompts ?? [], topics: data.topics ?? [] });
}
