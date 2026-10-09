import { getSubscription, syncSubscription } from "@/lib/billing";
import { adminClient } from "@/lib/serverAuth";
import { readEvent, type Subscription } from "@/lib/stripe";

// Stripe calls this on every billing change. In Stripe → Developers → Webhooks, add
// https://YOUR-APP/api/billing/webhook with the events below, and put its signing secret in STRIPE_WEBHOOK_SECRET.
const EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

export async function POST(request: Request) {
  const raw = await request.text();
  const event = readEvent(raw, request.headers.get("stripe-signature"));
  if (!event) return Response.json({ error: "Bad signature." }, { status: 400 });
  if (!EVENTS.has(event.type)) return Response.json({ ok: true, skipped: event.type });
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY on Render." }, { status: 500 });

  // Each event once. Stripe resends until it gets a 2xx, so a failure below removes the mark.
  const { error: dupe } = await db.from("stripe_events").insert({ id: event.id, type: event.type });
  if (dupe) {
    if (dupe.code === "23505") return Response.json({ ok: true, duplicate: true });
    if (!/stripe_events/.test(dupe.message)) return Response.json({ error: dupe.message }, { status: 500 });
  }

  try {
    const o = event.data.object;
    let subId: string | null = null;
    if (event.type === "checkout.session.completed") {
      subId = (o.subscription as string | null) ?? null;
      const ws = (o.client_reference_id as string | null) ?? null;
      if (ws && o.customer) await db.from("workspaces").update({ stripe_customer_id: o.customer }).eq("id", ws);
    } else if (event.type.startsWith("invoice.")) {
      const parent = o.parent as { subscription_details?: { subscription?: string } } | null;
      subId = (o.subscription as string | null) ?? parent?.subscription_details?.subscription ?? null;
    } else {
      subId = o.id as string;
    }
    // Always read the subscription fresh, so events that arrive out of order still leave the latest state.
    if (subId) {
      const sub: Subscription = event.type === "customer.subscription.deleted" ? (o as unknown as Subscription) : await getSubscription(subId);
      await syncSubscription(sub);
    }
    return Response.json({ ok: true });
  } catch (e) {
    await db.from("stripe_events").delete().eq("id", event.id);
    const message = e instanceof Error ? e.message : String(e);
    console.error("Stripe webhook failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
