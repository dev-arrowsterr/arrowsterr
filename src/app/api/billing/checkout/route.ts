import { getSubscription, syncSubscription } from "@/lib/billing";
import { lookupKey, SELF_SERVE, type Interval, type PlanId } from "@/lib/plans";
import { adminClient, requireRole } from "@/lib/serverAuth";
import { originOf, priceFor, stripe, stripeReady, type Subscription } from "@/lib/stripe";

// Pick or change a plan. With no subscription yet, this opens Stripe Checkout.
// With one, it switches the plan at once and charges or credits the difference.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "admin");
  if ("denied" in auth) return auth.denied;
  if (!stripeReady()) return Response.json({ error: "STRIPE_SECRET_KEY is not set on Render." }, { status: 500 });
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY on Render." }, { status: 500 });
  const plan = body.plan as PlanId;
  const interval: Interval = body.interval === "year" ? "year" : "month";
  if (!SELF_SERVE.includes(plan)) return Response.json({ error: "Pick Foundation, Scale, Thrive or Agency." }, { status: 400 });

  const { data: ws, error } = await db.from("workspaces").select("id, name, plan_status, stripe_customer_id, stripe_subscription_id").eq("id", body.workspaceId).maybeSingle();
  if (error || !ws) return Response.json({ error: error?.message.includes("stripe") ? "Run supabase/015_billing.sql in Supabase." : error?.message ?? "Workspace not found." }, { status: 500 });

  try {
    const price = await priceFor(lookupKey(plan, interval));
    const origin = originOf(request);

    // Already paying: swap the price on the live subscription.
    if (ws.stripe_subscription_id) {
      const sub = await getSubscription(ws.stripe_subscription_id).catch(() => null);
      if (sub && !["canceled", "incomplete_expired"].includes(sub.status)) {
        const item = sub.items.data[0];
        const updated = await stripe<Subscription>("POST", `subscriptions/${sub.id}`, {
          items: [{ id: item.id, price: price.id }],
          proration_behavior: "always_invoice",
          cancel_at_period_end: false,
          metadata: { workspace_id: ws.id },
        });
        await syncSubscription(updated);
        return Response.json({ changed: true, plan });
      }
    }

    let customer = ws.stripe_customer_id as string | null;
    if (!customer) {
      const { data: user } = await auth.sb.auth.getUser();
      const made = await stripe<{ id: string }>("POST", "customers", { email: user.user?.email, name: ws.name, metadata: { workspace_id: ws.id } }, `customer-${ws.id}`);
      customer = made.id;
      await db.from("workspaces").update({ stripe_customer_id: customer }).eq("id", ws.id);
    }
    const session = await stripe<{ url: string }>("POST", "checkout/sessions", {
      mode: "subscription",
      customer,
      client_reference_id: ws.id,
      line_items: [{ price: price.id, quantity: 1 }],
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      customer_update: { address: "auto", name: "auto" },
      tax_id_collection: { enabled: true },
      subscription_data: { metadata: { workspace_id: ws.id } },
      metadata: { workspace_id: ws.id },
      success_url: `${origin}/billing?checkout=done`,
      cancel_url: `${origin}/billing`,
    });
    return Response.json({ url: session.url });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
