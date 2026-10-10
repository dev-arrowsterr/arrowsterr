import { apiAuth } from "@/lib/integrations";

// Stop a webhook subscription.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await apiAuth(request);
  if ("denied" in a) return a.denied;
  const { id } = await params;
  await a.db.from("webhooks").delete().eq("id", id).eq("workspace_id", a.ws);
  return Response.json({ ok: true });
}
