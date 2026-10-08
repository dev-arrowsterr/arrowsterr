import { trackerOrigin, umamiReady } from "@/lib/umami";

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
  try {
    const res = await fetch(`${trackerOrigin()}/api/send`, { method: "POST", headers: forward, body: await request.text(), signal: AbortSignal.timeout(10_000) });
    return new Response(await res.text(), { status: res.status, headers: { ...CORS, "Content-Type": res.headers.get("content-type") ?? "text/plain" } });
  } catch {
    return new Response(null, { status: 202, headers: CORS });
  }
}
