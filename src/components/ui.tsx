"use client";

// Small pieces every page shares.
import { useState } from "react";
import { BrandLogo } from "./BrandLogo";

export const favicon = (domain: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
export const guessDomain = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`;
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${Math.round(n)}%`);
export const pos = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `#${n.toFixed(1)}`);
export const score = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${Math.round(n)}`);

// Your brand is the blue series. Competitors use the Perceptric neutrals and gold.
export const YOU_COLOR = "#0943B0";
export const OTHER_COLORS = ["#F5B70A", "#2B3242", "#D08A4E", "#28A745", "#7C8697", "#B3241A", "#2E6BE0", "#A6AEBB"];

export function Card({ title, action, children, className = "" }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`aw-frame flex min-w-0 flex-col ${className}`}>
      {title ? (
        <div className="aw-frame__head justify-between">
          <h2 className="aw-h4">{title}</h2>
          {action}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

/** A brand's icon and name. Your brand gets a "You" badge. */
export function BrandName({ name, domain, logo, isYou, size = 20 }: { name: string; domain?: string | null; logo?: string; isYou?: boolean; size?: number }) {
  return (
    <span className="flex min-w-0 items-center gap-2 font-medium text-ink">
      <BrandLogo src={logo || favicon(domain || guessDomain(name))} name={name} size={size} />
      <span className="truncate">{name}</span>
      {isYou ? <span className="aw-badge">You</span> : null}
    </span>
  );
}

/** Change since the period before, with an arrow. For position, lower is better. */
export function Delta({ now, before, unit = "", lowerIsBetter = false, digits = 1 }: { now: number | null; before: number | null; unit?: string; lowerIsBetter?: boolean; digits?: number }) {
  if (now === null || before === null) return null;
  const d = now - before;
  const shown = Math.abs(d).toFixed(digits);
  if (Number(shown) === 0) return null;
  const good = lowerIsBetter ? d < 0 : d > 0;
  return (
    <span className={`whitespace-nowrap text-[12px] font-medium ${good ? "text-pos" : "text-neg"}`} title={good ? "Better than the period before" : "Worse than the period before"}>
      {d > 0 ? "↗" : "↘"} {shown}
      {unit}
    </span>
  );
}

/** A row of buttons where one is picked. */
export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: React.ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 rounded-aw border border-rule bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium ${value === o.id ? "bg-white text-ink shadow-aw-sm" : "text-muted hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="aw-callout max-w-2xl">{children}</div>;
}

/** The AI is working: a pulsing spark, a sweeping line and one short line of text. */
export function Thinking({ text }: { text: string }) {
  return (
    <div className="aw-frame aw-think" role="status" aria-live="polite">
      <span className="aw-think__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 1.5c.6 4.9 2.9 8.6 10.5 10.5-7.6 1.9-9.9 5.6-10.5 10.5-.6-4.9-2.9-8.6-10.5-10.5C9.1 10.1 11.4 6.4 12 1.5z" />
        </svg>
      </span>
      <span className="aw-h4">{text}</span>
      <span className="aw-think__bar" aria-hidden="true" />
    </div>
  );
}

// ─────────────── Sortable tables ───────────────

export type Sort = { key: string; desc: boolean };
type Value = string | number | null | undefined;

/** Which column a table is sorted by. Start with the table's natural order. */
export const useSort = (key: string, desc = true) => useState<Sort>({ key, desc });

/** Sort rows by the picked column. Empty values always go last. */
export function sortRows<T>(rows: T[], sort: Sort, get: Record<string, (row: T) => Value>): T[] {
  const f = get[sort.key];
  if (!f) return rows;
  return [...rows].sort((a, b) => {
    const x = f(a);
    const y = f(b);
    const xe = x === null || x === undefined || x === "";
    const ye = y === null || y === undefined || y === "";
    if (xe || ye) return xe === ye ? 0 : xe ? 1 : -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { sensitivity: "base", numeric: true });
    return sort.desc ? -c : c;
  });
}

/**
 * A column header you click to sort. One click sorts the column; the next click flips it.
 * Text columns start A to Z, number columns start high to low.
 */
export function SortTh({ id, sort, onSort, text = false, className = "", children }: { id: string; sort: Sort; onSort: (s: Sort) => void; text?: boolean; className?: string; children: React.ReactNode }) {
  const on = sort.key === id;
  const label = on ? (text ? (sort.desc ? "Z to A" : "A to Z") : sort.desc ? "high to low" : "low to high") : null;
  return (
    <th className={className} aria-sort={on ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button
        type="button"
        className={`aw-sort ${on ? "is-on" : ""}`}
        onClick={() => onSort(on ? { key: id, desc: !sort.desc } : { key: id, desc: !text })}
        title={label ? `Sorted ${label}. Click to flip.` : "Click to sort"}
      >
        {children}
        <span aria-hidden="true" className="aw-sort__arrow">
          {on ? (sort.desc ? "↓" : "↑") : "↕"}
        </span>
      </button>
    </th>
  );
}
