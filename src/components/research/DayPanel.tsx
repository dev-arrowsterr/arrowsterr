"use client";

import { useState } from "react";
import type { CalendarItem } from "@/lib/db";
import type { Stage } from "@/lib/research";
import { inWriterAt } from "@/lib/writerImport";
import { STATUSES } from "./ContentPiece";
import { STAGE_COLORS } from "./shared";

export type NewPiece = {
  keyword: string;
  stage?: Stage | null;
  notes?: string | null;
  volume?: number | null;
  kd?: number | null;
  intent?: string | null;
  action?: "new" | "update";
  url?: string | null;
};

/** One day of the editorial calendar: what is planned, each with Import to Agentic Writer, and a box to add a keyword to it. */
export function DayPanel({
  items,
  canEdit,
  onOpen,
  onAdd,
  onImport,
}: {
  items: CalendarItem[];
  canEdit: boolean;
  onOpen: (id: string) => void;
  onAdd: (p: NewPiece) => void;
  onImport?: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");

  return (
    <div className="max-w-2xl">
      <section className="flex flex-col gap-3 p-1">
        <h3 className="aw-h4">Content for this day</h3>
        <ul className="flex flex-col gap-2">
          {items.map((i) => (
            <li key={i.id} className="aw-frame flex items-center gap-2 border-l-4! pr-3" style={{ borderLeftColor: i.stage ? STAGE_COLORS[i.stage] : "var(--aw-faint)" }}>
              <button type="button" onClick={() => onOpen(i.id)} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-brand-pale/60">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[15px] font-medium text-ink">{i.keyword}</span>
                  <span className="text-[12px] text-muted">
                    {STATUSES.find((s) => s.id === i.status)?.label}
                    {i.brief_status === "done" && i.status === "planned" ? " · Brief ready" : i.brief_status === "running" ? " · Brief writing" : ""}
                    {i.volume ? ` · ${i.volume.toLocaleString()}/mo` : ""}
                  </span>
                </span>
                <span className="text-muted" aria-hidden="true">
                  ›
                </span>
              </button>
              {inWriterAt(i) ? (
                <span className="aw-chip aw-chip--brand whitespace-nowrap">In writer</span>
              ) : canEdit && onImport && i.status !== "published" ? (
                <button type="button" className="aw-chip aw-chip--btn whitespace-nowrap" onClick={() => onImport(i.id)}>
                  Import to Agentic Writer
                </button>
              ) : null}
            </li>
          ))}
          {!items.length ? <li className="rounded-aw border border-dashed border-rule px-4 py-5 text-center text-[13px] text-muted">Nothing planned yet</li> : null}
        </ul>
        {canEdit ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = draft.trim().replace(/\s+/g, " ");
              if (v) onAdd({ keyword: v });
              setDraft("");
            }}
          >
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a keyword" aria-label="Add content" className="aw-input h-11! flex-1 py-0!" />
            <button type="submit" className="aw-btn aw-btn--primary h-11! py-0!" disabled={!draft.trim()}>
              Add
            </button>
          </form>
        ) : null}
      </section>

    </div>
  );
}
