import { adminClient, requireRole } from "@/lib/serverAuth";
import { originOf, stripe, stripeReady } from "@/lib/stripe";

// Stripe's billing portal: card, invoices, tax details and canceling.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "admin");
  if ("denied" in auth) return auth.denied;
  if (!stripeReady()) return Response.json({ error: "STRIPE_SECRET_KEY is not set on Render." }, { status: 500 });
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY on Render." }, { status: 500 });
  const { data: ws } = await db.from("workspaces").select("stripe_customer_id").eq("id", body.workspaceId).maybeSingle();
  if (!ws?.stripe_customer_id) return Response.json({ error: "Pick a plan first." }, { status: 400 });
  try {
    const session = await stripe<{ url: string }>("POST", "billing_portal/sessions", { customer: ws.stripe_customer_id, return_url: `${originOf(request)}/billing` });
    return Response.json({ url: session.url });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
