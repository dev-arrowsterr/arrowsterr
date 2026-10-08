"use client";

// Small pieces every page shares.
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
