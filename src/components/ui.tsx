"use client";

// Small pieces every page shares.
import { useEffect, useState } from "react";
import { BrandLogo } from "./BrandLogo";

export const favicon = (domain: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
export const guessDomain = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`;
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${Math.round(n)}%`);
export const pos = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `#${n.toFixed(1)}`);
export const score = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${Math.round(n)}`);

// Your brand is the blue series. Competitors use the Perceptric neutrals and gold.
export const YOU_COLOR = "#0943B0";
export const RIVAL_COLOR = "#E8603C"; // the competitor in any one-on-one view
export const OTHER_COLORS = ["#F5B70A", "#2B3242", "#D08A4E", "#28A745", "#7C8697", "#B3241A", "#2E6BE0", "#A6AEBB"];

export function Card({ title, action, children, className = "" }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`aw-frame flex min-w-0 flex-col ${className}`}>
      {title || action ? (
        <div className="aw-frame__head justify-between">
          {title ? <h2 className="aw-h4">{title}</h2> : null}
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
export function Thinking({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="aw-frame aw-think" role="status" aria-live="polite">
      <span className="aw-think__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 1.5c.6 4.9 2.9 8.6 10.5 10.5-7.6 1.9-9.9 5.6-10.5 10.5-.6-4.9-2.9-8.6-10.5-10.5C9.1 10.1 11.4 6.4 12 1.5z" />
        </svg>
      </span>
      <span className="aw-h4">{text}</span>
      <span className="aw-think__bar" aria-hidden="true" />
      {children}
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

/** What each metric means, for tooltips. */
export const TIPS = {
  visibility: "Share of AI answers that name the brand. 50% means half the answers named it.",
  sentiment: "How well AI talks about the brand, from 0 to 100. 50 is neutral, higher is better.",
  position: "Average spot in the list of brands an answer names. #1 is the first brand named.",
  positionScore: "Your average spot as a score: #1 is 100, and each spot down takes 10 points off.",
  mentions: "How many AI answers named the brand in this period.",
  used: "Share of AI answers that cite this site at least once.",
  answers: "How many AI answers cite this site.",
  avgCitations: "Links to this site in each answer that cites it.",
  pages: "Pages on this site that AI answers cite.",
  gap: "Brand A's share minus brand B's share, in points.",
} as const;

/** A small "i" that shows what a metric means on hover or focus. */
export function Tip({ text }: { text: string }) {
  return (
    <span className="group/tip relative ml-1 inline-flex align-middle normal-case">
      <span role="img" aria-label={text} className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-current font-sans text-[9px] leading-none font-medium opacity-60">
        i
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full left-1/2 z-40 mt-1.5 w-56 -translate-x-1/2 whitespace-normal bg-[var(--aw-ink)] px-2.5 py-1.5 text-left font-sans text-[12px] leading-snug font-normal tracking-normal text-white opacity-0 shadow-aw-sm transition-opacity group-hover/tip:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

/** A full height panel that slides in from the right, like the prompt deep dive. Escape or a click outside closes it. */
export function SidePanel({ title, kicker, onClose, children, narrow = false }: { title: React.ReactNode; kicker?: React.ReactNode; onClose: () => void; children: React.ReactNode; narrow?: boolean }) {
  useEffect(() => {
    const keys = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", keys);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", keys);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(16,20,30,0.45)] print:hidden" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={`flex h-full w-full flex-col gap-6 overflow-y-auto bg-white px-6 py-6 shadow-aw-sm ${narrow ? "max-w-[960px] md:px-8" : "max-w-[1320px] md:w-[calc(100%-240px)] md:px-10"}`}
      >
        <div className="flex items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            {kicker ? <span className="aw-micro">{kicker}</span> : null}
            <h2 className="text-[24px] leading-snug font-medium break-words text-ink">{title}</h2>
          </div>
          <button type="button" aria-label="Close" title="Close (Esc)" onClick={onClose} className="shrink-0 px-2 py-1 text-[26px] leading-none text-body hover:text-ink">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Used out of a limit, as a bar. */
export function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  const full = used >= limit;
  return (
    <div className="aw-card-stat flex flex-col gap-2">
      <span className="aw-small">{label}</span>
      <span className="aw-num text-[22px] font-medium text-ink">
        {used} <span className="text-[15px] font-normal text-muted">of {limit}</span>
      </span>
      <div
        className="h-2 overflow-hidden rounded-full bg-rule-faint"
        role="meter"
        aria-label={label}
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
      >
        <div className={`h-full ${full ? "bg-neg" : "bg-brand"}`} style={{ width: `${pct}%` }} />
      </div>
      {full ? <span className="text-[13px] font-medium text-neg">Limit reached</span> : null}
    </div>
  );
}

// ─────────────── button icons ───────────────

const ICON = { width: 14, height: 14, viewBox: "0 0 16 16", "aria-hidden": true, className: "aw-icon shrink-0" } as const;

/** The AI spark: marks every button that hands work to an AI agent. */
export function AiIcon() {
  return (
    <svg {...ICON} fill="currentColor">
      <path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" />
      <path d="M13 11l.6 1.4L15 13l-1.4.6L13 15l-.6-1.4L11 13l1.4-.6z" opacity=".7" />
    </svg>
  );
}

/** Save to the Topic Bank. */
export function BookmarkIcon() {
  return (
    <svg {...ICON} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M4 2h8v12l-4-3-4 3z" />
    </svg>
  );
}

/** Put on the Editorial Calendar. */
export function CalendarIcon() {
  return (
    <svg {...ICON} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5 1.5v3M11 1.5v3" />
    </svg>
  );
}

/** Open the SEO view of a page. */
export function ChartIcon() {
  return (
    <svg {...ICON} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M2 14h12M4 11V8M8 11V4M12 11V6" />
    </svg>
  );
}

/** Upload a file. */
export function UploadIcon() {
  return (
    <svg {...ICON} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 10V2M5 5l3-3 3 3M2 11v3h12v-3" />
    </svg>
  );
}
