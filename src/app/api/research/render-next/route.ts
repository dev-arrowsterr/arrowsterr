import { allowed } from "@/lib/cronAuth";
import { leaseNextPage } from "@/lib/articleResearchServer";
import { adminClient } from "@/lib/serverAuth";

// The Fly worker asks for the next page to read for article research (docs/content-v2.md, steps 2 and 3).
// The page is leased to that worker for 90 seconds, after its address and robots.txt were checked.
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!allowed(request)) return Response.json({ error: "Wrong or missing CRON_SECRET." }, { status: 401 });
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, { status: 500 });
  const worker = (new URL(request.url).searchParams.get("worker") ?? "read").replace(/[^\w-]/g, "").slice(0, 40) || "read";
  try {
    const page = await leaseNextPage(db, worker);
    return Response.json(page ?? { idle: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
