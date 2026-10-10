import { after } from "next/server";
import { runAgent } from "@/lib/agent";
import { dfsReady } from "@/lib/dataforseo";
import type { Profile } from "@/lib/db";
import type { PlanBrief } from "@/lib/research";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { metered, meteredRoute } from "@/lib/meter";
import { entitlement, requirePaid } from "@/lib/entitlements";
import { enqueue, queueReady } from "@/lib/jobs";

// Agentic Keyword Research: start a run, answer right away, and keep working on the job queue
// (or in the background before supabase/016_queue.sql).
// The page reads progress from keyword_runs.
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const paid = await requirePaid(body.workspaceId);
  if (paid) return paid;
  // The Topic Bank is free on every plan: each website gets one content plan, kept for good.
  const e = await entitlement(body.workspaceId);
  if (e.readOnly) return Response.json({ error: "This workspace is read-only." }, { status: 402 });
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

  const { data: done } = await auth.sb.from("keyword_runs").select("id").eq("site_id", site.id).eq("status", "done").limit(1);
  if (done?.length) return Response.json({ error: "This website already has its Topic Bank.", id: done[0].id }, { status: 409 });

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

  // Every website gets the full-size plan, bottom of the funnel first.
  const asked = cleanBrief(body.brief);
  const brief: PlanBrief = { funnel: "bofu", ...asked, size: 120 };
  if (await queueReady()) {
    await enqueue("plan", { runId: run.id, site: { ...site, brief } }, { workspaceId: body.workspaceId, key: `plan:${run.id}`, maxAttempts: 2 });
    return Response.json({ id: run.id });
  }
  after(async () => {
    await metered(body.workspaceId, "content plan", () => runAgent(auth.sb, run.id, { ...(site as { id: string; domain: string; name: string; profile: Profile }), brief }));
  });
  return Response.json({ id: run.id });
}

const text = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 500) : undefined);
const oneOf = <T extends string | number>(v: unknown, list: readonly T[]) => (list.includes(v as T) ? (v as T) : undefined);

/** Keep only answers the planner understands. */
function cleanBrief(b: unknown): PlanBrief | undefined {
  if (!b || typeof b !== "object") return undefined;
  const x = b as Record<string, unknown>;
  return {
    goal: oneOf(x.goal, ["leads", "traffic", "ai", "authority"] as const),
    funnel: oneOf(x.funnel, ["balanced", "bofu", "mofu", "tofu"] as const),
    size: oneOf(x.size, [30, 60, 120] as const),
    difficulty: oneOf(x.difficulty, ["easy", "mixed", "hard"] as const),
    formats: Array.isArray(x.formats) ? x.formats.filter((f): f is string => typeof f === "string").slice(0, 10) : undefined,
    focus: text(x.focus),
    audience: text(x.audience),
    avoid: text(x.avoid),
    rivals: text(x.rivals),
    updates: typeof x.updates === "boolean" ? x.updates : undefined,
    perWeek: oneOf(x.perWeek, [1, 2, 3, 4, 5] as const),
    start: typeof x.start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.start) ? x.start : undefined,
  };
}

export const POST = meteredRoute("content plan", handle);
