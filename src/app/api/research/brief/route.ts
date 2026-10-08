import { after } from "next/server";
import { runBrief } from "@/lib/brief";
import { dfsReady } from "@/lib/dataforseo";
import { requireRole, takeAnswer } from "@/lib/serverAuth";

// Content brief for one calendar item: start it, answer right away, and finish in the background.
// The page reads progress from calendar_items.brief_status.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  if (!dfsReady()) return Response.json({ error: "DataForSEO is not set up. Add DFS_LOGIN and DFS_PASSWORD on Render." }, { status: 500 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY is not set on Render." }, { status: 500 });

  const { data: item, error } = await auth.sb.from("calendar_items").select("id, brief_status, brief_at").eq("id", body.itemId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (error) return Response.json({ error: error.message + (/brief/.test(error.message) ? " Run supabase/007_briefs_and_pages.sql in Supabase." : "") }, { status: 500 });
  if (!item) return Response.json({ error: "Calendar item not found." }, { status: 404 });

  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;

  const { error: e2 } = await auth.sb.from("calendar_items").update({ brief_status: "running", brief_error: null }).eq("id", item.id);
  if (e2) return Response.json({ error: e2.message }, { status: 500 });
  after(() => runBrief(auth.sb, item.id));
  return Response.json({ ok: true });
}
