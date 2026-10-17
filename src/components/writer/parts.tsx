"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import type { Brand, Site } from "@/lib/db";
import { siteForBrand } from "@/lib/db";
import type { RunAuth } from "@/lib/runner";
import { putStash } from "@/lib/stash";
import type { FullBrief, FullDraft } from "@/lib/writerLibrary";
import { researchProgress, statusLabel } from "@/lib/writerLibrary";
import { useStash } from "@/lib/stash";
import { Confirm, Modal } from "../reports/Dialog";
import { post } from "../research/shared";

// Pieces the Agentic Writer and the Library share.

const TAG: Record<string, string> = { generating: "aw-status--warn", ready: "aw-status--pending", approved: "aw-status--ranked", failed: "aw-status--missed" };

/** A brief's or draft's state as a square tag. */
export function StateTag({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-muted">–</span>;
  return <span className={`aw-status ${TAG[status] ?? "aw-status--pending"}`}>{statusLabel(status)}</span>;
}

/** The website behind a brand, as Content finds it. undefined while loading, null when there is none. */
export function useBrandSite(sb: SupabaseClient, brand: Brand, canEdit: boolean) {
  const [site, setSite] = useStash<Site | null | undefined>(`site:${brand.id}`, undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    siteForBrand(sb, brand, canEdit)
      .then((s) => live && setSite(s))
      .catch((e) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : String(e));
        setSite(null);
      });
    return () => {
      live = false;
    };
  }, [sb, brand, canEdit, setSite]);
  return { site, error };
}

/** Run fn every ms while on is true. */
export function usePoll(on: boolean, ms: number, fn: () => void) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [on, ms]);
}

export const libraryKey = (brandId: string) => `library:${brandId}:open`;
export type LibraryOpen = { kind: "brief" | "draft"; id: string } | null;

/** Go to the Library with one brief or draft open. */
export function openInLibrary(brandId: string, open: LibraryOpen) {
  putStash(libraryKey(brandId), open);
  window.history.pushState(null, "", `/library${window.location.search}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

const RUN_STEP: Record<string, string> = { queued: "Starting research", searching: "Reading Google and the AI answers", reading: "Reading the top pages", waiting: "Waiting to read more pages", done: "Research done" };

/** Where a brief stands while it's made: the research, then the writing. */
export function BriefProgress({ sb, brief }: { sb: SupabaseClient; brief: Pick<FullBrief, "step" | "research_run_id" | "status"> }) {
  const [run, setRun] = useState<{ status: string; read: number; total: number } | null>(null);
  const load = () => {
    if (brief.research_run_id) researchProgress(sb, brief.research_run_id).then(setRun).catch(() => {});
  };
  useEffect(load, [sb, brief.research_run_id]);
  usePoll(brief.status === "generating", 4000, load);
  const steps = [
    { label: run ? RUN_STEP[run.status] ?? "Research" : "Starting research", note: run && run.total ? `${run.read} of ${run.total} pages read` : "", done: brief.step !== "research", on: brief.step === "research" },
    { label: "Writing the brief", note: "", done: brief.step === "done", on: brief.step === "writing" },
  ];
  return <Steps steps={steps} />;
}

/** Where a draft stands: sections written, the check, the modules, the doc. */
export function DraftProgress({ draft, brief }: { draft: Pick<FullDraft, "step" | "sections" | "modules">; brief: FullBrief | null }) {
  const b = brief?.brief;
  const total = b ? b.outline.length + 1 + (b.faqs.length ? 1 : 0) : 0;
  const written = (draft.sections ?? []).filter(Boolean).length;
  const mods = b?.modules.length ?? 0;
  const built = (draft.modules ?? []).filter((m) => m && m.status !== "retry").length;
  const order = ["sections", "check", "modules", "save", "done"];
  const at = order.indexOf(draft.step);
  const steps = [
    { label: "Writing sections", note: total ? `${written} of ${total}` : "", done: at > 0, on: at === 0 },
    { label: "Checking claims against the sources", note: "", done: at > 1, on: at === 1 },
    ...(mods ? [{ label: "Building interactive modules", note: `${built} of ${mods}`, done: at > 2, on: at === 2 }] : []),
    { label: "Saving the draft", note: "", done: at > 3, on: at === 3 },
  ];
  return <Steps steps={steps} />;
}

function Steps({ steps }: { steps: { label: string; note: string; done: boolean; on: boolean }[] }) {
  return (
    <ol className="flex flex-col gap-2.5 border border-rule bg-white p-4" aria-live="polite">
      {steps.map((s) => (
        <li key={s.label} className={`flex items-center gap-3 text-[14px] ${s.on ? "text-ink" : s.done ? "text-body" : "text-muted"}`}>
          <i className={`inline-block h-2 w-2 shrink-0 ${s.done ? "bg-pos" : s.on ? "animate-pulse bg-warn" : "bg-rule"}`} aria-hidden="true" />
          <span className="flex-1">{s.label}</span>
          {s.note ? <span className="aw-num text-[12px] text-muted">{s.note}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/** Regenerate with a one-line note. A draft edited by hand asks before its edits are replaced. */
export function RegenerateDialog({
  auth,
  kind,
  briefId,
  itemId,
  onStarted,
  onClose,
}: {
  auth: RunAuth;
  kind: "brief" | "draft";
  briefId: string;
  itemId: string;
  onStarted: () => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [edited, setEdited] = useState(false);
  async function go(confirm = false) {
    setBusy(true);
    setError("");
    try {
      await post(auth, "/api/agentic-writer", kind === "brief" ? { action: "brief", itemId, note } : { action: "draft", briefId, note, confirm });
      onStarted();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (kind === "draft" && /edited by hand/i.test(message)) setEdited(true);
      else setError(message);
    } finally {
      setBusy(false);
    }
  }
  if (edited)
    return <Confirm title="Replace your edits?" text="This draft was edited by hand. Regenerating writes a new draft over those edits." action="Regenerate" busy={busy} error={error} onConfirm={() => go(true)} onClose={onClose} />;
  return (
    <Modal title={kind === "brief" ? "Regenerate brief" : "Regenerate draft"} onClose={onClose} width="max-w-md">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <label className="flex flex-col gap-1.5 text-[13px] text-body">
          Note
          <input autoFocus value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className="aw-input" placeholder={kind === "brief" ? "More on pricing" : "Shorter intro"} />
        </label>
        {error ? <p className="aw-error">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="aw-btn aw-btn--primary aw-btn--sm" disabled={busy}>
            {busy ? "Starting..." : "Regenerate"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
