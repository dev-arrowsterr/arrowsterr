// Momos lead routing Worker.
// 1. Answers the Framer form with the AE's calendar URL in milliseconds.
// 2. After answering, Claude verifies the lead and the result goes to Zapier (Salesforce + Slack).
import { instantRoute, type FormData, type Instant } from "./route.ts";
import { verifyLead, type Verification } from "./verify.ts";

export interface Env {
  ANTHROPIC_API_KEY: string;
  ZAPIER_HOOK_URL: string;
  JAMES_URL: string;
  JILL_URL: string;
  NOT_FIT_URL: string;
  ALLOWED_ORIGINS: string; // comma separated
}

type Ctx = { waitUntil(p: Promise<unknown>): void };

// Cloudflare stops background work 30s after the response, so Claude gets 25s.
const CLAUDE_BUDGET_MS = 25_000;
const AE_NAMES = { james: "James", jill: "Jill" } as const;

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  const ok = allowed.includes(origin) || /^https:\/\/[a-z0-9-]+\.framer\.(app|website|ai)$/.test(origin);
  return ok
    ? { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", vary: "Origin" }
    : {};
}

function urlFor(instant: Instant, env: Env): string {
  if (instant.ae === "james") return env.JAMES_URL;
  if (instant.ae === "jill") return env.JILL_URL;
  return env.NOT_FIT_URL;
}

export function zapierPayload(form: FormData, instant: Instant, url: string, v: Verification | null, error?: string) {
  const pick = (k: string) => (typeof form[k] === "string" ? (form[k] as string) : "");
  return {
    lead: {
      first_name: pick("firstName"),
      last_name: pick("lastName"),
      email: pick("email"),
      company: pick("company"),
      job_title: pick("title"),
      country: pick("country"),
      locations: pick("locations"),
    },
    routing: {
      status: instant.status,
      reason: instant.reason,
      ae: instant.ae ? AE_NAMES[instant.ae] : "",
      region: instant.region,
      redirect_url: url,
      // Claude may place the company somewhere else than the form did. Worth a look in Slack.
      region_mismatch: !!v && v.region !== "unknown" && v.region !== instant.region,
    },
    verification: v ?? { verdict: "unavailable", error: error ?? "" },
    utm: {
      utm_source: pick("utm_source"),
      utm_medium: pick("utm_medium"),
      utm_campaign: pick("utm_campaign"),
      utm_term: pick("utm_term"),
      utm_content: pick("utm_content"),
      utm_channel: pick("utm_channel"),
      gclid_c: pick("gclid"),
    },
    meta: {
      timezone: pick("timezone"),
      page_url: pick("pageUrl"),
      referrer: pick("referrer"),
      elapsed_ms: form.elapsedMs ?? null,
      submitted_at: new Date().toISOString(),
    },
  };
}

async function verifyAndSend(form: FormData, instant: Instant, url: string, env: Env) {
  let v: Verification | null = null;
  let error: string | undefined;
  // Obvious spam skips Claude to save time and money. It still goes to Zapier so nothing disappears.
  if (instant.status !== "spam") {
    try {
      v = await Promise.race([
        verifyLead(env.ANTHROPIC_API_KEY, form, instant, CLAUDE_BUDGET_MS),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Claude took too long")), CLAUDE_BUDGET_MS)),
      ]);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  const res = await fetch(env.ZAPIER_HOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(zapierPayload(form, instant, url, v, error)),
  });
  if (!res.ok) console.error("Zapier returned", res.status);
}

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    const headers = cors(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return new Response("POST only", { status: 405, headers });

    let form: FormData;
    try {
      // Read as text so the form can send text/plain and skip the CORS preflight round trip.
      const parsed = JSON.parse(await req.text());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      form = parsed;
    } catch {
      return Response.json({ url: env.JILL_URL }, { status: 400, headers });
    }

    const instant = instantRoute(form);
    const url = urlFor(instant, env);
    ctx.waitUntil(verifyAndSend(form, instant, url, env));
    return Response.json({ url }, { headers });
  },
};
