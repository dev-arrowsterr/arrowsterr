import { dfsReady } from "@/lib/dataforseo";
import { cleanKeyword } from "@/lib/freeLimits";
import { cors, freeRun, reply } from "@/lib/freeTools";
import { freeKeyword } from "@/lib/kwReport";
import { MARKETS } from "@/lib/research";

// Free tools for arrowsterr.com (docs/free-tools.md). Public: every tool goes through freeRun's limits.
//   POST /api/free/keyword { keyword, country, token }

export const maxDuration = 60;

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: cors(request) });
}

export async function POST(request: Request, { params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (tool === "keyword") {
    const keyword = cleanKeyword(body.keyword);
    if (!keyword) return reply(request, { error: "Enter a keyword of 2 to 80 characters, like crm for small business." }, 400);
    const country = typeof body.country === "string" && Object.hasOwn(MARKETS, body.country) && body.country !== "Global" ? body.country : null;
    if (!country) return reply(request, { error: "Pick a country." }, 400);
    if (!dfsReady()) return reply(request, { error: "This tool is resting. Please try again later." }, 503);
    return freeRun(request, body, "keyword", `${country}:${keyword}`, () => freeKeyword(keyword, country));
  }

  return reply(request, { error: "No such tool." }, 404);
}
