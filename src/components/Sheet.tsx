"use client";

import { useEffect, useRef, useState } from "react";
import { sortRows, useSort, type Sort } from "./ui";

// A spreadsheet: click a column name to sort (again to flip), type in the row under it to filter.
// Numbers and dates filter with =, >, ≥, <, ≤ or between, picked from a menu. Lists filter with a dropdown. Text filters by "contains".
// Like Google Sheets: show, hide and move columns, drag a column edge to resize, click a cell to edit it.
// The layout is saved per sheet in this browser.

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

/** The editor for one cell. Enter or leaving the cell saves. Escape cancels. */
function CellEditor<T>({ row, col, onDone }: { row: T; col: Col<T>; onDone: () => void }) {
  const e = col.edit!;
  const start = e.value ? e.value(row) : String(col.value(row) ?? "");
  const [v, setV] = useState(start);
  const save = (next: string) => {
    if (next !== start) e.save(row, next.trim() === "" ? null : next.trim());
    onDone();
  };
  if (e.kind === "select")
    return (
      <select autoFocus value={v} onChange={(x) => save(x.target.value)} onBlur={onDone} aria-label={col.label} className="w-full">
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
      onKeyDown={(x) => {
        if (x.key === "Enter") save(v);
        if (x.key === "Escape") onDone();
      }}
      className="w-full"
    />
  );
}

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
  onAddColumn,
  height = "72vh",
  label,
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
  onAddColumn?: () => void;
  height?: string;
  label: string;
}) {
  const [sort, setSort] = useSort(initial.key, initial.desc);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [layout, setLayoutState] = useState<Layout>(() => readLayout(id));
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // "rowKey|colId"
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

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 text-[12px] text-muted">
        <span className="aw-num">{shown.length === rows.length ? `${rows.length} rows` : `${shown.length} of ${rows.length} rows`}</span>
        {active.length ? (
          <button type="button" className="aw-text-link text-[12px]" onClick={() => setFilters({})}>
            Clear {active.length} {active.length === 1 ? "filter" : "filters"}
          </button>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
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
                      <input type="checkbox" checked={!layout.hidden.includes(c.id)} onChange={() => toggle(c.id)} className="h-3.5 w-3.5 accent-[var(--aw-brand)]" />
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
      <div className="aw-sheet-wrap" style={{ maxHeight: height }}>
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
              {cols.map((c) => {
                const on = sort.key === c.id;
                const text = c.type === "text" || c.type === "list";
                return (
                  <th key={c.id} style={sized(c)} className={`relative ${stickyCls(c)}`} aria-sort={on ? (sort.desc ? "descending" : "ascending") : "none"}>
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
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const key = rowKey(r);
              const on = selected?.has(key) ?? false;
              return (
                <tr key={key} className={on ? "is-picked" : ""}>
                  <td className="aw-sheet__n">{i + 1}</td>
                  {onSelect ? (
                    <td className="aw-sheet__pick">
                      <input type="checkbox" aria-label={`Select row ${i + 1}`} checked={on} disabled={!canSelect(r)} onChange={(e) => flip(key, e.target.checked)} />
                    </td>
                  ) : null}
                  {cols.map((c, j) => {
                    const cellId = `${key}|${c.id}`;
                    const content = c.cell ? c.cell(r) : show(c.value(r));
                    return (
                      <td key={c.id} style={sized(c)} className={`${c.type === "number" ? "is-num" : ""} ${widthOf(c) ? "overflow-hidden text-ellipsis whitespace-nowrap" : ""} ${stickyCls(c)}`}>
                        {editing === cellId && c.edit ? (
                          <CellEditor row={r} col={c} onDone={() => setEditing(null)} />
                        ) : j === 0 && onOpen ? (
                          <span className="flex items-center gap-2">
                            <button type="button" className="aw-sheet__open" onClick={() => onOpen(r)} title="Open">
                              {content}
                            </button>
                            {c.edit ? (
                              <button type="button" aria-label={`Edit ${c.label}`} title="Edit" className="text-[12px] text-muted hover:text-ink" onClick={() => setEditing(cellId)}>
                                ✎
                              </button>
                            ) : null}
                          </span>
                        ) : c.edit ? (
                          <button type="button" className="aw-sheet__cell" onClick={() => setEditing(cellId)} title="Click to edit">
                            {content}
                          </button>
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
