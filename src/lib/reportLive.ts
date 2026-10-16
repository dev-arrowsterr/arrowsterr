import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSaved, REPORT_COLS, type ReportRow } from "./reportServer";
import type { ReportSnapshot } from "./reportTypes";

// A live link's numbers. Built from the saved report and kept for an hour, so a busy link doesn't rebuild each view.
// A save to the report, or a new hour, starts fresh.
const HOUR = 3600_000;
const cache = new Map<string, { at: number; snapshot: ReportSnapshot }>();

/** null when the report is gone, archived or not a client report. */
export async function liveSnapshot(db: SupabaseClient, reportId: string): Promise<ReportSnapshot | null> {
  const { data } = await db.from("reports").select(REPORT_COLS).eq("id", reportId).maybeSingle();
  const row = data as ReportRow | null;
  if (!row || row.archived_at || row.kind !== "client") return null;
  const key = `${row.id}:${row.updated_at}:${new Date().toISOString().slice(0, 13)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < HOUR) return hit.snapshot;
  const { snapshot } = await buildSaved(db, row);
  for (const k of cache.keys()) if (k.startsWith(`${row.id}:`)) cache.delete(k);
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), snapshot });
  return snapshot;
}
