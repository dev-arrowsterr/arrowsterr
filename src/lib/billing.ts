import "server-only";
import { forgetEntitlement } from "./entitlements";
import { dailyAnswers, limitsFor, planOfLookup, type Extras } from "./plans";
import { adminClient } from "./serverAuth";
import { stripe, type Subscription } from "./stripe";

// Keeps each workspace's plan in step with its Stripe subscription.

const iso = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString() : null);

/** Stripe's subscription states, as plan states. Null means leave the workspace as it is. */
function statusOf(s: string): "active" | "past_due" | "canceled" | null {
  if (s === "active" || s === "trialing") return "active";
  if (s === "past_due") return "past_due";
  if (s === "canceled" || s === "unpaid" || s === "incomplete_expired") return "canceled";
  return null; // incomplete: the first payment is still going through
}

/** Find the workspace a subscription belongs to. */
async function workspaceOf(sub: Subscription) {
  const db = adminClient()!;
  if (sub.metadata?.workspace_id) return sub.metadata.workspace_id;
  const { data } = await db.from("workspaces").select("id").eq("stripe_customer_id", sub.customer).limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Write a subscription's plan, limits and dates to its workspace. */
export async function syncSubscription(sub: Subscription) {
  const db = adminClient();
  if (!db) throw new Error("Add SUPABASE_SECRET_KEY on Render.");
  const ws = await workspaceOf(sub);
  if (!ws) return null;
  const status = statusOf(sub.status);
  if (!status) return ws;
  const item = sub.items.data[0];
  const found = planOfLookup(item?.price.lookup_key);
  const { data: w } = await db.from("workspaces").select("plan, extras, stripe_subscription_id").eq("id", ws).maybeSingle();
  // An old subscription ending never undoes a newer one.
  if (w?.stripe_subscription_id && w.stripe_subscription_id !== sub.id && status === "canceled") return ws;
  const plan = found?.plan ?? w?.plan ?? "scale";
  const limits = limitsFor(plan, (w?.extras ?? {}) as Extras);
  const { error } = await db
    .from("workspaces")
    .update({
      plan,
      plan_status: status,
      stripe_customer_id: sub.customer,
      stripe_subscription_id: sub.id,
      billing_interval: found?.interval ?? null,
      billing_anchor: iso(sub.billing_cycle_anchor),
      period_end: iso(item?.current_period_end ?? sub.current_period_end),
      cancel_at: iso(sub.cancel_at),
      trial_ends_at: null,
      brand_limit: limits.brands,
      prompt_limit: limits.prompts,
      daily_answer_limit: dailyAnswers(limits),
      seat_limit: limits.seats,
    })
    .eq("id", ws);
  if (error) throw new Error(error.message);
  forgetEntitlement(ws);
  return ws;
}

export const getSubscription = (id: string) => stripe<Subscription>("GET", `subscriptions/${id}`);
