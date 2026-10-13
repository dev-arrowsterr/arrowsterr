import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Save a finished bulk analysis so it has its own link. Uses the person's own client, so the
 * workspace's rules apply. Returns the run's id, or null when it could not be saved (the
 * results still show, they just have no link). Needs supabase/033_bulk_runs.sql.
 */
export async function saveBulkRun(
  sb: SupabaseClient,
  run: { workspaceId: string; siteId?: unknown; kind: "keywords" | "domains"; country: string; items: string[]; result: unknown },
): Promise<string | null> {
  const id = randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "x");
  const { error } = await sb.from("bulk_runs").insert({
    id,
    workspace_id: run.workspaceId,
    site_id: typeof run.siteId === "string" && run.siteId ? run.siteId : null,
    kind: run.kind,
    country: run.country,
    count: run.items.length,
    items: run.items,
    result: run.result,
  });
  if (error) {
    if (!/bulk_runs/.test(error.message)) console.error("Saving bulk run:", error.message);
    return null;
  }
  return id;
}
