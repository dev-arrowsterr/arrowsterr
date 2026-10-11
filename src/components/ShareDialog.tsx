"use client";

import { useEffect, useState } from "react";
import type { RunAuth } from "@/lib/runner";

type State = { title: string; busy: boolean; url: string; copied: boolean; error: string } | null;

export function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square" aria-hidden="true">
      <path d="M12 3v12M7 8l5-5 5 5M8 11H5v10h14V11h-3" />
    </svg>
  );
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Freeze a page into a share link. The popup opens at once and the link is copied as soon as it is ready. */
export function useShare(auth: RunAuth | null, brandId: string) {
  const [state, setState] = useState<State>(null);

  async function share(title: string, data: object) {
    if (!auth) return;
    setState({ title, busy: true, url: "", copied: false, error: "" });
    try {
      const res = await fetch("/api/reports/share", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` },
        body: JSON.stringify({ workspaceId: auth.workspaceId, brandId, data }),
      });
      const out = await res.json().catch(() => ({ error: `The server returned ${res.status}.` }));
      if (!res.ok) throw new Error(out.error || `Error ${res.status}`);
      const copied = await copy(out.url);
      setState((s) => s && { ...s, busy: false, url: out.url, copied });
    } catch (e) {
      setState((s) => s && { ...s, busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const dialog = state ? <ShareDialog state={state} onCopied={(ok) => setState((s) => s && { ...s, copied: ok })} onClose={() => setState(null)} /> : null;
  return { share, dialog, busy: Boolean(state?.busy) };
}

function ShareDialog({ state, onCopied, onClose }: { state: NonNullable<State>; onCopied: (ok: boolean) => void; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(16,20,30,0.45)] p-4 print:hidden" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Share ${state.title}`} onClick={(e) => e.stopPropagation()} className="aw-frame flex w-full max-w-lg flex-col gap-4 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="aw-h4">Share {state.title}</h2>
            <p className="aw-small">Anyone with the link can view this report and save it as a PDF. It shows the numbers as they are right now.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="px-1 text-[24px] leading-none text-body hover:text-ink">
            ×
          </button>
        </div>
        {state.error ? (
          <p className="aw-error">{state.error}</p>
        ) : (
          <div className="flex items-center gap-2">
            <input readOnly value={state.busy ? "Creating link..." : state.url} aria-label="Share link" onFocus={(e) => e.target.select()} className="aw-input min-w-0 flex-1 py-2! text-[14px]!" />
            <button
              type="button"
              className="aw-btn aw-btn--primary aw-btn--sm shrink-0"
              disabled={state.busy}
              onClick={async () => onCopied(await copy(state.url))}
            >
              {state.copied ? "Copied" : "Copy link"}
            </button>
          </div>
        )}
        {state.url ? (
          <div className="flex items-center justify-between gap-3">
            <span className={`text-[13px] ${state.copied ? "text-pos" : "text-muted"}`}>{state.copied ? "✓ Link copied to your clipboard" : "Click Copy link to copy it"}</span>
            <a href={state.url} target="_blank" rel="noopener noreferrer" className="text-[13px]">
              Open link ↗
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}
