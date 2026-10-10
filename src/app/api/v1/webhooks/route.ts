import { apiAuth } from "@/lib/integrations";
import { EVENTS } from "@/lib/integrationTypes";

// Webhook subscriptions (Zapier REST hooks). POST { url, event } to subscribe; DELETE /api/v1/webhooks/{id} to stop.
export async function GET(request: Request) {
  const a = await apiAuth(request);
  if ("denied" in a) return a.denied;
  const { data } = await a.db.from("webhooks").select("id, url, event, source, created_at").eq("workspace_id", a.ws);
  return Response.json({ webhooks: data ?? [], events: EVENTS });
}

export async function POST(request: Request) {
  const a = await apiAuth(request);
  if ("denied" in a) return a.denied;
  const body = await request.json().catch(() => ({}));
  const url = String(body.url ?? body.target_url ?? "").trim();
  const event = String(body.event ?? "*");
  if (!/^https:\/\/\S+$/.test(url)) return Response.json({ error: "Send an https url." }, { status: 400 });
  if (event !== "*" && !(event in EVENTS)) return Response.json({ error: `Unknown event. Use one of: ${Object.keys(EVENTS).join(", ")}.` }, { status: 400 });
  const { count } = await a.db.from("webhooks").select("id", { count: "exact", head: true }).eq("workspace_id", a.ws);
  if ((count ?? 0) >= 50) return Response.json({ error: "A workspace can have up to 50 webhooks." }, { status: 400 });
  const source = /zapier\.com/.test(url) ? "zapier" : "api";
  const { data, error } = await a.db.from("webhooks").insert({ workspace_id: a.ws, url, event, source }).select("id, url, event, created_at").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { status: 201 });
}
