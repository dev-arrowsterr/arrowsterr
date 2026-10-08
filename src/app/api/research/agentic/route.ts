import { after } from "next/server";
import { runAgent } from "@/lib/agent";
import { dfsReady } from "@/lib/dataforseo";
import type { Profile } from "@/lib/db";
import { requireRole, takeAnswer } from "@/lib/serverAuth";

// Agentic Keyword Research: start a run, answer right away, and keep working in the background.
// The page reads progress from keyword_runs.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  if (!dfsReady()) return Response.json({ error: "DataForSEO is not set up. Add DFS_LOGIN and DFS_PASSWORD on Render." }, { status: 500 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY is not set on Render." }, { status: 500 });

  const { data: site, error } = await auth.sb
    .from("sites")
    .select("id, domain, name, profile")
    .eq("id", body.siteId)
    .eq("workspace_id", body.workspaceId)
    .maybeSingle();
  if (error) return Response.json({ error: error.message + (/sites/.test(error.message) ? " Run supabase/006_research.sql in Supabase." : "") }, { status: 500 });
  if (!site) return Response.json({ error: "Website not found." }, { status: 404 });

  // One research run at a time per website.
  const since = new Date(Date.now() - 20 * 60_000).toISOString();
  const { data: busy } = await auth.sb.from("keyword_runs").select("id").eq("site_id", site.id).eq("status", "running").gte("created_at", since).limit(1);
  if (busy?.length) return Response.json({ error: "Research is already running for this website.", id: busy[0].id }, { status: 409 });

  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;

  const { data: run, error: err } = await auth.sb
    .from("keyword_runs")
    .insert({ workspace_id: body.workspaceId, site_id: site.id, step: "Starting" })
    .select("id")
    .single();
  if (err || !run) return Response.json({ error: err?.message ?? "Could not start." }, { status: 500 });

  after(() => runAgent(auth.sb, run.id, site as { id: string; domain: string; name: string; profile: Profile }));
  return Response.json({ id: run.id });
}
