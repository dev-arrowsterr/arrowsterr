"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { sortRows, useSort, type Sort } from "./ui";

// A spreadsheet: click a column name to sort (again to flip), type in the row under it to filter.
// Numbers and dates filter with =, >, ≥, <, ≤ or between, picked from a menu. Lists filter with a dropdown. Text filters by "contains".
// Like Google Sheets: show, hide and move columns, drag a column edge to resize, click a cell to edit it.
// The keyboard works like Sheets too: arrows, Tab, Enter, Home, End, Page Up and Down, Shift to select a range,
// Ctrl or Cmd with C, X, V, Z and A, Delete to clear, and Shift+Space to pick rows. The layout is saved per sheet in this browser.

type Value = string | number | null | undefined;
export type Edit<T> = {
  kind: "text" | "number" | "date" | "select";
  options?: { id: string; label: string }[];
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
  width?: number;
  /** Choices for a list filter. Defaults to every value in the column. */
  options?: string[];
  /** Click the cell to edit it. */
  edit?: Edit<T>;
  /** A column the user added, which they can delete. */
  onRemove?: () => void;
};
type Layout = { hidden: string[]; order: string[]; widths: Record<string, number> };
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

function numberMatch(v: Value, f: string) {
  if (typeof v !== "number") return false;
  const s = f.replace(/[\s,]/g, "");
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(>=|<=|>|<|=)?(-?\d+(?:\.\d+)?)$/))) {
    const n = Number(m[2]);
    return m[1] === ">" ? v > n : m[1] === "<" ? v < n : m[1] === ">=" ? v >= n : m[1] === "<=" ? v <= n : v === n;
  }
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/))) return v >= Number(m[1]) && v <= Number(m[2]);
  return true;
}

/** Dates filter like numbers, compared as YYYY-MM-DD text. Between is "a..b". */
function dateMatch(v: Value, f: string) {
  if (!v) return false;
  const d = String(v).slice(0, 10);
  const [op, a, b] = parseCond(f);
  if (!a) return true;
  return op === "between" ? d >= a && (!b || d <= b) : op === ">" ? d > a : op === ">=" ? d >= a : op === "<" ? d < a : op === "<=" ? d <= a : d === a;
}

type Op = "=" | ">" | ">=" | "<" | "<=" | "between";
const OPS: { id: Op; label: string }[] = [
  { id: "=", label: "=" },
  { id: ">", label: ">" },
  { id: ">=", label: "≥" },
  { id: "<", label: "<" },
  { id: "<=", label: "≤" },
  { id: "between", label: "↔" },
];
/** "op|a|b" from the filter menu. Older typed filters like ">100" or "10-50" still work in numberMatch. */
function parseCond(f: string): [Op, string, string] {
  const [op, a = "", b = ""] = f.split("|");
  return [(OPS.some((o) => o.id === op) ? op : "=") as Op, a, b];
}
function condToNumber(f: string) {
  if (!f.includes("|")) return f;
  const [op, a, b] = parseCond(f);
  if (!a && !(op === "between" && b)) return "";
  if (op === "between") return `${a || "-999999999999"}-${b || "999999999999"}`;
  return op === "=" ? a : `${op}${a}`;
}

