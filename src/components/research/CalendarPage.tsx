"use client";

import { DateField, Dropdown } from "../Pickers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";
import type { Site } from "@/lib/db";
import { slots, STAGES, type Stage } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { quietly, recordUndo } from "@/lib/undo";
import { SidePanel, Thinking } from "../ui";
import { CalendarGrid, CalendarList, TopicSidebar } from "./CalendarGrid";
import { ContentPiece, type WriterAccess } from "./ContentPiece";
import { DayPanel } from "./DayPanel";
import { CalendarViewIcon, FIELD, ListViewIcon, ViewSwitch } from "./shared";
import { usePlan } from "./usePlan";

type CalView = "month" | "week" | "list";
const WeekViewIcon = () => (
  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x={3.5} y={5} width={17} height={15} rx={2.5} />
    <path d="M9 5v15M15 5v15" />
  </svg>
);
const VIEWS: { id: CalView; label: string; icon: React.ReactNode }[] = [
  { id: "month", label: "Month", icon: <CalendarViewIcon /> },
  { id: "week", label: "Week", icon: <WeekViewIcon /> },
  { id: "list", label: "List", icon: <ListViewIcon /> },
];
const VIEW_KEY = "arrowsterr.calendarView"; // each person's last view, kept in this browser
const readView = (): CalView => {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "week" || v === "list" ? v : "month";
  } catch {
    return "month";
  }
};
const STAGE_ORDER = (s: Stage | null) => (s ? STAGES.findIndex((x) => x.id === s) : 3);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

/**
 * The Calendar: the Content Plan by date, as a month, a week or a list. Every unscheduled opportunity waits in
 * the sidebar to be dragged onto a day, and Auto-schedule gives them all dates at a set pace.
 */
export function CalendarPage({ sb, auth, site, canEdit, brandName, writer }: { sb: SupabaseClient; auth: RunAuth; site: Site; canEdit: boolean; brandName: string; writer?: WriterAccess }) {
  const { items, error, patch, addOn, remove, toast } = usePlan({ sb, auth, site });
  const [view, setViewState] = useState<CalView>(readView);
  const setView = (v: CalView) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };
  const [perWeek, setPerWeek] = useState(2);
  const [start, setStart] = useState(() => iso(new Date()));
  const [panel, setPanel] = useState<{ day: string | null; piece: string | null } | null>(null);

  if (!items) return <Thinking text="Loading your calendar..." />;

  const undated = items.filter((i) => !i.due_date && i.status !== "published");
  /** Give every unscheduled piece a date, BOFU first and then by volume, at the chosen pace. One step for Undo. */
  async function autoSchedule() {
    const todo = [...undated].sort((a, b) => STAGE_ORDER(a.stage) - STAGE_ORDER(b.stage) || (b.volume ?? 0) - (a.volume ?? 0));
    const dates = slots(parse(start), perWeek, todo.length);
    const before = new Map(todo.map((i) => [i.id, i.due_date]));
    recordUndo({
      label: `scheduling ${todo.length} ${todo.length === 1 ? "piece" : "pieces"}`,
      undo: () => Promise.all(todo.map((i) => patch(i.id, { due_date: before.get(i.id) ?? null }))),
      redo: () => Promise.all(todo.map((i, n) => patch(i.id, { due_date: dates[n] }))),
    });
    await quietly(() => Promise.all(todo.map((i, n) => patch(i.id, { due_date: dates[n] }))));
  }

  const openItem = panel?.piece ? (items.find((i) => i.id === panel.piece) ?? null) : null;
  const move = (id: string, date: string | null) => {
    const was = items.find((i) => i.id === id);
    if (was && was.due_date !== date) patch(id, { due_date: date });
  };
  const open = (id: string) => setPanel({ day: items.find((i) => i.id === id)?.due_date ?? null, piece: id });

  return (
    <div className="flex flex-col gap-5">
      {error ? <p className="aw-error">{error}</p> : null}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-wrap items-center gap-3">
          <h1 className="aw-h2 mb-0!">Calendar</h1>
          <ViewSwitch value={view} onChange={setView} options={VIEWS} />
        </span>
        {canEdit ? (
          <span className="flex flex-wrap items-center gap-2">
            <Dropdown label="Posts per week" value={perWeek} onChange={setPerWeek} className={FIELD} options={[1, 2, 3, 4, 5].map((n) => ({ id: n, label: `${n} per week` }))} />
            <DateField label="Start on" value={start} onChange={(v) => v && setStart(v)} className={FIELD} clearable={false} />
            <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={autoSchedule} disabled={!undated.length}>
              Auto-schedule
            </button>
          </span>
        ) : null}
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {view === "list" ? (
          <CalendarList items={items} onOpen={open} onDay={(day) => setPanel({ day, piece: null })} />
        ) : (
          <CalendarGrid key={view} items={items} mode={view} canEdit={canEdit} onMove={move} onDay={(day) => setPanel({ day, piece: null })} onOpen={open} />
        )}
        <TopicSidebar items={items} canEdit={canEdit} onOpen={open} onMove={move} />
      </div>

      {openItem ? (
        <SidePanel
          title={openItem.keyword}
          kicker={
            panel?.day ? (
              <button type="button" className="aw-text-link" onClick={() => setPanel({ day: panel.day, piece: null })}>
                ← {dayLabel(panel.day)}
              </button>
            ) : (
              "Content piece"
            )
          }
          onClose={() => setPanel(null)}
        >
          <ContentPiece
            key={openItem.id}
            sb={sb}
            auth={auth}
            site={site}
            brandName={brandName}
            item={openItem}
            canEdit={canEdit}
            onPatch={(p) => patch(openItem.id, p)}
            onRemove={() => {
              remove([openItem.id]);
              setPanel(panel?.day ? { day: panel.day, piece: null } : null);
            }}
            writer={writer}
          />
        </SidePanel>
      ) : panel?.day ? (
        <SidePanel title={dayLabel(panel.day)} kicker="Calendar" onClose={() => setPanel(null)}>
          <DayPanel items={items.filter((i) => i.due_date === panel.day)} canEdit={canEdit} onOpen={(id) => setPanel({ day: panel.day, piece: id })} onAdd={(p) => addOn(p.keyword, panel.day, p)} />
        </SidePanel>
      ) : null}
      {toast}
    </div>
  );
}
