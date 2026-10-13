"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { quietly, recordUndo } from "@/lib/undo";
import { sortRows, useSort, type Sort } from "./ui";

// A spreadsheet that works like Google Sheets.
// Click a cell to edit it. Lists and dates open a picker in Arrowsterr's style.
// Click a column name to sort it, and again to flip the order. The funnel beside it filters by condition or by values.
// With pageSize, rows come in pages with a rows-per-page picker.
// The keyboard works like Sheets: arrows, Tab, Enter, Home, End, Page Up and Down, Shift to select a range,
// Ctrl or Cmd with C, X, V, Z and A, Delete to clear, and Shift+Space to pick rows.
// Show, hide, move and resize columns. The layout is saved per sheet in this browser.

type Value = string | number | null | undefined;
export type Option = {
  id: string;
  label: string;
  /** Other words that mean this option when pasted. */ aliases?: string[];
  /** A status class for the chip. */ tone?: string;
};
export type Edit<T> = {
  kind: "text" | "number" | "date" | "select";
  options?: Option[];
  /** The value the editor starts with. Defaults to the column value. */
  value?: (row: T) => string;
  save: (row: T, value: string | null) => void;
};
export type Col<T> = {
  id: string;
  label: string;
  type: "text" | "number" | "list" | "date";
  value: (row: T) => Value;
  cell?: (row: T) => React.ReactNode;
  /** What the column's header shows, like a logo and a name. Defaults to label. */
  head?: React.ReactNode;
  width?: number;
  /** Choices for a list filter. Defaults to every value in the column. */
  options?: string[];
  /** Click the cell to edit it. */
  edit?: Edit<T>;
  /** A column the user added, which they can delete. */
  onRemove?: () => void;
};
type Layout = {
  hidden: string[];
  order: string[];
  widths: Record<string, number>;
};
const EMPTY: Layout = { hidden: [], order: [], widths: {} };
const KEY = (id: string) => `arrowsterr.sheet.${id}`;

function readLayout(id?: string): Layout {
  if (!id) return EMPTY;
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY(id)) ?? "{}") };
  } catch {
    return EMPTY;
  }
}

const show = (v: Value) => (v === null || v === undefined || v === "" ? <span className="text-muted">–</span> : typeof v === "number" ? v.toLocaleString("en-US") : v);
const keyOf = (v: Value) => (v === null || v === undefined ? "" : String(v));
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ── Filters, the way Google Sheets does them ──

type CondOp =
  | "empty"
  | "notEmpty"
  | "contains"
  | "notContains"
  | "starts"
  | "ends"
  | "exactly"
  | "dateIs"
  | "dateBefore"
  | "dateAfter"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "eq"
  | "neq"
  | "between"
  | "notBetween";
const CONDS: { id: CondOp; label: string; args: 0 | 1 | 2 }[] = [
  { id: "empty", label: "Is empty", args: 0 },
  { id: "notEmpty", label: "Is not empty", args: 0 },
  { id: "contains", label: "Text contains", args: 1 },
  { id: "notContains", label: "Text does not contain", args: 1 },
  { id: "starts", label: "Text starts with", args: 1 },
  { id: "ends", label: "Text ends with", args: 1 },
  { id: "exactly", label: "Text is exactly", args: 1 },
  { id: "dateIs", label: "Date is", args: 1 },
  { id: "dateBefore", label: "Date is before", args: 1 },
  { id: "dateAfter", label: "Date is after", args: 1 },
  { id: "gt", label: "Greater than", args: 1 },
  { id: "gte", label: "Greater than or equal to", args: 1 },
  { id: "lt", label: "Less than", args: 1 },
  { id: "lte", label: "Less than or equal to", args: 1 },
  { id: "eq", label: "Is equal to", args: 1 },
  { id: "neq", label: "Is not equal to", args: 1 },
  { id: "between", label: "Is between", args: 2 },
  { id: "notBetween", label: "Is not between", args: 2 },
];
type Cond = { op: CondOp; a: string; b: string };
type Filter = { cond?: Cond; vals?: string[] };