/** The filter under a number or date column: pick a comparison, then type one value, or two for between. */
function CondFilter({ label, value, type, onChange }: { label: string; value: string; type: "number" | "date"; onChange: (v: string) => void }) {
  const [op, a, b] = parseCond(value);
  const set = (o: Op, x: string, y: string) => onChange(x || y ? `${o}|${x}|${y}` : o === "=" ? "" : `${o}||`);
  const input = (v: string, on: (x: string) => void, ph: string, name: string) => (
    <input aria-label={`${label} ${name}`} type={type === "date" ? "date" : "text"} inputMode={type === "number" ? "decimal" : undefined} value={v} onChange={(e) => on(e.target.value.replace(type === "number" ? /[^\d.\-]/g : /$^/, ""))} placeholder={ph} className="min-w-0 flex-1" />
  );
  return (
    <span className="aw-cond flex flex-wrap items-center gap-1">
      <select aria-label={`${label} comparison`} value={op} onChange={(e) => set(e.target.value as Op, a, b)} className="w-11! shrink-0 px-1! text-center">
        {OPS.map((o) => (
          <option key={o.id} value={o.id} title={o.id === "between" ? "between" : o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {input(a, (x) => set(op, x, b), op === "between" ? "from" : "any", "value")}
      {op === "between" ? input(b, (y) => set(op, a, y), "to", "to") : null}
    </span>
  );
}

const show = (v: Value) => (v === null || v === undefined || v === "" ? <span className="text-muted">–</span> : typeof v === "number" ? v.toLocaleString("en-US") : v);

/** The editor for one cell. Enter or leaving the cell saves. Tab saves and moves right. Escape cancels. */
function CellEditor<T>({ row, col, init, onDone }: { row: T; col: Col<T>; init: string | null; onDone: (move?: [number, number]) => void }) {
  const e = col.edit!;
  const start = e.value ? e.value(row) : String(col.value(row) ?? "");
  const [v, setV] = useState(init ?? start);
  const done = useRef(false);
  const save = (next: string, move?: [number, number]) => {
    if (done.current) return;
    done.current = true;
    if (next !== start) e.save(row, next.trim() === "" ? null : next.trim());
    onDone(move);
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };
  const keys = (x: React.KeyboardEvent) => {
    x.stopPropagation();
    if (x.key === "Enter") {
      x.preventDefault();
      save(v, [x.shiftKey ? -1 : 1, 0]);
    }
    if (x.key === "Tab") {
      x.preventDefault();
      save(v, [0, x.shiftKey ? -1 : 1]);
    }
    if (x.key === "Escape") cancel();
  };
  if (e.kind === "select")
    return (
      <select autoFocus value={v} onChange={(x) => save(x.target.value)} onBlur={cancel} onKeyDown={keys} aria-label={col.label} className="w-full">
        {e.options!.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  return (
    <input
      autoFocus
      type={e.kind === "date" ? "date" : e.kind === "number" ? "number" : "text"}
      value={v}
      aria-label={col.label}
      onChange={(x) => setV(x.target.value)}
      onBlur={() => save(v)}
      onKeyDown={keys}
      className="w-full"
    />
  );
}

/** A pasted value as what the cell editor saves: a select takes its option id, a number drops commas. */
function pasteValue<T>(col: Col<T>, raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const e = col.edit!;
  if (e.kind === "select") return e.options?.find((o) => o.id.toLowerCase() === t.toLowerCase() || o.label.toLowerCase() === t.toLowerCase())?.id ?? null;
  if (e.kind === "number") return /^-?[\d,]+(\.\d+)?$/.test(t) ? t.replace(/,/g, "") : null;
  if (e.kind === "date") {
    const d = new Date(t);
    return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return t;
}

type Pos = { r: number; c: number };
type Change<T> = { key: string; col: Col<T>; before: string | null };

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
  /** False hides the filter row, for read-only examples. */
  showFilters?: boolean;
  label: string;
  /** Extra controls at the start of the bar above the sheet, like a view switch. */
  toolbar?: React.ReactNode;
}) {
  const [sort, setSort] = useSort(initial.key, initial.desc);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [layout, setLayoutState] = useState<Layout>(() => readLayout(id));
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState<{ cell: string; init: string | null } | null>(null); // "rowKey|colId"
  const [cur, setCur] = useState<Pos | null>(null);
  const [anchor, setAnchor] = useState<Pos | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const [flash, setFlash] = useState("");
  const history = useRef<Change<T>[][]>([]);
  const pasted = useRef(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const active = Object.entries(filters).filter(([, v]) => v.replace(/^[^|]*\|/, "").replace(/\|/g, "").trim());

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
    setLayout({ ...layout, hidden: layout.hidden.includes(cid) ? layout.hidden.filter((x) => x !== cid) : [...layout.hidden, cid] });

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

  const shown = sortRows(
    rows.filter((r) =>
      active.every(([cid, f]) => {
        const c = allCols.find((x) => x.id === cid);
        if (!c) return true;
        const v = c.value(r);
        if (c.type === "number") return numberMatch(v, condToNumber(f));
        if (c.type === "date") return dateMatch(v, f.includes("|") ? f : `=|${f}|`);
        if (c.type === "list") return String(v ?? "") === f;
        return String(v ?? "").toLowerCase().includes(f.trim().toLowerCase());
      }),
    ),
    sort,
    Object.fromEntries(allCols.map((c) => [c.id, (r: T) => (c.type === "text" ? String(c.value(r) ?? "").toLowerCase() || null : c.value(r))])),
  );
  const pickable = shown.filter(canSelect);
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
  const first = cols[0]?.id;
  const stickyCls = (c: Col<T>) => (c.id === first ? `aw-sheet__key ${onSelect ? "is-after-pick" : ""}` : "");
  const sized = (c: Col<T>) => {
    const w = widthOf(c);
    return w ? { width: w, minWidth: w, maxWidth: w } : c.width ? { minWidth: c.width } : undefined;
  };

  // ── Keyboard and selection, the way a spreadsheet works ──
  const lastR = shown.length - 1;
  const lastC = cols.length - 1;
  const clamp = (p: Pos): Pos => ({ r: Math.max(0, Math.min(lastR, p.r)), c: Math.max(0, Math.min(lastC, p.c)) });
  const at = cur && shown.length && cols.length ? clamp(cur) : null;
  const from = at && anchor ? clamp(anchor) : at;
  const box = at && from ? { r0: Math.min(at.r, from.r), r1: Math.max(at.r, from.r), c0: Math.min(at.c, from.c), c1: Math.max(at.c, from.c) } : null;
  const inBox = (r: number, c: number) => Boolean(box && r >= box.r0 && r <= box.r1 && c >= box.c0 && c <= box.c1);
  const cellsInBox = () => {
    const out: { row: T; col: Col<T> }[] = [];
    if (!box) return out;
    for (let r = box.r0; r <= box.r1; r++) for (let c = box.c0; c <= box.c1; c++) out.push({ row: shown[r], col: cols[c] });
    return out;
  };
  const focusGrid = () => wrapRef.current?.focus({ preventScroll: true });
  const goTo = (p: Pos, extend = false) => {
    const next = clamp(p);
    setCur(next);
    if (!extend) setAnchor(next);
    requestAnimationFrame(() => wrapRef.current?.querySelector(`[data-cell="${next.r}:${next.c}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  };
  const say = (t: string) => {
    setFlash(t);
    setTimeout(() => setFlash((x) => (x === t ? "" : x)), 1600);
  };
  const startEdit = (p: Pos, init: string | null = null) => {
    const c = cols[p.c];
    const r = shown[p.r];
    if (!c?.edit || !r) return false;
    setEditing({ cell: `${rowKey(r)}|${c.id}`, init: c.edit.kind === "select" ? null : init });
    return true;
  };
  const beforeOf = (row: T, col: Col<T>) => {
    const v = col.edit?.value ? col.edit.value(row) : col.value(row);
    return v === null || v === undefined || v === "" ? null : String(v);
  };
  /** Save many cells at once, kept together for one Undo. */
  const apply = (list: { row: T; col: Col<T>; value: string | null }[]) => {
    const batch: Change<T>[] = [];
    for (const x of list) {
      if (!x.col.edit) continue;
      const before = beforeOf(x.row, x.col);
      if (before === x.value) continue;
      batch.push({ key: rowKey(x.row), col: x.col, before });
      x.col.edit.save(x.row, x.value);
    }
    if (batch.length) history.current.push(batch);
    return batch.length;
  };
  const textOf = (row: T, col: Col<T>) => {
    const v = col.value(row);
    return v === null || v === undefined ? "" : String(v).replace(/[\t\n]+/g, " ");
  };
  const copy = async (cut: boolean) => {
    if (!box) return;
    const lines: string[] = [];
    for (let r = box.r0; r <= box.r1; r++) lines.push(cols.slice(box.c0, box.c1 + 1).map((c) => textOf(shown[r], c)).join("\t"));
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
    const grid = text.replace(/\r/g, "").replace(/\n+$/, "").split("\n").map((l) => l.split("\t"));
    if (!grid.length) return;
    const list: { row: T; col: Col<T>; value: string | null }[] = [];
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
            const c = cols[at.c + j];
            if (c && v.trim()) rec[c.id] = v.trim();
          });
          if (Object.keys(rec).length) extra.push(rec);
          return;
        }
        line.forEach((v, j) => {
          const c = cols[at.c + j];
          if (c?.edit) list.push({ row: shown[r], col: c, value: pasteValue(c, v) });
        });
      });
    }
    const n = apply(list);
    if (extra.length && onAppend) onAppend(extra);
    say(extra.length && onAppend ? `Pasted ${n} cells and added ${extra.length} rows` : n ? `Pasted ${n} ${n === 1 ? "cell" : "cells"}` : "Nothing here can be edited");
    if (grid.length > 1 || grid[0].length > 1) {
      setAnchor(at);
      setCur(clamp({ r: at.r + grid.length - 1, c: at.c + grid[0].length - 1 }));
    }
  };
  const undo = () => {
    const batch = history.current.pop();
    if (!batch) return say("Nothing to undo");
    for (const x of batch) {
      const row = rows.find((r) => rowKey(r) === x.key);
      if (row && x.col.edit) x.col.edit.save(row, x.before);
    }
    say(`Undid ${batch.length} ${batch.length === 1 ? "change" : "changes"}`);
  };
  const pickRows = () => {
    if (!box || !onSelect || !selected) return;
    const keys = shown.slice(box.r0, box.r1 + 1).filter(canSelect).map(rowKey);
    const allPicked = keys.every((k) => selected.has(k));
    const next = new Set(selected);
    for (const k of keys) if (allPicked) next.delete(k);
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
      const to = mod ? { r: dr ? (dr > 0 ? lastR : 0) : at.r, c: dc ? (dc > 0 ? lastC : 0) : at.c } : { r: at.r + dr, c: at.c + dc };
      goTo(to, e.shiftKey);
    };
    if (k === "ArrowDown") return step(1, 0);
    if (k === "ArrowUp") return step(-1, 0);
    if (k === "ArrowRight") return step(0, 1);
    if (k === "ArrowLeft") return step(0, -1);
    if (k === "Tab") {
      e.preventDefault();
      const dc = e.shiftKey ? -1 : 1;
      const c = at.c + dc;
      return goTo(c > lastC ? { r: at.r + 1, c: 0 } : c < 0 ? { r: at.r - 1, c: lastC } : { r: at.r, c });
    }
    if (k === "Home") {
      e.preventDefault();
      return goTo({ r: mod ? 0 : at.r, c: 0 }, e.shiftKey);
    }
    if (k === "End") {
      e.preventDefault();
      return goTo({ r: mod ? lastR : at.r, c: lastC }, e.shiftKey);
    }
    if (k === "PageDown" || k === "PageUp") {
      e.preventDefault();
      return goTo({ r: at.r + (k === "PageDown" ? page : -page), c: at.c }, e.shiftKey);
    }
    if (k === "Enter" || k === "F2") {
      e.preventDefault();
      if (startEdit(at)) return;
      if (at.c === 0 && onOpen && canOpen(shown[at.r])) return onOpen(shown[at.r]);
      return goTo({ r: at.r + (e.shiftKey ? -1 : 1), c: at.c });
    }
    if (k === "Escape") {
      e.preventDefault();
      if (anchor && (anchor.r !== at.r || anchor.c !== at.c)) return setAnchor(at);
      if (selected?.size && onSelect) return onSelect(new Set());
      setCur(null);
      return;
    }
    if (k === " " && e.shiftKey) {
      e.preventDefault();
      return pickRows();
    }
    if (k === "Delete" || k === "Backspace") {
      e.preventDefault();
      if (selected?.size && onDeleteRows) return onDeleteRows([...selected]);
      const n = apply(cellsInBox().map((x) => ({ ...x, value: null })));
      return say(n ? `Cleared ${n} ${n === 1 ? "cell" : "cells"}` : "Nothing here can be cleared");
    }
    if (mod && k.toLowerCase() === "a") {
      e.preventDefault();
      setAnchor({ r: 0, c: 0 });
      setCur({ r: lastR, c: lastC });
      return;
    }
    if (mod && k.toLowerCase() === "c") {
      e.preventDefault();
      return void copy(false);
    }
    if (mod && k.toLowerCase() === "x") {
      e.preventDefault();
      return void copy(true);
    }
    if (mod && k.toLowerCase() === "z") {
      e.preventDefault();
      return undo();
    }
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
    if (mod && k === "/") {
      e.preventDefault();
      return setKeysOpen((x) => !x);
    }
    // Typing starts editing the cell, like a spreadsheet.
    if (!mod && !e.altKey && k.length === 1 && cols[at.c]?.edit) {
      e.preventDefault();
      startEdit(at, k);
    }
  };

  const onCellDown = (e: React.MouseEvent, p: Pos) => {
    if (editing) return;
    const already = at && at.r === p.r && at.c === p.c && (!from || (from.r === p.r && from.c === p.c));
    if (e.shiftKey && at) {
      e.preventDefault();
      if (!anchor) setAnchor(at);
      setCur(p);
    } else {
      setCur(p);
      setAnchor(p);
    }
    const t = e.target as HTMLElement;
    const control = t.closest("a, button:not(.aw-sheet__cell), input, select, textarea");
    if (!control) {
      // A click on the cell itself keeps the keyboard on the sheet.
      requestAnimationFrame(focusGrid);
      if (already && !e.shiftKey) startEdit(p);
    }
  };

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

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 text-[12px] text-muted">
        {toolbar}
        <span className="aw-num">{shown.length === rows.length ? `${rows.length} rows` : `${shown.length} of ${rows.length} rows`}</span>
        {box && (box.r1 > box.r0 || box.c1 > box.c0) ? (
          <span className="aw-num text-ink">
            {(box.r1 - box.r0 + 1) * (box.c1 - box.c0 + 1)} cells selected
          </span>
        ) : null}
        {active.length ? (
          <button type="button" className="aw-text-link text-[12px]" onClick={() => setFilters({})}>
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
                    ["↑ ↓ ← →", "Move"],
                    ["Shift + arrows", "Select a range"],
                    ["Ctrl + arrows", "Jump to the edge"],
                    ["Tab, Shift + Tab", "Next, previous cell"],
                    ["Enter, F2, or type", "Edit the cell"],
                    ["Home, End", "Start, end of the row"],
                    ["Page Up, Down", "Move 15 rows"],
                    ["Ctrl + C, X, V", "Copy, cut, paste"],
                    ["Ctrl + Z", "Undo"],
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
              Columns{layout.hidden.length ? ` · ${layout.hidden.length} hidden` : ""}
            </button>
            {menu ? (
              <div className="absolute right-0 z-30 mt-1 flex max-h-96 w-64 flex-col overflow-y-auto rounded-aw border border-rule bg-white py-1 shadow-aw">
                {ordered.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-ink hover:bg-surface-2">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={!layout.hidden.includes(c.id)} onChange={() => toggle(c.id)} className="h-3.5 w-3.5 accent-[var(--aw-pos)]" />
                      <span className="truncate">{c.label}</span>
                    </label>
                    <button type="button" aria-label={`Move ${c.label} left`} disabled={!i} onClick={() => move(c.id, -1)} className="px-1 text-muted hover:text-ink disabled:opacity-30">
                      ↑
                    </button>
                    <button type="button" aria-label={`Move ${c.label} right`} disabled={i === ordered.length - 1} onClick={() => move(c.id, 1)} className="px-1 text-muted hover:text-ink disabled:opacity-30">
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
        aria-label={`${label}. Use the arrow keys to move between cells.`}
        onKeyDown={onKey}
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
                <th className="aw-sheet__pick">
                  <input
                    type="checkbox"
                    aria-label="Select all shown rows"
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
                const text = c.type === "text" || c.type === "list";
                return (
                  <th key={c.id} style={sized(c)} className={`relative ${stickyCls(c)} ${box && j >= box.c0 && j <= box.c1 ? "is-col-on" : ""}`} aria-sort={on ? (sort.desc ? "descending" : "ascending") : "none"}>
                    <button type="button" className={`aw-sort ${on ? "is-on" : ""}`} onClick={() => setSort(on ? { key: c.id, desc: !sort.desc } : { key: c.id, desc: !text && c.type !== "date" })}>
                      {c.label}
                      <span aria-hidden="true" className="aw-sort__arrow">
                        {on ? (sort.desc ? "↓" : "↑") : "↕"}
                      </span>
                    </button>
                    <span role="separator" aria-label={`Resize ${c.label}`} onPointerDown={(e) => resize(c, e)} className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-brand" />
                  </th>
                );
              })}
            </tr>
            {showFilters ? (
            <tr className="aw-sheet__filters">
              <th className="aw-sheet__n" />
              {onSelect ? <th className="aw-sheet__pick" /> : null}
              {cols.map((c) => {
                const v = filters[c.id] ?? "";
                const set = (x: string) => setFilters((f) => ({ ...f, [c.id]: x }));
                if (c.type === "list") {
                  const opts = c.options ?? [...new Set(rows.map((r) => String(c.value(r) ?? "")).filter(Boolean))].sort();
                  return (
                    <th key={c.id} style={sized(c)} className={stickyCls(c)}>
                      <select aria-label={`Filter ${c.label}`} value={v} onChange={(e) => set(e.target.value)}>
                        <option value="">All</option>
                        {opts.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </th>
                  );
                }
                if (c.type === "number" || c.type === "date")
                  return (
                    <th key={c.id} style={{ ...sized(c), minWidth: Math.max(c.type === "date" ? 180 : 140, widthOf(c) ?? 0) }} className={stickyCls(c)}>
                      <CondFilter label={`Filter ${c.label}`} value={v} type={c.type} onChange={set} />
                    </th>
                  );
                return (
                  <th key={c.id} style={sized(c)} className={stickyCls(c)}>
                    <input aria-label={`Filter ${c.label}`} value={v} onChange={(e) => set(e.target.value)} placeholder="Contains" />
                  </th>
                );
              })}
            </tr>
            ) : null}
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const key = rowKey(r);
              const on = selected?.has(key) ?? false;
              const rowOn = box && i >= box.r0 && i <= box.r1;
              return (
                <tr key={key} className={on ? "is-picked" : ""}>
                  <td className={`aw-sheet__n ${rowOn ? "is-row-on" : ""}`} onMouseDown={(e) => rowNumberDown(e, i)} title="Select this row">
                    {i + 1}
                  </td>
                  {onSelect ? (
                    <td className="aw-sheet__pick">
                      <input type="checkbox" aria-label={`Select row ${i + 1}`} checked={on} disabled={!canSelect(r)} onChange={(e) => flip(key, e.target.checked)} />
                    </td>
                  ) : null}
                  {cols.map((c, j) => {
                    const cellId = `${key}|${c.id}`;
                    const content = c.cell ? c.cell(r) : show(c.value(r));
                    const isAt = at?.r === i && at?.c === j;
                    return (
                      <td
                        key={c.id}
                        data-cell={`${i}:${j}`}
                        style={sized(c)}
                        onMouseDown={(e) => onCellDown(e, { r: i, c: j })}
                        onDoubleClick={() => c.edit && startEdit({ r: i, c: j })}
                        aria-selected={inBox(i, j)}
                        className={`${c.type === "number" ? "is-num" : ""} ${widthOf(c) ? "overflow-hidden text-ellipsis whitespace-nowrap" : ""} ${stickyCls(c)} ${inBox(i, j) ? "is-in-range" : ""} ${isAt ? "is-active" : ""}`}
                      >
                        {editing?.cell === cellId && c.edit ? (
                          <CellEditor
                            row={r}
                            col={c}
                            init={editing.init}
                            onDone={(mv) => {
                              setEditing(null);
                              if (mv) goTo({ r: i + mv[0], c: j + mv[1] });
                              requestAnimationFrame(focusGrid);
                            }}
                          />
                        ) : j === 0 && onOpen && canOpen(r) ? (
                          <span className="flex items-center gap-2">
                            <button type="button" className="aw-sheet__open" onClick={() => onOpen(r)} title="Open">
                              {content}
                            </button>
                            {c.edit ? (
                              <button type="button" aria-label={`Edit ${c.label}`} title="Edit" className="text-[12px] text-muted hover:text-ink" onClick={() => startEdit({ r: i, c: j })}>
                                ✎
                              </button>
                            ) : null}
                          </span>
                        ) : c.edit ? (
                          <span className="aw-sheet__cell" title="Double-click, Enter or type to edit">
                            {content}
                          </span>
                        ) : (
                          content
                        )}
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
    </div>
  );
}
