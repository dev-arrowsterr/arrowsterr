"use client";

import { useEffect } from "react";

/** The app's dialog, in place of the browser's. Escape or a click outside closes it. */
export function Modal({ title, onClose, children, width = "max-w-lg" }: { title: string; onClose: () => void; children: React.ReactNode; width?: string }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(16,20,30,0.45)] p-4 print:hidden" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()} className={`aw-frame flex max-h-[90vh] w-full ${width} flex-col gap-4 overflow-y-auto bg-white p-6`}>
        <div className="flex items-start justify-between gap-4">
          <h2 className="aw-h4">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="px-1 text-[24px] leading-none text-body hover:text-ink">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Ask before something that can't be undone. */
export function Confirm({ title, text, action, busy, error, onConfirm, onClose }: { title: string; text: string; action: string; busy?: boolean; error?: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} width="max-w-md">
      <p className="text-[14px] text-body">{text}</p>
      {error ? <p className="aw-error">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onClose}>
          Cancel
        </button>
        <button type="button" autoFocus className="aw-btn aw-btn--primary aw-btn--sm border-neg! bg-neg!" disabled={busy} onClick={onConfirm}>
          {busy ? "Working..." : action}
        </button>
      </div>
    </Modal>
  );
}
