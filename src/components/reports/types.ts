import type { ReportLimits } from "@/lib/plans";
import type { Kind } from "@/lib/reportDoc";

export type SavedReport = { id: string; workspace_id: string; brand_id: string; kind: Kind; name: string; doc: unknown; range: unknown; created_by: string | null; updated_at: string; archived_at: string | null };
export type LibBrand = { id: string; name: string; domain: string; logo: string | null };
export type Library = { reports: SavedReport[]; brands: LibBrand[]; limits: ReportLimits; historyDays: number; tz: string | null; views: Record<string, number>; shared: Record<string, number>; me: string | null };
export const REPORT_COLS = "id, workspace_id, brand_id, kind, name, doc, range, created_by, updated_at, archived_at";
