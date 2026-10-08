"use client";

import { useState } from "react";
import { sortRows, useSort, type Sort } from "./ui";

// A spreadsheet: click a column name to sort (again to flip), type in the row under it to filter.
// Numbers filter with 100, >100, <50 or 10-50. Lists filter with a dropdown. Text filters by "contains".

type Value = string | number | null | undefined;
export type Col<T> = {
  id: string;
  label: string;
  type: "text" | "number" | "list" | "date";
  value: (row: T) => Value;
  cell?: (row: T) => React.ReactNode;
  width?: number;
  /** Choices for a list filter. Defaults to every value in the column. */
  options?: string[];
};

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

const show = (v: Value) => (v === null || v === undefined || v === "" ? <span className="text-muted">–</span> : typeof v === "number" ? v.toLocaleString("en-US") : v);

export function Sheet<T>({
  rows,
  cols,
  rowKey,
  sort: initial = { key: cols[0].id, desc: false },
  selected,
  onSelect,
  canSelect = () => true,
  onOpen,
  height = "72vh",
  label,
}: {
  rows: T[];
  cols: Col<T>[];
  rowKey: (row: T) => string;
  sort?: Sort;
  selected?: Set<string>;
  onSelect?: (keys: Set<string>) => void;
  canSelect?: (row: T) => boolean;
  onOpen?: (row: T) => void;
  height?: string;
  label: string;
}) {
  const [sort, setSort] = useSort(initial.key, initial.desc);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const active = Object.entries(filters).filter(([, v]) => v.trim());

  const shown = sortRows(
    rows.filter((r) =>
      active.every(([id, f]) => {
        const c = cols.find((x) => x.id === id);
        if (!c) return true;
        const v = c.value(r);
        if (c.type === "number") return numberMatch(v, f);
        if (c.type === "list") return String(v ?? "") === f;
        return String(v ?? "").toLowerCase().includes(f.trim().toLowerCase());
      }),
    ),
    sort,
    Object.fromEntries(cols.map((c) => [c.id, (r: T) => (c.type === "text" ? String(c.value(r) ?? "").toLowerCase() || null : c.value(r))])),
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

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 text-[12px] text-muted">
        <span className="aw-num">
          {shown.length === rows.length ? `${rows.length} rows` : `${shown.length} of ${rows.length} rows`}
        </span>
        {active.length ? (
          <button type="button" className="aw-text-link text-[12px]" onClick={() => setFilters({})}>
            Clear {active.length} {active.length === 1 ? "filter" : "filters"}
          </button>
        ) : (
          <span>Click a column name to sort. Type under it to filter. Numbers take 100, &gt;100, &lt;50 or 10-50.</span>
        )}
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
                  <th key={c.id} style={c.width ? { minWidth: c.width } : undefined} aria-sort={on ? (sort.desc ? "descending" : "ascending") : "none"}>
                    <button
                      type="button"
                      className={`aw-sort ${on ? "is-on" : ""}`}
                      onClick={() => setSort(on ? { key: c.id, desc: !sort.desc } : { key: c.id, desc: !text && c.type !== "date" })}
                    >
                      {c.label}
                      <span aria-hidden="true" className="aw-sort__arrow">
                        {on ? (sort.desc ? "↓" : "↑") : "↕"}
                      </span>
                    </button>
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
                    <th key={c.id}>
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
                return (
                  <th key={c.id}>
                    <input aria-label={`Filter ${c.label}`} value={v} onChange={(e) => set(e.target.value)} placeholder={c.type === "number" ? ">0" : "Filter"} />
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
                  {cols.map((c, j) => (
                    <td key={c.id} className={c.type === "number" ? "is-num" : ""}>
                      {j === 0 && onOpen ? (
                        <button type="button" className="aw-sheet__open" onClick={() => onOpen(r)} title="Open">
                          {c.cell ? c.cell(r) : show(c.value(r))}
                        </button>
                      ) : c.cell ? (
                        c.cell(r)
                      ) : (
                        show(c.value(r))
                      )}
                    </td>
                  ))}
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
