"use client";

import { useState } from "react";
import { droppedIdea, IdeaList, type AiIdea, type useAiIdeas } from "./AiIdeas";
import type { CalendarItem } from "@/lib/db";
import { STAGE_COLORS } from "./shared";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const STATUS_MARK: Record<CalendarItem["status"], string> = { planned: "○", brief: "◐", writing: "◑", published: "●" };

/** One page as a card you can drag to another day. */
function Chip({ item, onOpen }: { item: CalendarItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", item.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOpen}
      title={`${item.keyword} · ${item.status}`}
      className={`flex w-full cursor-grab items-center gap-1.5 border-l-[3px] bg-white px-1.5 py-1 text-left text-[12px] leading-tight shadow-[0_0_0_1px_var(--aw-rule)] hover:shadow-[0_0_0_1px_var(--aw-ink)] active:cursor-grabbing ${item.status === "published" ? "text-muted line-through" : "text-ink"}`}
      style={{ borderLeftColor: item.stage ? STAGE_COLORS[item.stage] : "var(--aw-faint)" }}
    >
      <span aria-hidden="true" className="shrink-0 text-[10px] text-muted">
        {STATUS_MARK[item.status]}
      </span>
      <span className="truncate">{item.keyword}</span>
    </button>
  );
}

/** A month of pages. Drag a page to a day to move it, or from the side list to schedule it. Click a day to open it. */
export function CalendarGrid({
  items,
  canEdit,
  onMove,
  onDay,
  ideas,
  onIdea,
  onOpen,
  onAutoSchedule,
}: {
  items: CalendarItem[];
  canEdit: boolean;
  onMove: (id: string, date: string | null) => void;
  onDay: (date: string) => void;
  ideas: ReturnType<typeof useAiIdeas>;
  onIdea: (idea: AiIdea, date: string | null) => void;
  onOpen: (id: string) => void;
  onAutoSchedule: () => void;
}) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [over, setOver] = useState<string | null>(null);
  const [side, setSide] = useState<"unscheduled" | "ideas">("unscheduled");

  const first = new Date(month);
  first.setDate(1 - ((month.getDay() + 6) % 7)); // back to Monday
  const weeks = Math.ceil((((month.getDay() + 6) % 7) + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    return d;
  });
  const today = iso(new Date());
  const byDay = new Map<string, CalendarItem[]>();
  for (const i of items) if (i.due_date) byDay.set(i.due_date, [...(byDay.get(i.due_date) ?? []), i]);
  const unscheduled = items.filter((i) => !i.due_date && i.status !== "published");
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  const drop = (date: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!canEdit) return;
      e.preventDefault();
      setOver(date ?? "tray");
    },
    onDragLeave: () => setOver(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(null);
      if (!canEdit) return;
      const idea = droppedIdea(e);
      if (idea) return onIdea(idea, date);
      const id = e.dataTransfer.getData("text/plain");
      if (id) onMove(id, date);
    },
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="aw-frame min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
          <h3 className="aw-h4">{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h3>
          <span className="flex items-center gap-1">
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => shift(-1)} aria-label="Previous month">
              ‹
            </button>
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
              Today
            </button>
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => shift(1)} aria-label="Next month">
              ›
            </button>
          </span>
        </div>
        <div className="grid grid-cols-7 border-b border-rule-faint bg-surface-2">
          {WEEKDAYS.map((d) => (
            <span key={d} className="aw-label px-2 py-1.5">
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const key = iso(d);
            const list = byDay.get(key) ?? [];
            const inMonth = d.getMonth() === month.getMonth();
            return (
              <div
                key={key}
                {...drop(key)}
                onClick={() => onDay(key)}
                className={`group flex min-h-28 flex-col gap-1 border-r border-b border-rule-faint p-1.5 [&:nth-child(7n)]:border-r-0 ${inMonth ? "bg-white" : "bg-paper"} ${over === key ? "bg-brand-pale! outline-2 -outline-offset-2 outline-brand" : ""} cursor-pointer hover:bg-brand-pale/60`}
              >
                <span className="flex items-center justify-between">
                  <span className={`aw-num text-[12px] ${key === today ? "bg-brand px-1.5 text-white" : inMonth ? "text-ink" : "text-faint"}`}>{d.getDate()}</span>
                  <span className="text-[13px] leading-none text-faint opacity-0 group-hover:opacity-100">Open ›</span>
                </span>
                {list.map((i) => (
                  <span key={i.id} onClick={(e) => e.stopPropagation()}>
                    <Chip item={i} onOpen={() => onOpen(i.id)} />
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </section>

      <aside {...drop(null)} className={`aw-frame flex max-h-[760px] flex-col ${over === "tray" ? "outline-2 -outline-offset-2 outline-brand" : ""}`}>
        <div className="flex items-center gap-1 border-b border-rule px-2 pt-2" role="tablist" aria-label="Side list">
          {(
            [
              { id: "unscheduled", label: `Unscheduled ${unscheduled.length}` },
              { id: "ideas", label: "✦ AI ideas" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={side === t.id}
              onClick={() => setSide(t.id)}
              className={`-mb-px rounded-none border-b-2 px-3 py-2 text-[14px] ${side === t.id ? "border-brand font-medium text-brand" : "border-transparent text-body hover:text-ink"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {side === "unscheduled" ? (
          <>
            {canEdit && unscheduled.length ? (
              <div className="px-3 pt-3">
                <button type="button" className="aw-btn aw-btn--primary aw-btn--sm w-full" onClick={onAutoSchedule}>
                  Schedule all
                </button>
              </div>
            ) : null}
            <div className="flex min-h-24 flex-col gap-1.5 overflow-y-auto p-3">
              {unscheduled.map((i) => (
                <Chip key={i.id} item={i} onOpen={() => onOpen(i.id)} />
              ))}
            </div>
          </>
        ) : (
          <div className="min-h-24 overflow-y-auto p-3">
            <IdeaList state={ideas} canEdit={canEdit} onAdd={(i) => onIdea(i, null)} addLabel="+" compact />
          </div>
        )}
        <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 border-t border-rule-faint px-4 py-2.5 text-[12px] text-body">
          {(["bofu", "mofu", "tofu"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <i className="inline-block h-2.5 w-[3px]" style={{ background: STAGE_COLORS[s] }} />
              {s.toUpperCase()}
            </span>
          ))}
        </div>
      </aside>
    </div>
  );
}
