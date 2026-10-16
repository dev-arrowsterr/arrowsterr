"use client";

// The empty state of a tool before the first search, in the brand v5 layout: the Climb eyebrow with the tool's
// name, a display title, one lead, example searches, then what the tool shows as frames with a sample view on
// the flight grid. Callers may still pass steps and FAQs; they are not shown.

export type Feature = { title: string; text: string; visual?: React.ReactNode };

export function ToolIntro({
  eyebrow,
  title,
  lead,
  examples,
  onExample,
  action,
  features,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  examples?: string[];
  onExample?: (x: string) => void;
  action?: React.ReactNode;
  features?: Feature[];
  steps?: string[];
  faqs?: { q: string; a: string }[];
}) {
  return (
    <section className="aw-intro">
      <div className="aw-intro__head">
        {eyebrow ? <span className="aw-eyebrow">{eyebrow}</span> : null}
        <h2 className="aw-intro__title">{title}</h2>
        {lead ? <p className="aw-intro__lead">{lead}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
      {examples?.length ? (
        <div className="aw-intro__try">
          <span>Try</span>
          {examples.map((x) => (
            <button key={x} type="button" className="aw-try" onClick={() => onExample?.(x)} disabled={!onExample}>
              {x}
            </button>
          ))}
        </div>
      ) : null}
      {features?.length ? (
        <div className="aw-intro__grid">
          {features.map((f, i) => (
            <div key={f.title} className="aw-intro__card">
              {f.visual ? <div className="aw-intro__vis">{f.visual}</div> : null}
              <div className="aw-intro__copy">
                <span className="aw-intro__n">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="aw-intro__t">{f.title}</h3>
                <p className="aw-intro__x">{f.text}</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

// ─────────────── sample visuals ───────────────

const BRAND = "var(--aw-brand)";

/** Older pastel fills mapped to the brand tints. */
const TINTS: Record<string, string> = { "#FEF3C7": "var(--aw-spark-tint)", "#DBEAFE": "var(--aw-brand-pale)", "#DCFCE7": "var(--aw-pos-bg)" };

/** A difficulty ring with a number and a word. */
export function SampleRing({ value = 43, label = "Possible" }: { value?: number; label?: string }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <span className="flex items-center gap-3" aria-hidden="true">
      <span className="aw-num text-[26px] text-ink">{value}%</span>
      <svg width="50" height="50" viewBox="0 0 50 50">
        <circle cx="25" cy="25" r={r} fill="none" stroke="var(--aw-rule-faint)" strokeWidth="6" />
        <circle cx="25" cy="25" r={r} fill="none" stroke="var(--aw-spark)" strokeWidth="6" strokeDasharray={`${(value / 100) * c} ${c}`} transform="rotate(-90 25 25)" />
      </svg>
      <span className="text-[12px] text-body">{label}</span>
    </span>
  );
}

/** Vertical bars, like a 12-month trend. */
export function SampleBars({ values = [30, 45, 40, 52, 48, 60, 72, 66, 58, 70, 64, 80] }: { values?: number[] }) {
  const max = Math.max(...values);
  return (
    <span className="flex h-16 w-full items-end gap-1" aria-hidden="true">
      {values.map((v, i) => (
        <span key={i} className="flex-1" style={{ height: `${(v / max) * 100}%`, background: BRAND, opacity: 0.35 + (i / values.length) * 0.65 }} />
      ))}
    </span>
  );
}

/** A rising line. */
export function SampleLine({ values = [12, 14, 13, 18, 17, 22, 26, 25, 31, 35, 34, 41] }: { values?: number[] }) {
  const max = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 200},${58 - (v / max) * 52}`).join(" ");
  return (
    <svg viewBox="0 0 200 60" className="h-16 w-full" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={BRAND} strokeWidth="2" />
    </svg>
  );
}

/** Horizontal bars with labels and values. */
export function SampleRows({ rows }: { rows: [string, number, string?][] }) {
  const max = Math.max(...rows.map((r) => r[1]));
  return (
    <span className="flex w-full flex-col gap-1.5" aria-hidden="true">
      {rows.map(([label, v, shown]) => (
        <span key={label} className="grid grid-cols-[1fr_90px_44px] items-center gap-2 text-[11px]">
          <span className="truncate text-ink">{label}</span>
          <span className="h-1.5 bg-rule-faint">
            <span className="block h-full" style={{ width: `${(v / max) * 100}%`, background: BRAND }} />
          </span>
          <span className="aw-num text-right text-body">{shown ?? v}</span>
        </span>
      ))}
    </span>
  );
}

/** Small labeled chips. */
export function SampleChips({ items }: { items: [string, string][] }) {
  return (
    <span className="flex flex-wrap justify-center gap-1.5" aria-hidden="true">
      {items.map(([t, bg]) => (
        <span key={t} className="rounded-aw px-2 py-1 text-[12px] text-ink" style={{ background: TINTS[bg] ?? bg }}>
          {t}
        </span>
      ))}
    </span>
  );
}

/** A few big numbers side by side. */
export function SampleStats({ items }: { items: [string, string][] }) {
  return (
    <span className="grid w-full grid-cols-3 gap-2" aria-hidden="true">
      {items.map(([lab, v]) => (
        <span key={lab} className="flex flex-col">
          <span className="aw-label text-[9px]">{lab}</span>
          <span className="aw-num text-[20px] text-ink">{v}</span>
        </span>
      ))}
    </span>
  );
}
