"use client";

import { Dropdown } from "../Pickers";
import { useState } from "react";
import type { CalendarItem } from "@/lib/db";
import { Pop } from "../Sheet";
import { byStage, STAGE_COLORS, statusLabel } from "./shared";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;


/** One page as a card you can drag to another day: the keyword, its search volume and where it stands. */
function Chip({ item, onOpen, canDrag = true, showDate = false }: { item: CalendarItem; onOpen: () => void; canDrag?: boolean; showDate?: boolean }) {
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

/**
 * The Editorial Calendar: a month of pages, and the Topic Bank on the side: every piece, filtered by intent,
 * scheduled or not, and search volume.
 * Drag an idea onto a day to schedule it (its status turns Planned), drag a page to another day to move it,
 * or back to the side to make it an idea again. Click a day to open it.
 */
export function CalendarGrid({
  items,
  canEdit,
  onMove,
  onDay,
  onOpen,
  onAutoSchedule,
  toolbar,
}: {
  items: CalendarItem[];
  canEdit: boolean;
  onMove: (id: string, date: string | null) => void;
  onDay: (date: string) => void;
  onOpen: (id: string) => void;
  onAutoSchedule?: () => void;
  /** The List and Calendar switch, at the start of the header. */
  toolbar?: React.ReactNode;
}) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [over, setOver] = useState<string | null>(null);

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
  for (const i of [...items].sort(byStage)) if (i.due_date) byDay.set(i.due_date, [...(byDay.get(i.due_date) ?? []), i]);
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
      const id = e.dataTransfer.getData("text/plain");
      if (id) onMove(id, date);
    },
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="aw-frame min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
          <span className="flex flex-wrap items-center gap-3">
            {toolbar}
            <h3 className="aw-h4">{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h3>
          </span>
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

      <aside {...drop(null)} className={`aw-frame flex max-h-[860px] flex-col ${over === "tray" ? "outline-2 -outline-offset-2 outline-brand" : ""}`}>
        <TopicBank items={items} canEdit={canEdit} onOpen={onOpen} onAutoSchedule={onAutoSchedule} />
      </aside>
    </div>
  );
}

type Stage3 = "bofu" | "mofu" | "tofu" | "none";
type VolOp = "any" | "gte" | "lte" | "between";
type BankFilter = { when: ("unscheduled" | "scheduled")[]; intent: Stage3[]; vol: { op: VolOp; a: string; b: string }; sort: "stage" | "volume" | "az" };
const ALL_INTENTS: Stage3[] = ["bofu", "mofu", "tofu", "none"];
const START: BankFilter = { when: ["unscheduled"], intent: ALL_INTENTS, vol: { op: "any", a: "", b: "" }, sort: "stage" };
const stageOf = (i: CalendarItem): Stage3 => i.stage ?? "none";
const volOk = (v: number, f: BankFilter["vol"]) => {
  const a = Number(f.a.replace(/[,\s]/g, "")) || 0;
  const b = Number(f.b.replace(/[,\s]/g, "")) || 0;
  return f.op === "gte" ? v >= a : f.op === "lte" ? v <= a : f.op === "between" ? v >= a && v <= (b || Infinity) : true;
};

