import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PLANS, planOfLookup } from "./plans";

// A small Stripe client over its REST API. Needs STRIPE_SECRET_KEY, and STRIPE_WEBHOOK_SECRET for the webhook.

/** The app's own address, for links back from Stripe. */
export const originOf = (request: Request) => process.env.APP_URL?.trim().replace(/\/+$/, "") || request.headers.get("origin") || new URL(request.url).origin;

export const stripeReady = () => Boolean(process.env.STRIPE_SECRET_KEY?.trim());

type Params = Record<string, unknown>;

/** Stripe's form encoding: nested objects become a[b][c]=v, arrays a[0]=v. */
function encode(params: Params, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" && x !== null ? encode(x as Params, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === "object") encode(v as Params, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe<T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE", path: string, params: Params = {}, idempotencyKey?: string): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set on Render.");
  const body = encode(params);
  const url = `https://api.stripe.com/v1/${path}${method === "GET" && body.size ? `?${body}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: method === "GET" ? undefined : body,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe: ${(data as { error?: { message?: string } }).error?.message ?? res.status}`);
  return data as T;
}

export type Price = { id: string; lookup_key: string | null; unit_amount: number | null; recurring: { interval: string } | null };
export type Subscription = {
  id: string;
  customer: string;
  status: string;
  metadata: Record<string, string>;
  cancel_at: number | null;
  billing_cycle_anchor: number;
  current_period_end?: number;
  items: { data: { id: string; price: Price; current_period_end?: number }[] };
};

const prices = new Map<string, { at: number; price: Price }>();

/** The live price for a lookup key, like arrowsterr_scale_month. Made by scripts/stripe-setup.mjs. */
export async function priceFor(lookupKey: string): Promise<Price> {
  const hit = prices.get(lookupKey);
  if (hit && Date.now() - hit.at < 600_000) return hit.price;
  const { data } = await stripe<{ data: Price[] }>("GET", "prices", { lookup_keys: [lookupKey], active: true, limit: 1 });
  const price = data[0] ?? (await makePrice(lookupKey));
  prices.set(lookupKey, { at: Date.now(), price });
  return price;
}

/** Make a plan's product and price in Stripe the first time someone picks it, from src/lib/plans.ts. */
async function makePrice(lookupKey: string): Promise<Price> {
  const found = planOfLookup(lookupKey);
  if (!found) throw new Error(`Unknown plan price ${lookupKey}.`);
  const plan = PLANS[found.plan];
  const productId = `arrowsterr_${found.plan}`;
  await stripe("GET", `products/${productId}`).catch(() =>
    stripe("POST", "products", { id: productId, name: `Arrowsterr ${plan.name}`, metadata: { plan: found.plan } }, `product-${productId}`),
  );
  const cents = Math.round((found.interval === "year" ? plan.annual * 12 : plan.price) * 100);
  return stripe<Price>(
    "POST",
    "prices",
    { product: productId, currency: "usd", unit_amount: cents, recurring: { interval: found.interval }, lookup_key: lookupKey, tax_behavior: "exclusive", metadata: { plan: found.plan, interval: found.interval } },
    `price-${lookupKey}-${cents}`,
  );
}

/** Check a webhook really came from Stripe. Returns the event, or null. */
export function readEvent(raw: string, header: string | null): { id: string; type: string; data: { object: Record<string, unknown> } } | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret || !header) return null;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]).filter((p) => p.length === 2 && p[0] === "t"));
  const t = Number(parts.t);
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > 600) return null;
  const want = createHmac("sha256", secret).update(`${t}.${raw}`).digest();
  const ok = sigs.some((s) => {
    const got = Buffer.from(s, "hex");
    return got.length === want.length && timingSafeEqual(got, want);
  });
  if (!ok) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
