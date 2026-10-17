"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { PDF_PAGES } from "@/lib/pdf/pages";
import type { RunAuth } from "@/lib/runner";
import { ToolIntro } from "../ToolIntro";
import { Thinking } from "../ui";
import { Confirm } from "./Dialog";
import { errText, post } from "./reportApi";

// Reports (docs/reports.md, section 32.4): every PDF made from a page's Download PDF, newest first.
// Schedules that email them come in phase 4.

type FileRow = { id: string; brand_id: string | null; page: string; title: string; design: "arrowsterr" | "brand"; params: { days?: number; topic?: string | null; model?: string | null }; status: "making" | "ready" | "failed"; error: string | null; created_at: string };
const COLS = "id, brand_id, page, title, design, params, status, error, created_at";
const when = (t: string) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function ReportsPage({ sb, auth, brands, canEdit }: { sb: SupabaseClient; auth: RunAuth; brands: { id: string; name: string }[]; canEdit: boolean }) {
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [deleting, setDeleting] = useState<FileRow | null>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await sb.from("report_files").select(COLS).eq("workspace_id", auth.workspaceId).order("created_at", { ascending: false }).limit(200);
    if (e) setError(/report_files/.test(e.message) ? "Run supabase/046_report_files.sql in Supabase." : e.message);
    else setFiles((data ?? []) as FileRow[]);
  }, [sb, auth.workspaceId]);
  useEffect(() => {
    // Loading the files when the page opens is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function download(f: FileRow) {
    setBusy(f.id);
    setError("");
    try {
      const s = await post<{ status: string; url?: string; error?: string }>(auth, "/api/files", { action: "status", fileId: f.id });
      if (s.status === "ready" && s.url) window.location.assign(s.url);
      else if (s.status === "failed") setError(s.error ?? "That PDF failed.");
      else setError("That PDF is still being made. Try again in a minute.");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy("");
    }
  }

  async function remove(f: FileRow) {
    setBusy(f.id);
    try {
      await post(auth, "/api/files", { action: "delete", fileId: f.id });
      setFiles((x) => x?.filter((y) => y.id !== f.id) ?? null);
      setDeleting(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy("");
    }
  }

  if (!files) return error ? <p className="aw-error max-w-2xl">{error}</p> : <Thinking text="Loading your reports..." />;
  const brandName = (id: string | null) => brands.find((b) => b.id === id)?.name ?? "–";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="aw-h2">Reports</h1>
      {error ? <p className="aw-error">{error}</p> : null}
      {!files.length ? (
        <ToolIntro
          eyebrow="Reports"
          title="Every PDF you download lands here"
          lead="Click Download PDF on Prompts, Competitors or Sources. Pick the Arrowsterr design or your Brand Kit's, and the file is kept here to download again."
        />
      ) : (
        <section className="aw-frame overflow-x-auto">
          <table className="aw-table aw-table--compact">
            <thead>
              <tr>
                <th>Report</th>
                <th>Brand</th>
                <th>Dates</th>
                <th>Design</th>
                <th>Made</th>
                <th className="w-48" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <td className="font-medium text-ink">{f.title || PDF_PAGES.find((p) => p.id === f.page)?.title}</td>
                  <td>{brandName(f.brand_id)}</td>
                  <td className="aw-num text-[13px]">
                    Last {f.params.days ?? 30} days
                    {f.params.topic ? ` · ${f.params.topic}` : ""}
                    {f.params.model ? ` · ${f.params.model}` : ""}
                  </td>
                  <td>{f.design === "brand" ? "Brand Kit" : "Arrowsterr"}</td>
                  <td className="text-[13px] text-muted">{when(f.created_at)}</td>
                  <td className="text-right">
                    <span className="inline-flex items-center gap-2">
                      {f.status === "ready" ? (
                        <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={busy === f.id} onClick={() => download(f)}>
                          Download
                        </button>
                      ) : f.status === "failed" ? (
                        <span className="aw-status aw-status--missed" title={f.error ?? undefined}>
                          Failed
                        </span>
                      ) : (
                        <span className="aw-status aw-status--pending">Making</span>
                      )}
                      {canEdit ? (
                        <button type="button" className="aw-btn aw-btn--ghost aw-btn--sm" disabled={busy === f.id} onClick={() => setDeleting(f)}>
                          Delete
                        </button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {deleting ? <Confirm title="Delete this PDF?" text="The file goes for everyone in this workspace." action="Delete" busy={busy === deleting.id} onConfirm={() => remove(deleting)} onClose={() => setDeleting(null)} /> : null}
    </div>
  );
}
