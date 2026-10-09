"use client";

import { useState } from "react";
import type { CalendarItem } from "@/lib/db";
import type { Stage } from "@/lib/research";
import { droppedIdea, IdeaList, type AiIdea, type useAiIdeas } from "./AiIdeas";
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
export const ideaPiece = (i: AiIdea): NewPiece => ({
  keyword: i.keyword,
  stage: i.stage,
  notes: [i.why, i.prompt ? `Helps the prompt: ${i.prompt}` : ""].filter(Boolean).join("\n"),
  volume: i.volume,
  kd: i.kd,
  intent: i.intent,
  action: i.action,
  url: i.url,
});

/** One day of the editorial calendar: what is planned, and keyword ideas from AI visibility to drag in. */
export function DayPanel({
  items,
  ideas,
  canEdit,
  onOpen,
  onAdd,
}: {
  items: CalendarItem[];
  ideas: ReturnType<typeof useAiIdeas>;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onAdd: (p: NewPiece) => void;
}) {
  const [draft, setDraft] = useState("");
  const [over, setOver] = useState(false);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section
        className={`flex flex-col gap-3 rounded-aw p-1 ${over ? "bg-brand-pale outline-2 outline-dashed outline-brand" : ""}`}
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const idea = droppedIdea(e);
          if (idea) onAdd(ideaPiece(idea));
        }}
      >
        <h3 className="aw-h4">Content for this day</h3>
        <ul className="flex flex-col gap-2">
          {items.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => onOpen(i.id)}
                className="aw-frame flex w-full items-center gap-3 border-l-4! px-4 py-3 text-left transition-shadow hover:shadow-aw"
                style={{ borderLeftColor: i.stage ? STAGE_COLORS[i.stage] : "var(--aw-faint)" }}
              >
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
            </li>
          ))}
          <li className="rounded-aw border border-dashed border-rule px-4 py-5 text-center text-[13px] text-muted">{canEdit ? "Drop an idea here" : "Nothing planned yet"}</li>
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

      <section className="aw-frame flex flex-col self-start">
        <div className="aw-frame__head">
          <h3 className="aw-h4">Ideas from AI visibility</h3>
        </div>
        <div className="p-4">
          <IdeaList state={ideas} canEdit={canEdit} onAdd={(i) => onAdd(ideaPiece(i))} />
        </div>
      </section>
    </div>
  );
}
