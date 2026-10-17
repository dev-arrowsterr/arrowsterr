import { dfsReady } from "@/lib/dataforseo";
import { cleanDomain, cleanKeyword, cleanUrl } from "@/lib/freeLimits";
import { answer, authority, crawlers, links, llms, speed } from "@/lib/freeRunners";
import { cors, freeRun, reply } from "@/lib/freeTools";
import { freeKeyword } from "@/lib/kwReport";
import { MARKETS } from "@/lib/research";

// Free tools for arrowsterr.com (docs/free-tools.md). Public: every tool goes through freeRun's limits.
//   keyword   { keyword, country, focus? }      Keyword Research Tool, Volume Checker, Difficulty Checker
//   crawlers  { domain }                  AI Crawler Checker
//   llms      { domain }                  llms.txt Generator
//   answer    { url }                     AI Answer-Ready Checker
//   authority { domain }                  Domain Authority Checker
//   speed     { url, strategy }           Page Speed Checker
//   links     { url }                     Broken Link and Redirect Checker
// Every request also carries { token } for Cloudflare Turnstile when it is on.

export const maxDuration = 120;

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: cors(request) });
}

const needDomain = (request: Request) => reply(request, { error: "Enter a website, like acme.com." }, 400);
const needUrl = (request: Request) => reply(request, { error: "Enter a page address, like acme.com/pricing." }, 400);

export async function POST(request: Request, { params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  switch (tool) {
    case "keyword": {
      const keyword = cleanKeyword(body.keyword);
      if (!keyword) return reply(request, { error: "Enter a keyword of 2 to 80 characters, like crm for small business." }, 400);
      const country = typeof body.country === "string" && Object.hasOwn(MARKETS, body.country) && body.country !== "Global" ? body.country : null;
      if (!country) return reply(request, { error: "Pick a country." }, 400);
      if (!dfsReady()) return reply(request, { error: "This tool is resting. Please try again later." }, 503);
      const focus = body.focus === "volume" || body.focus === "difficulty" ? body.focus : "all";
      return freeRun(request, body, "keyword", focus === "all" ? `${country}:${keyword}` : `${focus}:${country}:${keyword}`, () => freeKeyword(keyword, country, focus));
    }
    case "crawlers": {
      const domain = cleanDomain(body.domain);
      return domain ? freeRun(request, body, "crawlers", domain, () => crawlers(domain)) : needDomain(request);
    }
    case "llms": {
      const domain = cleanDomain(body.domain);
      return domain ? freeRun(request, body, "llms", domain, () => llms(domain)) : needDomain(request);
    }
    case "answer": {
      const url = cleanUrl(body.url);
      return url ? freeRun(request, body, "answer", url, () => answer(url)) : needUrl(request);
    }
    case "authority": {
      const domain = cleanDomain(body.domain);
      return domain ? freeRun(request, body, "authority", domain, () => authority(domain)) : needDomain(request);
    }
    case "speed": {
      const url = cleanUrl(body.url);
      const strategy = body.strategy === "desktop" ? "desktop" : "mobile";
      return url ? freeRun(request, body, "speed", `${strategy}:${url}`, () => speed(url, strategy)) : needUrl(request);
    }
    case "links": {
      const url = cleanUrl(body.url);
      return url ? freeRun(request, body, "links", url, () => links(url)) : needUrl(request);
    }
  }
  return reply(request, { error: "No such tool." }, 404);
}
