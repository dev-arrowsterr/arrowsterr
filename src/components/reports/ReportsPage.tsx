"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import type { RunAuth } from "@/lib/runner";
import type { View } from "@/lib/view";
import { Thinking } from "../ui";
import { ClientEditor } from "./ClientEditor";
import { QuickReport } from "./QuickReport";
import { ReportLibrary } from "./ReportLibrary";
import { errText, post } from "./reportApi";
import type { Library, SavedReport } from "./types";

const idFromUrl = () => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("report"));

/** Reports: the library of saved reports, and one report open at /reports?report=<id> (docs/reports.md, sections 3 to 5). */
export function ReportsPage({ sb, auth, view, canEdit, onPlans }: { sb: SupabaseClient; auth: RunAuth; view: View; canEdit: boolean; onPlans: () => void }) {
  const [id, setId] = useState<string | null>(idFromUrl);
  const [lib, setLib] = useState<Library | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const back = () => setId(idFromUrl());
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);

  const load = useCallback(async () => {
    try {
      setLib(await post<Library>(auth, "/api/reports/list", {}));
      setError("");
    } catch (e) {
      setError(errText(e));
    }
    // The app hands a new auth object on every render. The workspace is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.workspaceId]);
  useEffect(() => {
    // Loading the library when the page opens is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const open = (next: string | null) => {
    const p = new URLSearchParams(window.location.search);
    if (next) p.set("report", next);
    else p.delete("report");
    window.history.pushState(null, "", window.location.pathname + (p.size ? `?${p}` : ""));
    setId(next);
    window.scrollTo(0, 0);
  };
  const patch = (r: SavedReport) => setLib((l) => l && { ...l, reports: l.reports.map((x) => (x.id === r.id ? r : x)) });

  if (!lib) return error ? <p className="aw-error max-w-2xl">{error}</p> : <Thinking text="Loading your reports..." />;
  const report = id ? lib.reports.find((r) => r.id === id) : null;
  if (id && !report) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="aw-callout">That report is gone.</p>
        <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => open(null)}>
          Back to reports
        </button>
      </div>
    );
  }
  if (report?.kind === "client") return <ClientEditor key={report.id} sb={sb} auth={auth} lib={lib} report={report} canEdit={canEdit} onBack={() => open(null)} onSaved={patch} />;
  if (report) return <QuickReport key={report.id} sb={sb} auth={auth} view={view} lib={lib} report={report} canEdit={canEdit} onBack={() => open(null)} onSaved={patch} />;
  return <ReportLibrary sb={sb} auth={auth} lib={lib} brandId={view.brand.id} canEdit={canEdit} onOpen={open} onChange={setLib} reload={load} onPlans={onPlans} />;
}
