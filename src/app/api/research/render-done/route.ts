import { allowed } from "@/lib/cronAuth";
import { savePage } from "@/lib/articleResearchServer";
import { adminClient } from "@/lib/serverAuth";

// The Fly worker sends what it read on a page: { ok: true, final_url, title, headings, body, word_count, tables, published_at },
// or why it could not: { ok: false, reason: "timeout" | "failed" | "blocked" | "private" | "empty", error }.
export async function POST(request: Request) {
  if (!allowed(request)) return Response.json({ error: "Wrong or missing CRON_SECRET." }, { status: 401 });
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, { status: 500 });
  const url = new URL(request.url);
  const id = Number(url.searchParams.get("id")) || 0;
  const worker = (url.searchParams.get("worker") ?? "").replace(/[^\w-]/g, "").slice(0, 40);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "Send the page as JSON." }, { status: 400 });
  try {
    const saved = await savePage(db, worker, id, body as Record<string, unknown>);
    return Response.json(saved, { status: saved.ok ? 200 : 409 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
