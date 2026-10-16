import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { entitlement } from "./entitlements";
import { reportLimits, type ReportLimits } from "./plans";
import { buildClientReport, type Built } from "./reportBuild";
import { parseDoc, type Kind, type ReportDocument } from "./reportDoc";
import { parseRange, type ReportRange } from "./reportRange";
import { TEMPLATES as THEMES } from "./reportTheme";
import type { ReportStyle } from "./reportTypes";

// Server pieces shared by the report routes, share links and the PDF worker (docs/reports.md, sections 13 and 25).

export { checkPassword, checkPrint, checkSig, hashPassword, printPath, sign, unlockCookie, unlockValue } from "./reportLinks";

export type ReportRow = {
  id: string;
  workspace_id: string;
  brand_id: string;
  kind: Kind;
  name: string;
  doc: unknown;
  range: unknown;
  created_by: string | null;
  updated_at: string;
  archived_at: string | null;
};
export const REPORT_COLS = "id, workspace_id, brand_id, kind, name, doc, range, created_by, updated_at, archived_at";

const BASE_STYLE: ReportStyle = { agency: "", logo: "", color: THEMES[0].accent, theme: THEMES[0], title: "", footer: "", whiteLabel: false };

/** What a report needs from its workspace: plan limits, history, timezone and the saved style. */
export async function reportContext(db: SupabaseClient, workspaceId: string): Promise<{ limits: ReportLimits; historyDays: number; tz: string | null; style: ReportStyle }> {
  const [ent, ws, st] = await Promise.all([
    entitlement(workspaceId),
    db.from("workspaces").select("timezone").eq("id", workspaceId).maybeSingle(),
    db.from("report_styles").select("style").eq("workspace_id", workspaceId).maybeSingle(),
  ]);
  const saved = (st.data?.style ?? {}) as Partial<ReportStyle>;
  return {
    limits: reportLimits(ent.plan),
    historyDays: ent.limits.historyDays,
    tz: (ws.data as { timezone?: string | null } | null)?.timezone ?? null,
    style: { ...BASE_STYLE, ...saved, theme: saved.theme ?? { ...THEMES[0], accent: saved.color ?? THEMES[0].accent } },
  };
}

/** Build a saved client report. doc and range override the saved ones, for a preview before saving. */
export async function buildSaved(db: SupabaseClient, row: ReportRow, over: { doc?: ReportDocument; range?: ReportRange } = {}): Promise<Built> {
  const ctx = await reportContext(db, row.workspace_id);
  return buildClientReport({
    db,
    brandId: row.brand_id,
    range: over.range ?? parseRange(row.range),
    doc: over.doc ?? parseDoc(row.doc),
    style: ctx.style,
    tz: ctx.tz,
    historyDays: ctx.historyDays,
    whiteLabel: ctx.limits.whiteLabel,
  });
}

/** The person behind a request's token. requireRole has already checked it. */
export async function userIdOf(sb: SupabaseClient, request: Request): Promise<string | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await sb.auth.getUser(token);
  return data.user?.id ?? null;
}

/** Plain text for an error that came from a missing migration. */
export const migrationHint = (message: string) => (/report_links|reports|report_versions|relation .* does not exist/.test(message) ? `${message} Run supabase/043_reports.sql in Supabase.` : message);
