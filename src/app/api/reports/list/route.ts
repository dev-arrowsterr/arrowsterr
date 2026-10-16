import { migrationHint, REPORT_COLS, reportContext, userIdOf } from "@/lib/reportServer";
import { requireRole } from "@/lib/serverAuth";

// The report library: every saved report in the workspace, the brands, the plan's report limits and views on live links.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "viewer");
  if ("denied" in auth) return auth.denied;
  const workspaceId = body.workspaceId as string;
  const [reports, brands, links, ctx, me] = await Promise.all([
    auth.sb.from("reports").select(REPORT_COLS).eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(500),
    auth.sb.from("brands").select("id, name, domain, logo").eq("workspace_id", workspaceId).order("created_at"),
    auth.sb.from("report_links").select("report_id, views, revoked_at").eq("workspace_id", workspaceId).not("report_id", "is", null),
    reportContext(auth.sb, workspaceId),
    userIdOf(auth.sb, request),
  ]);
  if (reports.error) return Response.json({ error: migrationHint(reports.error.message), missing: /reports/.test(reports.error.message) }, { status: 500 });
  const views: Record<string, number> = {};
  const shared: Record<string, number> = {};
  for (const l of (links.data ?? []) as { report_id: string; views: number; revoked_at: string | null }[]) {
    views[l.report_id] = (views[l.report_id] ?? 0) + l.views;
    if (!l.revoked_at) shared[l.report_id] = (shared[l.report_id] ?? 0) + 1;
  }
  return Response.json({ reports: reports.data, brands: brands.data ?? [], limits: ctx.limits, historyDays: ctx.historyDays, tz: ctx.tz, views, shared, me });
}
