"use client";

import { Dropdown } from "../Pickers";
import { useState } from "react";
import type { CalendarItem } from "@/lib/db";
import { Pop } from "../Sheet";
import { byStage, STAGE_COLORS, statusLabel } from "./shared";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** The Monday on or before a day. */
const mondayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));

/** One page as a card you can drag to another day: the keyword, its search volume and where it stands. */
export function Chip({ item, onOpen, canDrag = true, showDate = false }: { item: CalendarItem; onOpen: () => void; canDrag?: boolean; showDate?: boolean }) {
  return (
    <button
      type="button"
      draggable={canDrag}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", item.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOpen}
      title={item.keyword}
      className="aw-cal-card"
      style={{ ["--stage" as string]: item.stage ? STAGE_COLORS[item.stage] : "var(--aw-faint)" }}
    >
      <span className={`aw-cal-card__kw ${item.status === "published" ? "is-done" : ""}`}>{item.keyword}</span>
      <span className="aw-cal-card__foot">
        <span className="aw-cal-card__vol">{item.volume === null || item.volume === undefined ? "–" : `${item.volume.toLocaleString("en-US")}/mo`}</span>
        <span className="flex items-center gap-1.5">
          {showDate && item.due_date ? <span className="aw-num text-[11px] text-muted">{new Date(`${item.due_date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span> : null}
          <span className={`aw-cal-card__st aw-cal-card__st--${item.status === "planned" && !item.due_date ? "idea" : item.status}`}>{statusLabel(item)}</span>
        </span>
      </span>
    </button>
  );
}

/** Drag targets: a day takes a piece and gives it that date; the sidebar (null) takes it back to unscheduled. */
function useDrop(canEdit: boolean, onMove: (id: string, date: string | null) => void) {
  const [over, setOver] = useState<string | null>(null);
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
      const id = e.dataTransfer.getData("text/plain");
      if (id) onMove(id, date);
    },
  });
  return { over, drop };
}

/**
 * The Editorial Calendar as a month or a week of days. Drag a piece to another day to move it, or onto a day
 * from the sidebar to schedule it. Click a day to open it.
 */
export function CalendarGrid({
  items,
  mode = "month",
  canEdit,
  onMove,
  onDay,
  onOpen,
  toolbar,
}: {
  items: CalendarItem[];
  mode?: "month" | "week";
  canEdit: boolean;
  onMove: (id: string, date: string | null) => void;
  onDay: (date: string) => void;
  onOpen: (id: string) => void;
  /** Anything to show before the title, like the sample's List and Calendar switch. */
  toolbar?: React.ReactNode;
}) {
  const [cursor, setCursor] = useState(() => new Date());
  const { over, drop } = useDrop(canEdit, onMove);

  const month = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const first = mode === "week" ? mondayOf(cursor) : mondayOf(month);
  const weeks = mode === "week" ? 1 : Math.ceil((((month.getDay() + 6) % 7) + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
  const today = iso(new Date());
  const byDay = new Map<string, CalendarItem[]>();
  for (const i of [...items].sort(byStage)) if (i.due_date) byDay.set(i.due_date, [...(byDay.get(i.due_date) ?? []), i]);
  const shift = (n: number) => setCursor(mode === "week" ? new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7 * n) : new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));
  const last = days[days.length - 1];
  const title =
    mode === "month"
      ? month.toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : `${first.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${last.toLocaleDateString("en-US", { month: first.getMonth() === last.getMonth() ? undefined : "short", day: "numeric", year: "numeric" })}`;

  return (
    <section className="aw-frame min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <span className="flex flex-wrap items-center gap-3">
          {toolbar}
          <h3 className="aw-h4">{title}</h3>
        </span>
        <span className="flex items-center gap-1">
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => shift(-1)} aria-label={mode === "week" ? "Previous week" : "Previous month"}>
            ‹
          </button>
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setCursor(new Date())}>
            Today
          </button>
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => shift(1)} aria-label={mode === "week" ? "Next week" : "Next month"}>
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
          const inMonth = mode === "week" || d.getMonth() === month.getMonth();
          return (
            <div
              key={key}
              {...drop(key)}
              onClick={() => onDay(key)}
              className={`group flex ${mode === "week" ? "min-h-[60vh]" : "min-h-28"} min-w-0 flex-col gap-1 border-r border-b border-rule-faint p-1.5 [&:nth-child(7n)]:border-r-0 ${inMonth ? "bg-white" : "bg-paper"} ${over === key ? "bg-brand-pale! outline-2 -outline-offset-2 outline-brand" : ""} cursor-pointer hover:bg-brand-pale/60`}
            >
              <span className="flex items-center justify-between">
                <span className={`aw-num text-[12px] ${key === today ? "bg-brand px-1.5 text-white" : inMonth ? "text-ink" : "text-faint"}`}>{d.getDate()}</span>
              </span>
              {list.map((i) => (
                <span key={i.id} onClick={(e) => e.stopPropagation()}>
                  <Chip item={i} onOpen={() => onOpen(i.id)} canDrag={canEdit} />
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

type Stage3 = "bofu" | "mofu" | "tofu" | "none";
type Range = { min: string; max: string };
type SideFilter = { stage: Stage3[]; vol: Range; kd: Range; theme: string };
const ALL_STAGES: Stage3[] = ["bofu", "mofu", "tofu", "none"];
const START: SideFilter = { stage: ALL_STAGES, vol: { min: "", max: "" }, kd: { min: "", max: "" }, theme: "" };
const stageOf = (i: CalendarItem): Stage3 => i.stage ?? "none";
const num = (s: string) => (s.trim() ? Number(s.replace(/[,\s]/g, "")) : null);
const inRange = (v: number | null, r: Range) => {
  const lo = num(r.min);
  const hi = num(r.max);
  if (lo === null && hi === null) return true;
  return v !== null && (lo === null || v >= lo) && (hi === null || v <= hi);
};
const ranged = (r: Range) => Boolean(r.min.trim() || r.max.trim());

/**
 * Every unscheduled opportunity, to search, filter by stage, volume, difficulty and theme, and drag onto a day.
 * Dropping a scheduled piece here takes its date away.
 */
export function TopicSidebar({ items, canEdit, onOpen, onMove }: { items: CalendarItem[]; canEdit: boolean; onOpen: (id: string) => void; onMove: (id: string, date: string | null) => void }) {
  const [f, setF] = useState<SideFilter>(START);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [q, setQ] = useState("");
  const { over, drop } = useDrop(canEdit, onMove);

  const open = items.filter((i) => !i.due_date && i.status !== "published");
  const list = open
    .filter((i) => f.stage.includes(stageOf(i)))
    .filter((i) => inRange(i.volume, f.vol) && inRange(i.difficulty, f.kd))
    .filter((i) => !f.theme || i.theme === f.theme)
    .filter((i) => !q.trim() || i.keyword.toLowerCase().includes(q.trim().toLowerCase()))
    .sort(byStage);
  const active = (f.stage.length !== ALL_STAGES.length ? 1 : 0) + (ranged(f.vol) ? 1 : 0) + (ranged(f.kd) ? 1 : 0) + (f.theme ? 1 : 0);
  const themes = [...new Set(open.map((i) => i.theme).filter((t): t is string => Boolean(t)))].sort();

  return (
    <aside {...drop(null)} className={`aw-frame flex max-h-[calc(100vh-160px)] min-h-80 flex-col xl:sticky xl:top-16 ${over === "tray" ? "outline-2 -outline-offset-2 outline-brand" : ""}`}>
      <div className="flex flex-col gap-2 border-b border-rule px-3 pt-3 pb-3">
        <h3 className="aw-h4">Unscheduled</h3>
        <div className="flex items-center gap-1.5">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search topics" className="aw-pop__field min-w-0 flex-1" />
          <button type="button" className={`aw-bank__filter ${active ? "is-on" : ""}`} aria-haspopup="dialog" aria-expanded={Boolean(menu)} onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
              <path d="M3 5h18l-7 8v6l-4-2v-4z" />
            </svg>
            Filter{active ? ` · ${active}` : ""}
          </button>
        </div>
      </div>
      <div className="flex min-h-24 flex-col gap-1.5 overflow-y-auto p-3">
        {list.map((i) => (
          <Chip key={i.id} item={i} onOpen={() => onOpen(i.id)} canDrag={canEdit} />
        ))}
        {!list.length ? <p className="py-6 text-center text-[13px] text-muted">{active || q ? "No topics match" : "Every topic has a date"}</p> : null}
      </div>
      {menu ? <SideMenu anchor={menu} themes={themes} value={f} onApply={setF} onClose={() => setMenu(null)} /> : null}
    </aside>
  );
}

/** The sidebar's filter menu: stage, search volume, difficulty and theme. */
function SideMenu({ anchor, themes, value, onApply, onClose }: { anchor: DOMRect; themes: string[]; value: SideFilter; onApply: (f: SideFilter) => void; onClose: () => void }) {
  const [d, setD] = useState<SideFilter>(value);
  const flip = (s: Stage3) => setD((x) => ({ ...x, stage: x.stage.includes(s) ? x.stage.filter((y) => y !== s) : [...x.stage, s] }));
  const range = (k: "vol" | "kd", label: string) => (
    <div className="flex flex-col gap-1 px-3 pb-2">
      <span className="aw-label">{label}</span>
      <span className="flex items-center gap-1.5">
        <input inputMode="numeric" value={d[k].min} onChange={(e) => setD((x) => ({ ...x, [k]: { ...x[k], min: e.target.value } }))} placeholder="Min" aria-label={`${label} from`} className="aw-pop__field min-w-0 flex-1" />
        <span className="text-[12px] text-muted">–</span>
        <input inputMode="numeric" value={d[k].max} onChange={(e) => setD((x) => ({ ...x, [k]: { ...x[k], max: e.target.value } }))} placeholder="Max" aria-label={`${label} to`} className="aw-pop__field min-w-0 flex-1" />
      </span>
    </div>
  );
  return (
    <Pop anchor={anchor} onClose={onClose} label="Filter topics" width={290}>
      <div className="flex flex-col pt-2">
        <div className="flex flex-col gap-1 px-3 pb-2">
          <span className="aw-label">Stage</span>
          {ALL_STAGES.map((s) => (
            <label key={s} className="aw-pop__check-row">
              <input type="checkbox" checked={d.stage.includes(s)} onChange={() => flip(s)} />
              <span className="flex flex-1 items-center gap-1.5">
                {s === "none" ? (
                  <span className="text-muted">(Blanks)</span>
                ) : (
                  <>
                    <i className="inline-block h-2.5 w-[3px]" style={{ background: STAGE_COLORS[s] }} />
                    {s.toUpperCase()}
                  </>
                )}
              </span>
            </label>
          ))}
        </div>
        {range("vol", "Volume")}
        {range("kd", "Difficulty")}
        <div className="flex flex-col gap-1 px-3 pb-2">
          <span className="aw-label">Theme</span>
          <Dropdown label="Theme" value={d.theme} onChange={(theme) => setD((x) => ({ ...x, theme }))} className="aw-pop__field" options={[{ id: "", label: "Any theme" }, ...themes.map((t) => ({ id: t, label: t }))]} />
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 border-t border-rule-faint px-3 pt-3 pb-1">
          <button type="button" className="aw-text-link text-[12px]" onClick={() => setD(START)}>
            Reset
          </button>
          <span className="flex gap-2">
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="aw-btn aw-btn--primary aw-btn--sm"
              disabled={!d.stage.length}
              onClick={() => {
                onApply(d);
                onClose();
              }}
            >
              OK
            </button>
          </span>
        </div>
      </div>
    </Pop>
  );
}
