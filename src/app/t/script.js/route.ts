import { trackerOrigin, umamiReady } from "@/lib/umami";

// The tracking script, served from our own address. Customers install this URL once,
// so moving from Umami Cloud to our own Umami server never changes their snippet.
let cached: { at: number; body: string } | null = null;

export async function GET() {
  if (!umamiReady()) return new Response("/* Arrowsterr tracking is not set up */", { headers: { "Content-Type": "application/javascript" } });
  if (!cached || Date.now() - cached.at > 6 * 3600_000) {
    const res = await fetch(`${trackerOrigin()}/script.js`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return new Response("/* tracker unavailable */", { status: 502, headers: { "Content-Type": "application/javascript" } });
    cached = { at: Date.now(), body: await res.text() };
  }
  return new Response(cached.body, {
    headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" },
  });
}
