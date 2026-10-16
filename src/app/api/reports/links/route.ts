import { buildSaved, hashPassword, migrationHint, REPORT_COLS, reportContext, userIdOf, type ReportRow } from "@/lib/reportServer";
import { guardWhiteLabel, linkProblem } from "@/lib/reportLinks";
import { adminClient, requireRole } from "@/lib/serverAuth";

// Make a share link for a saved report (docs/reports.md, section 13). Editors only.
//   live: opens the saved report with fresh numbers each time. Starter and up.
//   frozen: a copy of the numbers right now. Every plan.
//   password and expiry: Pro and up.
// A client report's frozen numbers are built here, never taken from the browser. The other kinds are
// built in the browser, so their frozen copy is sent with the request, as share links always worked.
export const maxDuration = 120;

const MAX_DATA = 3_000_000;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, { status: 500 });
  const workspaceId = body.workspaceId as string;

  const { data, error } = await auth.sb.from("reports").select(REPORT_COLS).eq("id", body.reportId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) return Response.json({ error: migrationHint(error.message) }, { status: 500 });
  if (!data) return Response.json({ error: "That report is gone." }, { status: 404 });
  const row = data as ReportRow;

  const { limits } = await reportContext(auth.sb, workspaceId);
  const mode = body.mode === "live" ? "live" : "frozen";
  const password = typeof body.password === "string" ? body.password.trim() : "";
  const expires = typeof body.expiresAt === "string" && body.expiresAt ? new Date(body.expiresAt) : null;
  const problem = linkProblem({ mode, kind: row.kind, password, expires }, limits);
  if (problem) return Response.json(problem, { status: problem.limit ? 403 : 400 });

  let snapshot: unknown = null;
  if (mode === "frozen") {
    if (row.kind === "client") {
      try {
        snapshot = (await buildSaved(auth.sb, row)).snapshot;
      } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
      }
    } else {
      const d = body.data as { kind?: string } | undefined;
      if (!d || typeof d !== "object" || d.kind !== row.kind || JSON.stringify(d).length > MAX_DATA) return Response.json({ error: "Nothing to share yet." }, { status: 400 });
      snapshot = guardWhiteLabel(d, limits.whiteLabel);
    }
  }

  const { data: link, error: linkError } = await db
    .from("report_links")
    .insert({
      workspace_id: workspaceId,
      report_id: row.id,
      brand_id: row.brand_id,
      mode,
      snapshot,
      password_hash: password ? await hashPassword(password) : null,
      expires_at: expires?.toISOString() ?? null,
      created_by: await userIdOf(auth.sb, request),
    })
    .select("id, token, mode, expires_at, revoked_at, views, last_viewed_at, created_at, password_hash")
    .single();
  if (linkError) return Response.json({ error: migrationHint(linkError.message) }, { status: 500 });
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "app.arrowsterr.com";
  const { password_hash, ...rest } = link as { password_hash: string | null } & Record<string, unknown>;
  return Response.json({ url: `https://${host}/r/${link.token}`, link: { ...rest, locked: Boolean(password_hash) } });
}