function condMatch(v: Value, c: Cond): boolean {
  const s = keyOf(v);
  const t = s.toLowerCase();
  const a = c.a.trim().toLowerCase();
  const num = (x: string) => Number(x.replace(/[,\s$%#]/g, ""));
  const n = typeof v === "number" ? v : num(s);
  const cmp = (x: string) => (typeof v === "number" || (s !== "" && !Number.isNaN(n) && !/^\d{4}-\d{2}-\d{2}/.test(s)) ? n - num(x) : s.localeCompare(x));
  switch (c.op) {
    case "empty":
      return s === "";
    case "notEmpty":
      return s !== "";
    case "contains":
      return t.includes(a);
    case "notContains":
      return !t.includes(a);
    case "starts":
      return t.startsWith(a);
    case "ends":
      return t.endsWith(a);
    case "exactly":
      return t === a;
    case "dateIs":
      return s.slice(0, 10) === c.a;
    case "dateBefore":
      return s !== "" && s.slice(0, 10) < c.a;
    case "dateAfter":
      return s !== "" && s.slice(0, 10) > c.a;
    case "gt":
      return s !== "" && cmp(c.a) > 0;
    case "gte":
      return s !== "" && cmp(c.a) >= 0;
    case "lt":
      return s !== "" && cmp(c.a) < 0;
    case "lte":
      return s !== "" && cmp(c.a) <= 0;
    case "eq":
      return s !== "" && cmp(c.a) === 0;
    case "neq":
      return s === "" || cmp(c.a) !== 0;
    case "between":
      return s !== "" && cmp(c.a) >= 0 && cmp(c.b) <= 0;
    case "notBetween":
      return s === "" || cmp(c.a) < 0 || cmp(c.b) > 0;
  }
}
const condReady = (c?: Cond) => Boolean(c && (CONDS.find((x) => x.id === c.op)?.args === 0 || c.a.trim()));
const filterOn = (f?: Filter) => Boolean(f && (condReady(f.cond) || f.vals));

/** The root that holds Arrowsterr's styles, so pop-ups opened in a portal look right. */
const portalRoot = () => (typeof document === "undefined" ? null : ((document.querySelector(".aw") as HTMLElement | null) ?? document.body));

/** A pop-up under a cell or a column name, kept on screen. Closes on a click outside or Escape. */
export function Pop({ anchor, onClose, children, width = 260, label }: { anchor: DOMRect; onClose: () => void; children: React.ReactNode; width?: number; label: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 4 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
    const below = anchor.bottom + 4;
    const top = below + h > window.innerHeight - 8 && anchor.top - h - 4 > 8 ? anchor.top - h - 4 : Math.max(8, Math.min(below, window.innerHeight - h - 8));
    setPos({ left, top });
  }, [anchor, width]);
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    const t = setTimeout(() => document.addEventListener("mousedown", down), 0);
    document.addEventListener("keydown", key, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [onClose]);
  const root = portalRoot();
  if (!root) return null;
  return createPortal(
    <div ref={ref} role="dialog" aria-label={label} className="aw-pop" style={{ left: pos.left, top: pos.top, width }} onMouseDown={(e) => e.stopPropagation()}>
      {children}
    </div>,
    root,
  );
}

/** Pick one option, in Arrowsterr's style. Type to narrow, arrows to move, Enter to pick. */
function SelectPop({ anchor, options, value, onPick, onClose, label }: { anchor: DOMRect; options: Option[]; value: string; onPick: (id: string) => void; onClose: () => void; label: string }) {
  const [q, setQ] = useState("");
  const list = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  const [i, setI] = useState(
    Math.max(
      0,
      list.findIndex((o) => o.id === value),
    ),
  );
  return (
    <Pop anchor={anchor} onClose={onClose} label={label} width={Math.max(200, anchor.width)}>
      {options.length > 7 ? (
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setI(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setI((x) => Math.min(list.length - 1, x + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setI((x) => Math.max(0, x - 1));
            }
            if (e.key === "Enter" && list[i]) onPick(list[i].id);
          }}
          placeholder="Search"
          aria-label="Search options"
          className="aw-pop__search"
        />
      ) : null}
      <ul
        role="listbox"
        aria-label={label}
        tabIndex={options.length > 7 ? -1 : 0}
        ref={(el) => {
          if (el && options.length <= 7 && document.activeElement !== el) el.focus();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setI((x) => Math.min(list.length - 1, x + 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setI((x) => Math.max(0, x - 1));
          }
          if (e.key === "Enter" && list[i]) {
            e.preventDefault();
            onPick(list[i].id);
          }
        }}
        className="aw-pop__list outline-none"
      >
        {list.map((o, k) => (
          <li key={o.id || "none"} role="option" aria-selected={o.id === value}>
            <button type="button" className={`aw-pop__opt ${k === i ? "is-hot" : ""}`} onMouseEnter={() => setI(k)} onClick={() => onPick(o.id)}>
              {o.tone ? <span className={`aw-status ${o.tone}`}>{o.label}</span> : <span>{o.label}</span>}
              {o.id === value ? <span className="aw-pop__check">✓</span> : null}
            </button>
          </li>
        ))}
        {!list.length ? <li className="px-3 py-2 text-[12px] text-muted">No match</li> : null}
      </ul>
    </Pop>
  );
}

/** A month to pick a date from, in Arrowsterr's style. */
function DatePop({ anchor, value, onPick, onClose, label }: { anchor: DOMRect; value: string; onPick: (v: string | null) => void; onClose: () => void; label: string }) {
  const start = value ? new Date(`${value}T00:00:00`) : new Date();
  const [month, setMonth] = useState(new Date(start.getFullYear(), start.getMonth(), 1));
  const first = new Date(month);
  first.setDate(1 - ((month.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    return d;
  });
  const today = iso(new Date());
  return (
    <Pop anchor={anchor} onClose={onClose} label={label} width={264}>
      <div className="flex items-center justify-between px-2 pt-1 pb-2">
        <button type="button" className="aw-pop__nav" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          ‹
        </button>
        <span className="text-[13px] font-medium text-ink">
          {month.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })}
        </span>
        <button type="button" className="aw-pop__nav" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 px-2 text-center">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="py-1 text-[11px] text-muted">
            {d}
          </span>
        ))}
        {days.map((d) => {
          const k = iso(d);
          return (
            <button
              key={k}
              type="button"
              onClick={() => onPick(k)}
              className={`aw-pop__day ${d.getMonth() === month.getMonth() ? "" : "is-out"} ${k === value ? "is-on" : ""} ${k === today ? "is-today" : ""}`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between border-t border-rule-faint px-2 pt-2">
        <button type="button" className="aw-text-link text-[12px]" onClick={() => onPick(today)}>
          Today
        </button>
        <button type="button" className="aw-text-link text-[12px] text-neg!" onClick={() => onPick(null)}>
          Clear date
        </button>
      </div>
    </Pop>
  );
}

/** The column menu: sort, filter by condition, filter by values. Like Google Sheets, without color. */
function ColumnMenu<T>({
  anchor,
  col,
  rows,
  filter,
  canFilter,
  onSort,
  onApply,
  onHide,
  onClose,
}: {
  anchor: DOMRect;
  col: Col<T>;
  rows: T[];
  filter?: Filter;
  canFilter: boolean;
  onSort: (desc: boolean) => void;
  onApply: (f: Filter | undefined) => void;
  onHide: () => void;
  onClose: () => void;
}) {
  const all = [...new Set(rows.map((r) => keyOf(col.value(r))))].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b, undefined, { numeric: true })));
  const [cond, setCond] = useState<Cond>(filter?.cond ?? { op: "contains", a: "", b: "" });
  const [useCond, setUseCond] = useState(Boolean(filter?.cond));
  const [picked, setPicked] = useState<Set<string>>(new Set(filter?.vals ?? all));
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<"cond" | "vals" | null>(filter?.cond ? "cond" : "vals");
  const listed = all.filter((v) => !q || v.toLowerCase().includes(q.toLowerCase()));
  const args = CONDS.find((c) => c.id === cond.op)?.args ?? 1;
  const inputType = col.type === "date" ? "date" : "text";
  const apply = () => {
    const f: Filter = {};
    if (useCond && condReady(cond)) f.cond = cond;
    if (picked.size < all.length) f.vals = [...picked];
    onApply(f.cond || f.vals ? f : undefined);
    onClose();
  };
  const az =
    col.type === "number" ? ["Sort smallest to largest", "Sort largest to smallest"] : col.type === "date" ? ["Sort oldest to newest", "Sort newest to oldest"] : ["Sort A to Z", "Sort Z to A"];
  return (
    <Pop anchor={anchor} onClose={onClose} label={`${col.label} menu`} width={300}>
      <div className="flex flex-col">
        <button type="button" className="aw-pop__item" onClick={() => (onSort(false), onClose())}>
          {az[0]}
        </button>
        <button type="button" className="aw-pop__item" onClick={() => (onSort(true), onClose())}>
          {az[1]}
        </button>
        {canFilter ? (
          <>
            <span className="my-1 border-t border-rule-faint" />
            <button type="button" className="aw-pop__item" aria-expanded={open === "cond"} onClick={() => setOpen(open === "cond" ? null : "cond")}>
              <span className="text-[10px] text-muted">{open === "cond" ? "▼" : "▶"}</span>
              Filter by condition
              {useCond && condReady(cond) ? <span className="aw-pop__dot" /> : null}
            </button>
            {open === "cond" ? (
              <div className="flex flex-col gap-2 px-3 pb-2">
                <select
                  aria-label="Condition"
                  value={useCond ? cond.op : ""}
                  onChange={(e) => {
                    if (!e.target.value) return setUseCond(false);
                    setUseCond(true);
                    setCond({ ...cond, op: e.target.value as CondOp });
                  }}
                  className="aw-pop__field"
                >
                  <option value="">None</option>
                  {CONDS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                {useCond && args >= 1 ? (
                  <input
                    autoFocus
                    type={inputType}
                    value={cond.a}
                    onChange={(e) => setCond({ ...cond, a: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && apply()}
                    placeholder="Value"
                    aria-label="Value"
                    className="aw-pop__field"
                  />
                ) : null}
                {useCond && args === 2 ? (
                  <input
                    type={inputType}
                    value={cond.b}
                    onChange={(e) => setCond({ ...cond, b: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && apply()}
                    placeholder="And"
                    aria-label="Second value"
                    className="aw-pop__field"
                  />
                ) : null}
              </div>
            ) : null}
            <button type="button" className="aw-pop__item" aria-expanded={open === "vals"} onClick={() => setOpen(open === "vals" ? null : "vals")}>
              <span className="text-[10px] text-muted">{open === "vals" ? "▼" : "▶"}</span>
              Filter by values
              {picked.size < all.length ? <span className="aw-pop__dot" /> : null}
            </button>
            {open === "vals" ? (
              <div className="flex flex-col gap-2 px-3 pb-2">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="flex gap-1">
                    <button type="button" className="aw-text-link text-[12px]" onClick={() => setPicked(new Set([...picked, ...listed]))}>
                      Select all {listed.length}
                    </button>
                    <span className="text-muted">·</span>
                    <button type="button" className="aw-text-link text-[12px]" onClick={() => setPicked(new Set([...picked].filter((v) => !listed.includes(v))))}>
                      Clear
                    </button>
                  </span>
                  <span className="text-muted">Displaying {listed.length}</span>
                </div>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search values" aria-label="Search values" className="aw-pop__field" />
                <ul className="max-h-52 overflow-y-auto">
                  {listed.map((v) => (
                    <li key={v || "(blank)"}>
                      <label className="aw-pop__check-row">
                        <input
                          type="checkbox"
                          checked={picked.has(v)}
                          onChange={(e) => {
                            const next = new Set(picked);
                            if (e.target.checked) next.add(v);
                            else next.delete(v);
                            setPicked(next);
                          }}
                        />
                        <span className={`truncate ${v ? "" : "text-muted"}`}>{v || "(Blanks)"}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
        <span className="my-1 border-t border-rule-faint" />
        <button type="button" className="aw-pop__item" onClick={() => (onHide(), onClose())}>
          Hide column
        </button>
        {col.onRemove ? (
          <button type="button" className="aw-pop__item text-neg!" onClick={() => (col.onRemove!(), onClose())}>
            Delete column
          </button>
        ) : null}
        {canFilter ? (
          <div className="mt-1 flex items-center justify-between gap-2 border-t border-rule-faint px-3 pt-3 pb-1">
            {filterOn(filter) ? (
              <button type="button" className="aw-text-link text-[12px]" onClick={() => (onApply(undefined), onClose())}>
                Remove filter
              </button>
            ) : (
              <span />
            )}
            <span className="flex gap-2">
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={apply} disabled={!picked.size && !useCond}>
                OK
              </button>
            </span>
          </div>
        ) : null}
      </div>
    </Pop>
  );
}

/** The text editor for one cell: the cell itself becomes the input. Enter or Tab saves and moves, Escape cancels. */
function TextEditor<T>({ row, col, init, onSave, onDone }: { row: T; col: Col<T>; init: string | null; onSave: (value: string | null) => void; onDone: (move?: [number, number]) => void }) {
  const e = col.edit!;
  const start = e.value ? e.value(row) : keyOf(col.value(row));
  const [v, setV] = useState(init ?? start);
  const done = useRef(false);
  const save = (next: string, move?: [number, number]) => {
    if (done.current) return;
    done.current = true;
    if (next !== start) onSave(next.trim() === "" ? null : next.trim());
    onDone(move);
  };
  return (
    <input
      autoFocus
      type={e.kind === "number" ? "number" : "text"}
      value={v}
      aria-label={col.label}
      onFocus={(x) => {
        x.target.setSelectionRange(x.target.value.length, x.target.value.length);
      }}
      onChange={(x) => setV(x.target.value)}
      onBlur={() => save(v)}
      onKeyDown={(x) => {
        x.stopPropagation();
        if (x.key === "Enter") {
          x.preventDefault();
          save(v, [x.shiftKey ? -1 : 1, 0]);
        }
        if (x.key === "Tab") {
          x.preventDefault();
          save(v, [0, x.shiftKey ? -1 : 1]);
        }
        if (x.key === "ArrowDown") {
          x.preventDefault();
          save(v, [1, 0]);
        }
        if (x.key === "ArrowUp") {
          x.preventDefault();
          save(v, [-1, 0]);
        }
        if (x.key === "Escape") {
          done.current = true;
          onDone();
        }
      }}
      className="aw-sheet__input"
    />
  );
}

/** A pasted value as what the cell editor saves. Undefined means it does not fit and the cell is left alone. */
function pasteValue<T>(col: Col<T>, raw: string): string | null | undefined {
  const t = raw.trim();
  if (!t) return null;
  const e = col.edit!;
  if (e.kind === "select") {
    const low = t.toLowerCase();
    return e.options?.find((o) => o.id.toLowerCase() === low || o.label.toLowerCase() === low || o.aliases?.some((a) => a.toLowerCase() === low))?.id;
  }
  if (e.kind === "number") return /^-?[\d,]+(\.\d+)?$/.test(t) ? t.replace(/,/g, "") : undefined;
  if (e.kind === "date") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? undefined : iso(d);
  }
  return t;
}

type Pos = { r: number; c: number };
const PICK = "__pick"; // the checkbox column, as a grid column
type Change<T> = { key: string; col: Col<T>; before: string | null; after: string | null };

export function Sheet<T>({
  id,
  rows,
  cols: allCols,
  rowKey,
  sort: initial = { key: allCols[0].id, desc: false },
  selected,
  onSelect,
  canSelect = () => true,
  onOpen,
  canOpen = () => true,
  onAddColumn,
  onDeleteRows,
  onAppend,
  height = "72vh",
  pageSize,
  showFilters = true,
  label,
  toolbar,
}: {
  /** Saves this sheet's column layout in the browser. */
  id?: string;
  rows: T[];
  cols: Col<T>[];
  rowKey: (row: T) => string;
  sort?: Sort;
  selected?: Set<string>;
  onSelect?: (keys: Set<string>) => void;
  canSelect?: (row: T) => boolean;
  onOpen?: (row: T) => void;
  canOpen?: (row: T) => boolean;
  onAddColumn?: () => void;
  /** Delete key with rows picked. */
  onDeleteRows?: (keys: string[]) => void;
  /** Pasted rows that run past the last row, as column id to text. */
  onAppend?: (rows: Record<string, string>[]) => void;
  height?: string;
  /** Show rows in pages of this many, with a rows-per-page picker. Leave out for one long scroll. */
  pageSize?: number;
  /** False leaves only sorting in the column menu, for read-only examples. */
  showFilters?: boolean;
  label: string;
  /** Extra controls at the start of the bar above the sheet, like a view switch. */
  toolbar?: React.ReactNode;
}) {
  const [sort, setSort] = useSort(initial.key, initial.desc);
  const [per, setPer] = useState(pageSize ?? 0);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<Record<string, Filter>>({});
  const [layout, setLayoutState] = useState<Layout>(() => readLayout(id));
  const [menu, setMenu] = useState(false);
  const [colMenu, setColMenu] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [editing, setEditing] = useState<{
    cell: string;
    init: string | null;
    rect?: DOMRect;
  } | null>(null); // "rowKey|colId"
  const [cur, setCur] = useState<Pos | null>(null);
  const [anchor, setAnchor] = useState<Pos | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const [flash, setFlash] = useState("");
  const drag = useRef<{ from: Pos; moved: boolean } | null>(null);
  // The latest rows and selection, for undo and redo steps that run later.
  const live = useRef({ rows, selected, onSelect });
  useEffect(() => {
    live.current = { rows, selected, onSelect };
  });
  const pasted = useRef(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const active = Object.entries(filters).filter(([, f]) => filterOn(f));

  const setLayout = (next: Layout) => {
    setLayoutState(next);
    if (!id) return;
    try {
      localStorage.setItem(KEY(id), JSON.stringify(next));
    } catch {
      // Storage blocked. The layout lasts until the page reloads.
    }
  };

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  // Saved order first, then any new columns in their natural spot.
  const known = layout.order.filter((cid) => allCols.some((c) => c.id === cid));
  const ordered = known.map((cid) => allCols.find((c) => c.id === cid)!);
  allCols.forEach((c, i) => {
    if (!known.includes(c.id)) ordered.splice(Math.min(i, ordered.length), 0, c);
  });
  const cols = ordered.filter((c) => !layout.hidden.includes(c.id));
  const widthOf = (c: Col<T>) => layout.widths[c.id];

  const move = (cid: string, by: number) => {
    const ids = ordered.map((c) => c.id);
    const i = ids.indexOf(cid);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setLayout({ ...layout, order: ids });
  };
  const toggle = (cid: string) =>
    setLayout({
      ...layout,
      hidden: layout.hidden.includes(cid) ? layout.hidden.filter((x) => x !== cid) : [...layout.hidden, cid],
    });

  const resize = (c: Col<T>, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).closest("th")!;
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    let w = startW;
    const onMove = (m: PointerEvent) => {
      w = Math.max(60, Math.round(startW + m.clientX - startX));
      th.style.width = th.style.minWidth = th.style.maxWidth = `${w}px`;
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setLayout({ ...layout, widths: { ...layout.widths, [c.id]: w } });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const passes = (r: T, skip?: string) =>
    active.every(([cid, f]) => {
      if (cid === skip) return true;
      const c = allCols.find((x) => x.id === cid);
      if (!c) return true;
      const v = c.value(r);
      if (f.cond && condReady(f.cond) && !condMatch(v, f.cond)) return false;
      return !f.vals || f.vals.includes(keyOf(v));
    });
  const sorted = sortRows(
    rows.filter((r) => passes(r)),
    sort,
    Object.fromEntries(allCols.map((c) => [c.id, (r: T) => (c.type === "text" ? String(c.value(r) ?? "").toLowerCase() || null : c.value(r))])),
  );
  const pages = per ? Math.max(1, Math.ceil(sorted.length / per)) : 1;
  const pg = Math.min(page, pages - 1);
  const first = per ? pg * per : 0;
  const shown = per ? sorted.slice(first, first + per) : sorted;
  const pickable = sorted.filter(canSelect);
  const allOn = pickable.length > 0 && pickable.every((r) => selected?.has(rowKey(r)));
  const someOn = pickable.some((r) => selected?.has(rowKey(r)));
  const flip = (key: string, on: boolean) => {
    if (!selected || !onSelect) return;
    const next = new Set(selected);
    if (on) next.add(key);
    else next.delete(key);
    onSelect(next);
  };
  // The first column (the keyword) stays in view while the sheet scrolls sideways.
  const keyCol = cols[0]?.id;
  const stickyCls = (c: Col<T>) => (c.id === keyCol ? `aw-sheet__key ${onSelect ? "is-after-pick" : ""}` : "");
  const sized = (c: Col<T>) => {
    const w = widthOf(c);
    return w ? { width: w, minWidth: w, maxWidth: w } : c.width ? { minWidth: c.width } : undefined;
  };

  // ── Keyboard and selection, the way a spreadsheet works ──
  // The checkbox column is a real column: select it, copy it as TRUE or FALSE, paste it, clear it, Space to tick.
  const pickCol: Col<T> | null =
    onSelect && selected
      ? {
          id: PICK,
          label: "Select",
          type: "list",
          value: (r) => (selected.has(rowKey(r)) ? "TRUE" : "FALSE"),
          edit: {
            kind: "select",
            options: [
              { id: "TRUE", label: "TRUE", aliases: ["true", "yes", "y", "1", "x", "✓", "checked", "on"] },
              { id: "FALSE", label: "FALSE", aliases: ["false", "no", "n", "0", "off", "unchecked"] },
            ],
            save: () => {},
          },
        }
      : null;
  const off = pickCol ? 1 : 0;
  const gridCols = pickCol ? [pickCol, ...cols] : cols;
  const lastR = shown.length - 1;
  const lastC = gridCols.length - 1;
  const clamp = (p: Pos): Pos => ({
    r: Math.max(0, Math.min(lastR, p.r)),
    c: Math.max(0, Math.min(lastC, p.c)),
  });
  const at = cur && shown.length && gridCols.length ? clamp(cur) : null;
  const from = at && anchor ? clamp(anchor) : at;
  const box =
    at && from
      ? {
          r0: Math.min(at.r, from.r),
          r1: Math.max(at.r, from.r),
          c0: Math.min(at.c, from.c),
          c1: Math.max(at.c, from.c),
        }
      : null;
  const inBox = (r: number, c: number) => Boolean(box && r >= box.r0 && r <= box.r1 && c >= box.c0 && c <= box.c1);
  const cellsInBox = () => {
    const out: { row: T; col: Col<T> }[] = [];
    if (!box) return out;
    for (let r = box.r0; r <= box.r1; r++) for (let c = box.c0; c <= box.c1; c++) out.push({ row: shown[r], col: gridCols[c] });
    return out;
  };
  const focusGrid = () => wrapRef.current?.focus({ preventScroll: true });
  const cellEl = (p: Pos) => wrapRef.current?.querySelector(`[data-cell="${p.r}:${p.c}"]`) as HTMLElement | null;
  const goTo = (p: Pos, extend = false) => {
    const next = clamp(p);
    setCur(next);
    if (!extend) setAnchor(next);
    requestAnimationFrame(() => cellEl(next)?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  };
  const say = (t: string) => {
    setFlash(t);
    setTimeout(() => setFlash((x) => (x === t ? "" : x)), 1600);
  };
  const startEdit = (p: Pos, init: string | null = null) => {
    const c = gridCols[p.c];
    const r = shown[p.r];
    if (!c?.edit || !r) return false;
    // The checkbox cell ticks or unticks.
    if (c.id === PICK) {
      apply([{ row: r, col: c, value: selected?.has(rowKey(r)) ? "FALSE" : "TRUE" }]);
      return true;
    }
    const rect = cellEl(p)?.getBoundingClientRect();
    setEditing({
      cell: `${rowKey(r)}|${c.id}`,
      init: c.edit.kind === "select" || c.edit.kind === "date" ? null : init,
      rect,
    });
    return true;
  };
  const beforeOf = (row: T, col: Col<T>) => {
    const v = col.edit?.value ? col.edit.value(row) : col.value(row);
    return v === null || v === undefined || v === "" ? null : String(v);
  };
  /** Put a batch of cells back to how they were before it (or after it, for redo). */
  const setBack = (batch: Change<T>[], which: "before" | "after") => {
    const { rows: now, selected: sel, onSelect: pick } = live.current;
    let picks: Set<string> | null = null;
    for (const x of batch) {
      if (x.col.id === PICK) {
        picks ??= new Set(sel);
        if (x[which] === "TRUE") picks.add(x.key);
        else picks.delete(x.key);
        continue;
      }
      const row = now.find((r) => rowKey(r) === x.key);
      if (row && x.col.edit) x.col.edit.save(row, x[which]);
    }
    if (picks && pick) pick(picks);
  };
  /** Save many cells at once, kept together as one step for the app's Undo (Ctrl + Z). */
  const apply = (list: { row: T; col: Col<T>; value: string | null | undefined }[]) => {
    const batch: Change<T>[] = [];
    let picks: Set<string> | null = null;
    // The saves are this one step, so whatever they change does not record steps of its own.
    quietly(() => {
      for (const x of list) {
        if (!x.col.edit || x.value === undefined) continue;
        if (x.col.id === PICK) {
          if (!canSelect(x.row)) continue;
          picks ??= new Set(selected);
          const key = rowKey(x.row);
          const want = x.value === "TRUE";
          if (picks.has(key) === want) continue;
          batch.push({ key, col: x.col, before: picks.has(key) ? "TRUE" : "FALSE", after: want ? "TRUE" : "FALSE" });
          if (want) picks.add(key);
          else picks.delete(key);
          continue;
        }
        const before = beforeOf(x.row, x.col);
        if (before === x.value) continue;
        batch.push({ key: rowKey(x.row), col: x.col, before, after: x.value });
        x.col.edit.save(x.row, x.value);
      }
    });
    if (picks && onSelect) onSelect(picks);
    if (batch.length)
      recordUndo({
        label: `${batch.length === 1 ? "a change" : `${batch.length} changes`} in ${label}`,
        undo: () => setBack(batch, "before"),
        redo: () => setBack(batch, "after"),
        key: batch.length === 1 ? `sheet:${label}:${batch[0].key}:${batch[0].col.id}` : undefined,
      });
    return batch.length;
  };
  const textOf = (row: T, col: Col<T>) => keyOf(col.value(row)).replace(/[\t\n]+/g, " ");
  const copy = async (cut: boolean) => {
    if (!box) return;
    const lines: string[] = [];
    for (let r = box.r0; r <= box.r1; r++)
      lines.push(
        gridCols
          .slice(box.c0, box.c1 + 1)
          .map((c) => textOf(shown[r], c))
          .join("\t"),
      );
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
    } catch {
      return say("Copy is blocked in this browser");
    }
    const n = (box.r1 - box.r0 + 1) * (box.c1 - box.c0 + 1);
    if (cut) apply(cellsInBox().map((x) => ({ ...x, value: null })));
    say(`${cut ? "Cut" : "Copied"} ${n} ${n === 1 ? "cell" : "cells"}`);
  };
  const paste = (text: string) => {
    if (!at) return;
    const grid = text
      .replace(/\r/g, "")
      .replace(/\n+$/, "")
      .split("\n")
      .map((l) => l.split("\t"));
    if (!grid.length) return;
    const list: { row: T; col: Col<T>; value: string | null | undefined }[] = [];
    const extra: Record<string, string>[] = [];
    // One value pasted over a range fills the whole range.
    if (grid.length === 1 && grid[0].length === 1 && box && (box.r1 > box.r0 || box.c1 > box.c0)) {
      for (const x of cellsInBox()) if (x.col.edit) list.push({ ...x, value: pasteValue(x.col, grid[0][0]) });
    } else {
      grid.forEach((line, i) => {
        const r = at.r + i;
        if (r > lastR) {
          const rec: Record<string, string> = {};
          line.forEach((v, j) => {
            const c = gridCols[at.c + j];
            if (c && c.id !== PICK && v.trim()) rec[c.id] = v.trim();
          });
          if (Object.keys(rec).length) extra.push(rec);
          return;
        }
        line.forEach((v, j) => {
          const c = gridCols[at.c + j];
          if (c?.edit) list.push({ row: shown[r], col: c, value: pasteValue(c, v) });
        });
      });
    }
    const n = apply(list);
    if (extra.length && onAppend) onAppend(extra);
    say(extra.length && onAppend ? `Pasted ${n} cells and added ${extra.length} rows` : n ? `Pasted ${n} ${n === 1 ? "cell" : "cells"}` : "Nothing here can take that value");
    if (grid.length > 1 || grid[0].length > 1) {
      setAnchor(at);
      setCur(clamp({ r: at.r + grid.length - 1, c: at.c + grid[0].length - 1 }));
    }
  };
  const pickRows = () => {
    if (!box || !onSelect || !selected) return;
    const keys = shown
      .slice(box.r0, box.r1 + 1)
      .filter(canSelect)
      .map(rowKey);
    const allPicked = keys.every((k) => selected.has(k));
    const next = new Set(selected);
    for (const k of keys)
      if (allPicked) next.delete(k);
      else next.add(k);
    onSelect(next);
  };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing || e.target !== wrapRef.current) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    if (!at) {
      if (shown.length && /^(Arrow|Tab|Enter|Home|End|Page)/.test(k)) {
        e.preventDefault();
        goTo({ r: 0, c: 0 });
      }
      return;
    }
    const page = 15;
    const step = (dr: number, dc: number) => {
      e.preventDefault();
      const to = mod
        ? {
            r: dr ? (dr > 0 ? lastR : 0) : at.r,
            c: dc ? (dc > 0 ? lastC : 0) : at.c,
          }
        : { r: at.r + dr, c: at.c + dc };
      goTo(to, e.shiftKey);
    };
    if (k === "ArrowDown") return step(1, 0);
    if (k === "ArrowUp") return step(-1, 0);
    if (k === "ArrowRight") return step(0, 1);
    if (k === "ArrowLeft") return step(0, -1);
    if (k === "Tab") {
      e.preventDefault();
      const c = at.c + (e.shiftKey ? -1 : 1);
      return goTo(c > lastC ? { r: at.r + 1, c: 0 } : c < 0 ? { r: at.r - 1, c: lastC } : { r: at.r, c });
    }
    if (k === "Home") return (e.preventDefault(), goTo({ r: mod ? 0 : at.r, c: 0 }, e.shiftKey));
    if (k === "End") return (e.preventDefault(), goTo({ r: mod ? lastR : at.r, c: lastC }, e.shiftKey));
    if (k === "PageDown" || k === "PageUp") return (e.preventDefault(), goTo({ r: at.r + (k === "PageDown" ? page : -page), c: at.c }, e.shiftKey));
    if (k === "Enter" || k === "F2") {
      e.preventDefault();
      if (mod && at.c === off && onOpen && canOpen(shown[at.r])) return onOpen(shown[at.r]);
      if (startEdit(at)) return;
      if (at.c === off && onOpen && canOpen(shown[at.r])) return onOpen(shown[at.r]);
      return goTo({ r: at.r + (e.shiftKey ? -1 : 1), c: at.c });
    }
    if (k === "Escape") {
      e.preventDefault();
      if (anchor && (anchor.r !== at.r || anchor.c !== at.c)) return setAnchor(at);
      if (selected?.size && onSelect) return onSelect(new Set());
      return setCur(null);
    }
    if (k === " " && e.shiftKey) return (e.preventDefault(), pickRows());
    if (k === " " && gridCols[at.c]?.id === PICK) {
      e.preventDefault();
      // Space ticks the boxes in the range, or unticks them when they are all ticked.
      const cells = cellsInBox().filter((x) => x.col.id === PICK);
      const all = cells.every((x) => selected?.has(rowKey(x.row)));
      apply(cells.map((x) => ({ ...x, value: all ? "FALSE" : "TRUE" })));
      return;
    }
    if (k === "Delete" || k === "Backspace") {
      e.preventDefault();
      // Delete on the checkbox column only unticks. Elsewhere, with rows ticked, it deletes them.
      const onlyPicks = box && pickCol && box.c0 === 0 && box.c1 === 0;
      if (!onlyPicks && selected?.size && onDeleteRows) return onDeleteRows([...selected]);
      const n = apply(cellsInBox().map((x) => ({ ...x, value: null })));
      return say(n ? `Cleared ${n} ${n === 1 ? "cell" : "cells"}` : "Nothing here can be cleared");
    }
    if (mod && k.toLowerCase() === "a") {
      e.preventDefault();
      setAnchor({ r: 0, c: 0 });
      return setCur({ r: lastR, c: lastC });
    }
    if (mod && k.toLowerCase() === "c") return (e.preventDefault(), void copy(false));
    if (mod && k.toLowerCase() === "x") return (e.preventDefault(), void copy(true));
    if (mod && k.toLowerCase() === "v") {
      // The paste event brings the text. Read the clipboard only if it does not come.
      pasted.current = false;
      setTimeout(() => {
        if (pasted.current) return;
        navigator.clipboard
          ?.readText()
          .then(paste)
          .catch(() => say("Paste is blocked in this browser"));
      }, 120);
      return;
    }
    if (mod && k === "/") return (e.preventDefault(), setKeysOpen((x) => !x));
    // Typing starts editing the cell, like a spreadsheet.
    if (!mod && !e.altKey && k.length === 1 && gridCols[at.c]?.edit && gridCols[at.c].id !== PICK) {
      e.preventDefault();
      startEdit(at, k);
    }
  };

  // Click a cell to edit it. Drag across cells, or Shift-click, to select a range.
  const onCellDown = (e: React.MouseEvent, p: Pos) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("a, button, input, select, textarea, label")) return;
    if (editing) return;
    e.preventDefault();
    if (e.shiftKey && at) {
      if (!anchor) setAnchor(at);
      setCur(p);
      focusGrid();
      return;
    }
    setCur(p);
    setAnchor(p);
    drag.current = { from: p, moved: false };
    focusGrid();
  };
  const onCellEnter = (p: Pos) => {
    if (!drag.current) return;
    if (p.r !== drag.current.from.r || p.c !== drag.current.from.c) drag.current.moved = true;
    setCur(p);
  };
  useEffect(() => {
    const up = () => {
      const d = drag.current;
      drag.current = null;
      if (d && !d.moved) startEdit(d.from);
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  });

  const rowNumberDown = (e: React.MouseEvent, r: number) => {
    e.preventDefault();
    if (e.shiftKey && at) {
      if (!anchor) setAnchor({ r: at.r, c: 0 });
      setCur({ r, c: lastC });
    } else {
      setAnchor({ r, c: 0 });
      setCur({ r, c: lastC });
    }
    focusGrid();
  };
  const endEdit = (p: Pos, mv?: [number, number]) => {
    setEditing(null);
    if (mv) goTo({ r: p.r + mv[0], c: p.c + mv[1] });
    requestAnimationFrame(focusGrid);
  };

  const menuCol = colMenu ? allCols.find((c) => c.id === colMenu.id) : null;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 text-[12px] text-muted">
        {toolbar}
        <span className="aw-num">{sorted.length === rows.length ? `${rows.length} rows` : `${sorted.length} of ${rows.length} rows`}</span>
        {box && (box.r1 > box.r0 || box.c1 > box.c0) ? <span className="aw-num text-ink">{(box.r1 - box.r0 + 1) * (box.c1 - box.c0 + 1)} cells selected</span> : null}
        {active.length ? (
          <button
            type="button"
            className="aw-text-link text-[12px]"
            onClick={() => {
              setFilters({});
              setPage(0);
            }}
          >
            Clear {active.length} {active.length === 1 ? "filter" : "filters"}
          </button>
        ) : null}
        {flash ? (
          <span className="aw-sheet__flash" role="status">
            {flash}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          <div className="relative">
            <button type="button" className={`aw-chip aw-chip--btn ${keysOpen ? "is-on" : ""}`} onClick={() => setKeysOpen(!keysOpen)} aria-expanded={keysOpen} title="Keyboard shortcuts (Ctrl /)">
              ⌨ Shortcuts
            </button>
            {keysOpen ? (
              <div className="absolute right-0 z-30 mt-1 w-72 rounded-aw border border-rule bg-white p-3 text-[12px] text-ink shadow-aw" onMouseLeave={() => setKeysOpen(false)}>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                  {[
                    ["Click", "Edit the cell"],
                    ["Drag, Shift + click", "Select a range"],
                    ["↑ ↓ ← →", "Move"],
                    ["Shift + arrows", "Select a range"],
                    ["Ctrl + arrows", "Jump to the edge"],
                    ["Tab, Shift + Tab", "Next, previous cell"],
                    ["Enter or type", "Edit the cell"],
                    ["Ctrl + Enter", "Open the keyword"],
                    ["Home, End", "Start, end of the row"],
                    ["Page Up, Down", "Move 15 rows"],
                    ["Ctrl + C, X, V", "Copy, cut, paste"],
                    ["Ctrl + Z", "Undo"],
                    ["Ctrl + Shift + Z", "Redo"],
                    ["Ctrl + A", "Select all"],
                    ["Shift + Space", "Pick the rows"],
                    ["Delete", "Clear cells, or delete picked rows"],
                    ["Esc", "Clear the selection"],
                  ].map(([a, b]) => (
                    <Fragment key={a}>
                      <dt className="aw-num whitespace-nowrap text-muted">{a}</dt>
                      <dd>{b}</dd>
                    </Fragment>
                  ))}
                </dl>
                <p className="mt-2 text-muted">On a Mac, use Cmd in place of Ctrl.</p>
              </div>
            ) : null}
          </div>
          {onAddColumn ? (
            <button type="button" className="aw-chip aw-chip--btn" onClick={onAddColumn}>
              + Column
            </button>
          ) : null}
          <div className="relative" ref={menuRef}>
            <button type="button" className={`aw-chip aw-chip--btn ${menu ? "is-on" : ""}`} onClick={() => setMenu(!menu)} aria-expanded={menu}>
              Columns
              {layout.hidden.length ? ` · ${layout.hidden.length} hidden` : ""}
            </button>
            {menu ? (
              <div className="absolute right-0 z-30 mt-1 flex max-h-96 w-64 flex-col overflow-y-auto rounded-aw border border-rule bg-white py-1 shadow-aw">
                {ordered.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-ink hover:bg-surface-2">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={!layout.hidden.includes(c.id)} onChange={() => toggle(c.id)} className="h-3.5 w-3.5" />
                      <span className="truncate">{c.label}</span>
                    </label>
                    <button type="button" aria-label={`Move ${c.label} left`} disabled={!i} onClick={() => move(c.id, -1)} className="px-1 text-muted hover:text-ink disabled:opacity-30">
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${c.label} right`}
                      disabled={i === ordered.length - 1}
                      onClick={() => move(c.id, 1)}
                      className="px-1 text-muted hover:text-ink disabled:opacity-30"
                    >
                      ↓
                    </button>
                    {c.onRemove ? (
                      <button type="button" aria-label={`Delete column ${c.label}`} onClick={c.onRemove} className="px-1 text-muted hover:text-neg">
                        ×
                      </button>
                    ) : null}
                  </div>
                ))}
                <button type="button" className="aw-text-link px-3 py-2 text-left text-[12px]" onClick={() => setLayout(EMPTY)}>
                  Reset layout
                </button>
              </div>
            ) : null}
          </div>
        </span>
      </div>
      <div
        ref={wrapRef}
        className="aw-sheet-wrap"
        style={{ maxHeight: height }}
        tabIndex={0}
        role="grid"
        aria-label={`${label}. Click a cell to edit it. Use the arrow keys to move.`}
        onKeyDown={onKey}
        onScroll={() => colMenu && setColMenu(null)}
        onPaste={(e) => {
          if (editing || e.target !== wrapRef.current) return;
          e.preventDefault();
          pasted.current = true;
          paste(e.clipboardData.getData("text/plain"));
        }}
      >
        <table className="aw-sheet" aria-label={label}>
          <thead>
            <tr>
              <th className="aw-sheet__n" aria-label="Row" />
              {onSelect ? (
                <th className={`aw-sheet__pick ${box && box.c0 === 0 ? "is-col-on" : ""}`}>
                  <input
                    type="checkbox"
                    aria-label="Select all rows"
                    checked={allOn}
                    ref={(el) => {
                      if (el) el.indeterminate = someOn && !allOn;
                    }}
                    onChange={(e) => {
                      const next = new Set(selected);
                      for (const r of pickable) {
                        if (e.target.checked) next.add(rowKey(r));
                        else next.delete(rowKey(r));
                      }
                      onSelect(next);
                    }}
                  />
                </th>
              ) : null}
              {cols.map((c, j) => {
                const on = sort.key === c.id;
                const filtered = filterOn(filters[c.id]);
                return (
                  <th
                    key={c.id}
                    style={sized(c)}
                    className={`relative ${stickyCls(c)} ${box && j + off >= box.c0 && j + off <= box.c1 ? "is-col-on" : ""}`}
                    aria-sort={on ? (sort.desc ? "descending" : "ascending") : "none"}
                  >
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        className={`aw-sort ${on ? "is-on" : ""}`}
                        onClick={() => {
                          // Numbers start largest first, words start A to Z. Click again to flip.
                          setSort({ key: c.id, desc: on ? !sort.desc : c.type === "number" || c.type === "date" });
                          setPage(0);
                        }}
                        title={on ? (sort.desc ? "Sorted largest first. Click to flip." : "Sorted smallest first. Click to flip.") : "Sort"}
                      >
                        {c.head ?? c.label}
                        <span aria-hidden="true" className="aw-sort__arrow">
                          {on ? (sort.desc ? "↓" : "↑") : "↕"}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`aw-sheet__filter ${filtered ? "is-on" : ""} ${colMenu?.id === c.id ? "is-open" : ""}`}
                        aria-haspopup="dialog"
                        aria-label={`Filter ${c.label}`}
                        title={filtered ? "Filtered. Click to change." : "Filter"}
                        onClick={(e) => {
                          const rect = (e.currentTarget.closest("th") as HTMLElement).getBoundingClientRect();
                          setColMenu(colMenu?.id === c.id ? null : { id: c.id, rect });
                        }}
                      >
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
                          <path d="M3 5h18l-7 8v6l-4-2v-4z" />
                        </svg>
                      </button>
                    </span>
                    <span role="separator" aria-label={`Resize ${c.label}`} onPointerDown={(e) => resize(c, e)} className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-brand" />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const key = rowKey(r);
              const on = selected?.has(key) ?? false;
              const rowOn = box && i >= box.r0 && i <= box.r1;
              return (
                <tr key={key} className={on ? "is-picked" : ""}>
                  <td className={`aw-sheet__n ${rowOn ? "is-row-on" : ""}`} onMouseDown={(e) => rowNumberDown(e, i)} title="Select this row">
                    {first + i + 1}
                  </td>
                  {onSelect ? (
                    <td
                      className={`aw-sheet__pick ${inBox(i, 0) ? "is-in-range" : ""} ${at?.r === i && at?.c === 0 ? "is-active" : ""}`}
                      data-cell={`${i}:0`}
                      aria-selected={inBox(i, 0)}
                      onMouseDown={(e) => {
                        // Clicking the box itself ticks it and selects the cell; clicking around it works like any cell.
                        if ((e.target as HTMLElement).tagName === "INPUT") {
                          if (e.shiftKey && at) setCur({ r: i, c: 0 });
                          else {
                            setCur({ r: i, c: 0 });
                            setAnchor({ r: i, c: 0 });
                          }
                          return;
                        }
                        onCellDown(e, { r: i, c: 0 });
                      }}
                      onMouseEnter={() => onCellEnter({ r: i, c: 0 })}
                    >
                      <input
                        type="checkbox"
                        tabIndex={-1}
                        aria-label={`Select row ${first + i + 1}`}
                        checked={on}
                        disabled={!canSelect(r)}
                        onChange={(e) => {
                          flip(key, e.target.checked);
                          requestAnimationFrame(focusGrid);
                        }}
                      />
                    </td>
                  ) : null}
                  {cols.map((c, j) => {
                    const cellId = `${key}|${c.id}`;
                    const content = c.cell ? c.cell(r) : show(c.value(r));
                    const g = j + off; // this column's place in the grid, after the checkbox column
                    const isAt = at?.r === i && at?.c === g;
                    const ed = editing?.cell === cellId && c.edit ? c.edit : null;
                    const opener = j === 0 && onOpen && canOpen(r);
                    return (
                      <td
                        key={c.id}
                        data-cell={`${i}:${g}`}
                        style={sized(c)}
                        onMouseDown={(e) => onCellDown(e, { r: i, c: g })}
                        onMouseEnter={() => onCellEnter({ r: i, c: g })}
                        aria-selected={inBox(i, g)}
                        className={`${c.type === "number" ? "is-num" : ""} ${widthOf(c) ? "overflow-hidden text-ellipsis whitespace-nowrap" : ""} ${stickyCls(c)} ${inBox(i, g) ? "is-in-range" : ""} ${isAt ? "is-active" : ""} ${c.edit ? "is-editable" : ""} ${ed && (ed.kind === "text" || ed.kind === "number") ? "is-editing" : ""} ${opener ? "has-open" : ""}`}
                      >
                        {ed && (ed.kind === "text" || ed.kind === "number") ? (
                          <TextEditor row={r} col={c} init={editing!.init} onSave={(v) => apply([{ row: r, col: c, value: v }])} onDone={(mv) => endEdit({ r: i, c: g }, mv)} />
                        ) : (
                          <>
                            <span className="aw-sheet__val">{content}</span>
                            {opener ? (
                              <button type="button" className="aw-sheet__openbtn" onClick={() => onOpen!(r)} title="Open (Ctrl + Enter)">
                                Open ↗
                              </button>
                            ) : null}
                          </>
                        )}
                        {ed && ed.kind === "select" && editing?.rect ? (
                          <SelectPop
                            anchor={editing.rect}
                            label={c.label}
                            options={ed.options ?? []}
                            value={ed.value ? ed.value(r) : keyOf(c.value(r))}
                            onPick={(v) => {
                              apply([{ row: r, col: c, value: v || null }]);
                              endEdit({ r: i, c: g });
                            }}
                            onClose={() => endEdit({ r: i, c: g })}
                          />
                        ) : null}
                        {ed && ed.kind === "date" && editing?.rect ? (
                          <DatePop
                            anchor={editing.rect}
                            label={c.label}
                            value={ed.value ? ed.value(r) : keyOf(c.value(r))}
                            onPick={(v) => {
                              apply([{ row: r, col: c, value: v }]);
                              endEdit({ r: i, c: g });
                            }}
                            onClose={() => endEdit({ r: i, c: g })}
                          />
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {!shown.length ? (
              <tr>
                <td colSpan={cols.length + 2} className="aw-small">
                  No rows match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {per ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-4 py-2.5 text-[12px] text-muted">
          <label className="flex items-center gap-2">
            Rows per page
            <select
              value={per}
              onChange={(e) => {
                setPer(Number(e.target.value));
                setPage(0);
              }}
              className="h-8 border border-rule bg-white px-2 text-[12px] text-ink focus:border-brand focus:outline-none"
            >
              {[...new Set([25, 50, 100, 250, 500, pageSize ?? 100])]
                .sort((a, b) => a - b)
                .map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
            </select>
          </label>
          <span className="flex items-center gap-2">
            <span className="aw-num">{sorted.length ? `${(first + 1).toLocaleString("en-US")}–${(first + shown.length).toLocaleString("en-US")} of ${sorted.length.toLocaleString("en-US")}` : "0 rows"}</span>
            <button type="button" className="aw-chip aw-chip--btn disabled:opacity-40" disabled={pg === 0} onClick={() => setPage(pg - 1)}>
              ‹ Prev
            </button>
            <span className="aw-num">
              Page {pg + 1} of {pages}
            </span>
            <button type="button" className="aw-chip aw-chip--btn disabled:opacity-40" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>
              Next ›
            </button>
          </span>
        </div>
      ) : null}
      {colMenu && menuCol ? (
        <ColumnMenu
          key={colMenu.id}
          anchor={colMenu.rect}
          col={menuCol}
          rows={rows.filter((r) => passes(r, colMenu.id))}
          filter={filters[colMenu.id]}
          canFilter={showFilters}
          onSort={(desc) => {
            setSort({ key: colMenu.id, desc });
            setPage(0);
          }}
          onApply={(f) => {
            setFilters((x) => ({ ...x, [colMenu.id]: f ?? {} }));
            setPage(0);
          }}
          onHide={() => toggle(colMenu.id)}
          onClose={() => setColMenu(null)}
        />
      ) : null}
    </div>
  );
}
