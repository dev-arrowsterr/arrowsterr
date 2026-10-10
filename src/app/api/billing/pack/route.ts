import { TASK_PACKS } from "@/lib/plans";
import { adminClient, requireRole } from "@/lib/serverAuth";
import { originOf, stripe, stripeReady } from "@/lib/stripe";

// Buy a task pack with a one-time Stripe Checkout payment. The webhook adds the tasks once it is paid.
//   { pack: "t1k" | "t5k" | "t20k" }
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "admin");
  if ("denied" in auth) return auth.denied;
  if (!stripeReady()) return Response.json({ error: "STRIPE_SECRET_KEY is not set on Render." }, { status: 500 });
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY on Render." }, { status: 500 });
  const pack = TASK_PACKS.find((p) => p.id === body.pack);
  if (!pack) return Response.json({ error: "Pick a task pack." }, { status: 400 });

  const { data: ws, error } = await db.from("workspaces").select("id, name, stripe_customer_id").eq("id", body.workspaceId).maybeSingle();
  if (error || !ws) return Response.json({ error: error?.message ?? "Workspace not found." }, { status: 500 });
  try {
    let customer = ws.stripe_customer_id as string | null;
    if (!customer) {
      const { data: user } = await auth.sb.auth.getUser();
      const made = await stripe<{ id: string }>("POST", "customers", { email: user.user?.email, name: ws.name, metadata: { workspace_id: ws.id } }, `customer-${ws.id}`);
      customer = made.id;
      await db.from("workspaces").update({ stripe_customer_id: customer }).eq("id", ws.id);
    }
    const origin = originOf(request);
    const meta = { workspace_id: ws.id, kind: "task_pack", pack: pack.id, tasks: String(pack.tasks) };
    const session = await stripe<{ url: string }>("POST", "checkout/sessions", {
      mode: "payment",
      customer,
      client_reference_id: ws.id,
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: pack.price * 100, tax_behavior: "exclusive", product_data: { name: `Arrowsterr ${pack.tasks.toLocaleString("en-US")} tasks`, description: "Task pack. Never expires." } } }],
      invoice_creation: { enabled: true },
      billing_address_collection: "auto",
      customer_update: { address: "auto", name: "auto" },
      metadata: meta,
      payment_intent_data: { metadata: meta },
      success_url: `${origin}/billing?pack=done`,
      cancel_url: `${origin}/billing`,
    });
    return Response.json({ url: session.url });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