/** The Topic Bank: every piece of the Content Plan, to search, filter like a sheet, and drag onto the calendar. */
function TopicBank({ items, canEdit, onOpen, onAutoSchedule }: { items: CalendarItem[]; canEdit: boolean; onOpen: (id: string) => void; onAutoSchedule?: () => void }) {
  const [f, setF] = useState<BankFilter>(START);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [q, setQ] = useState("");

  const live = items.filter((i) => i.status !== "published");
  const list = live
    .filter((i) => f.when.includes(i.due_date ? "scheduled" : "unscheduled"))
    .filter((i) => f.intent.includes(stageOf(i)))
    .filter((i) => volOk(i.volume ?? 0, f.vol))
    .filter((i) => !q.trim() || i.keyword.toLowerCase().includes(q.trim().toLowerCase()))
    .sort(f.sort === "volume" ? (a, b) => (b.volume ?? 0) - (a.volume ?? 0) : f.sort === "az" ? (a, b) => a.keyword.localeCompare(b.keyword) : byStage);
  // How many filters differ from the start: unscheduled topics, every intent, any volume.
  const active = (f.when.length !== 1 || f.when[0] !== "unscheduled" ? 1 : 0) + (f.intent.length !== ALL_INTENTS.length ? 1 : 0) + (f.vol.op !== "any" ? 1 : 0);
  const onlyUnscheduled = f.when.length === 1 && f.when[0] === "unscheduled";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-rule px-3 pt-3 pb-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="aw-h4">Topic Bank</h3>
          <span className="aw-num text-[12px] text-muted">
            {list.length} of {live.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search topics" aria-label="Search topics" className="aw-pop__field min-w-0 flex-1" />
          <button
            type="button"
            className={`aw-bank__filter ${active ? "is-on" : ""}`}
            aria-haspopup="dialog"
            aria-expanded={Boolean(menu)}
            onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}
            title="Sort and filter"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
              <path d="M3 5h18l-7 8v6l-4-2v-4z" />
            </svg>
            Filter{active ? ` · ${active}` : ""}
          </button>
        </div>
        <p className="text-[12px] text-muted">
          {onlyUnscheduled ? "Unscheduled" : f.when.length === 2 ? "All topics" : "Scheduled"}
          {f.intent.length !== ALL_INTENTS.length ? ` · ${f.intent.filter((x) => x !== "none").map((x) => x.toUpperCase()).join(", ") || "No intent"}` : ""}
          {f.vol.op !== "any" ? ` · ${f.vol.op === "gte" ? `${f.vol.a}+` : f.vol.op === "lte" ? `up to ${f.vol.a}` : `${f.vol.a} to ${f.vol.b}`} / mo` : ""}
          {" · "}
          {f.sort === "stage" ? "BOFU first" : f.sort === "volume" ? "most searched" : "A to Z"}
          {canEdit && onlyUnscheduled && list.length && onAutoSchedule ? (
            <>
              {" · "}
              <button type="button" className="aw-text-link text-[12px]" onClick={onAutoSchedule}>
                Schedule all
              </button>
            </>
          ) : null}
        </p>
      </div>
      <div className="flex min-h-24 flex-col gap-1.5 overflow-y-auto p-3">
        {list.map((i) => (
          <Chip key={i.id} item={i} onOpen={() => onOpen(i.id)} canDrag={canEdit} showDate={Boolean(i.due_date)} />
        ))}
        {!list.length ? <p className="py-6 text-center text-[13px] text-muted">{active || q ? "No topics match these filters." : "Every topic has a date."}</p> : null}
        {list.length ? <p className="pt-1 text-center text-[11px] text-faint">Drag a topic onto a day. Drag a page back here to unschedule it.</p> : null}
      </div>
      {menu ? <BankMenu anchor={menu} items={live} value={f} onApply={setF} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

/** The Topic Bank's one menu, like a column menu in Google Sheets: sort, then filter by schedule, intent and search volume. */
function BankMenu({ anchor, items, value, onApply, onClose }: { anchor: DOMRect; items: CalendarItem[]; value: BankFilter; onApply: (f: BankFilter) => void; onClose: () => void }) {
  const [d, setD] = useState<BankFilter>(value);
  const [open, setOpen] = useState<Record<string, boolean>>({ when: true, intent: true, vol: value.vol.op !== "any" });
  const n = (fn: (i: CalendarItem) => boolean) => items.filter(fn).length;
  const flipIn = <K extends "when" | "intent">(k: K, v: BankFilter[K][number]) =>
    setD((x) => ({ ...x, [k]: (x[k] as string[]).includes(v) ? (x[k] as string[]).filter((y) => y !== v) : [...x[k], v] }));
  const section = (id: string, title: string, body: React.ReactNode, on: boolean) => (
    <>
      <button type="button" className="aw-pop__item" aria-expanded={Boolean(open[id])} onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}>
        <span className="text-[10px] text-muted">{open[id] ? "▼" : "▶"}</span>
        {title}
        {on ? <span className="aw-pop__dot" /> : null}
      </button>
      {open[id] ? <div className="flex flex-col gap-1 px-3 pb-2">{body}</div> : null}
    </>
  );
  const check = (label: React.ReactNode, on: boolean, flip: () => void, count: number) => (
    <label className="aw-pop__check-row">
      <input type="checkbox" checked={on} onChange={flip} />
      <span className="flex flex-1 items-center gap-1.5">{label}</span>
      <span className="aw-num text-[11px] text-muted">{count}</span>
    </label>
  );
  const sortItem = (id: BankFilter["sort"], label: string) => (
    <button type="button" className="aw-pop__item" onClick={() => setD((x) => ({ ...x, sort: id }))}>
      {label}
      {d.sort === id ? <span className="ml-auto text-pos">✓</span> : null}
    </button>
  );
  return (
    <Pop anchor={anchor} onClose={onClose} label="Sort and filter topics" width={290}>
      <div className="flex flex-col">
        {sortItem("stage", "Sort BOFU first")}
        {sortItem("volume", "Sort by most searched")}
        {sortItem("az", "Sort A to Z")}
        <span className="my-1 border-t border-rule-faint" />
        {section(
          "when",
          "Filter by schedule",
          <>
            {check("Unscheduled", d.when.includes("unscheduled"), () => flipIn("when", "unscheduled"), n((i) => !i.due_date))}
            {check("Scheduled", d.when.includes("scheduled"), () => flipIn("when", "scheduled"), n((i) => Boolean(i.due_date)))}
          </>,
          d.when.length !== 1 || d.when[0] !== "unscheduled",
        )}
        {section(
          "intent",
          "Filter by intent",
          <>
            <span className="flex gap-1 text-[12px]">
              <button type="button" className="aw-text-link text-[12px]" onClick={() => setD((x) => ({ ...x, intent: ALL_INTENTS }))}>
                Select all
              </button>
              <span className="text-muted">·</span>
              <button type="button" className="aw-text-link text-[12px]" onClick={() => setD((x) => ({ ...x, intent: [] }))}>
                Clear
              </button>
            </span>
            {ALL_INTENTS.map((s) =>
              check(
                s === "none" ? <span className="text-muted">(Blanks)</span> : (
                  <>
                    <i className="inline-block h-2.5 w-[3px]" style={{ background: STAGE_COLORS[s] }} />
                    {s.toUpperCase()}
                  </>
                ),
                d.intent.includes(s),
                () => flipIn("intent", s),
                n((i) => stageOf(i) === s),
              ),
            )}
          </>,
          d.intent.length !== ALL_INTENTS.length,
        )}
        {section(
          "vol",
          "Filter by search volume",
          <>
            <Dropdown<VolOp> label="Search volume condition" value={d.vol.op} onChange={(op) => setD((x) => ({ ...x, vol: { ...x.vol, op } }))} className="aw-pop__field" options={[{ id: "any", label: "Any volume" }, { id: "gte", label: "Greater than or equal to" }, { id: "lte", label: "Less than or equal to" }, { id: "between", label: "Is between" }]} />
            {d.vol.op !== "any" ? (
              <span className="flex items-center gap-1.5">
                <input autoFocus inputMode="numeric" value={d.vol.a} onChange={(e) => setD((x) => ({ ...x, vol: { ...x.vol, a: e.target.value } }))} placeholder="e.g. 100" aria-label="Volume" className="aw-pop__field" />
                {d.vol.op === "between" ? (
                  <>
                    <span className="text-[12px] text-muted">and</span>
                    <input inputMode="numeric" value={d.vol.b} onChange={(e) => setD((x) => ({ ...x, vol: { ...x.vol, b: e.target.value } }))} placeholder="e.g. 5000" aria-label="Volume up to" className="aw-pop__field" />
                  </>
                ) : null}
              </span>
            ) : null}
          </>,
          d.vol.op !== "any",
        )}
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
              disabled={!d.when.length || !d.intent.length}
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
