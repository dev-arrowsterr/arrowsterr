import { trackerOrigin, umamiReady } from "@/lib/umami";
import { allowVisit } from "@/lib/visitCap";

// Visit events from customer sites, passed on to Umami with the visitor's IP and browser,
// which Umami needs for country and unique-visitor counts.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-umami-cache",
  "Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  if (!umamiReady()) return new Response(null, { status: 204, headers: CORS });
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || request.headers.get("x-real-ip") || "";
  const forward: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": request.headers.get("user-agent") ?? "",
  };
  if (ip) {
    forward["X-Forwarded-For"] = ip;
    forward["X-Client-IP"] = ip;
  }
  const cache = request.headers.get("x-umami-cache");
  if (cache) forward["x-umami-cache"] = cache;
  for (const h of ["accept-language", "cf-ipcountry"]) {
    const v = request.headers.get(h);
    if (v) forward[h] = v;
  }
  const body = await request.text();
  // Over the plan's visits for the month: answer OK so the site never sees an error.
  if (!(await allowVisit(body))) return new Response(null, { status: 202, headers: CORS });
  try {
    const res = await fetch(`${trackerOrigin()}/api/send`, { method: "POST", headers: forward, body, signal: AbortSignal.timeout(10_000) });
    const text = await res.text();
    // Shows up in Render logs, so a broken setup is easy to spot.
    if (!res.ok) console.error(`Tracking event rejected by Umami (${res.status}): ${text.slice(0, 200)}`);
    return new Response(text, { status: res.status, headers: { ...CORS, "Content-Type": res.headers.get("content-type") ?? "text/plain" } });
  } catch (e) {
    console.error("Tracking event could not reach Umami:", e instanceof Error ? e.message : e);
    return new Response(null, { status: 202, headers: CORS });
  }
}
