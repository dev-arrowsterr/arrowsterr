"use client";

// What a tool does, shown before the first search or setup: a headline, examples to try,
// what you get (with sample charts), how it works and a few FAQs. All sample data is labeled.

export type Feature = { title: string; text: string; visual?: React.ReactNode };

export function ToolIntro({
  title,
  lead,
  examples,
  onExample,
  action,
  features,
  steps,
  faqs,
}: {
  title: string;
  lead: string;
  examples?: string[];
  onExample?: (x: string) => void;
  action?: React.ReactNode;
  features: Feature[];
  steps: string[];
  faqs?: { q: string; a: string }[];
}) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="aw-h3 max-w-3xl">{title}</h2>
        <p className="max-w-3xl text-[15px] text-body">{lead}</p>
        {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
        {examples?.length ? (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-muted">Try:</span>
            {examples.map((x) => (
              <button key={x} type="button" className="aw-text-link" onClick={() => onExample?.(x)} disabled={!onExample}>
                {x}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="aw-frame flex flex-col gap-3 p-5">
            {f.visual ? (
              <div className="relative flex min-h-24 items-center justify-center border border-rule-faint bg-paper px-3 pb-3 pt-7">
                {f.visual}
                <span className="aw-label absolute right-2 top-1.5 text-[9px]">Sample</span>
              </div>
            ) : null}
            <h3 className="text-[15px] font-medium text-ink">{f.title}</h3>
            <p className="text-[13px] leading-relaxed text-body">{f.text}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h3 className="aw-h4">How it works</h3>
          <ol className="flex flex-col gap-2.5">
            {steps.map((s, i) => (
              <li key={s} className="flex items-start gap-3 text-[14px] text-body">
                <span className="aw-num flex h-6 w-6 shrink-0 items-center justify-center border border-rule text-[12px] text-ink">{i + 1}</span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
        </div>
        {faqs?.length ? (
          <div className="flex flex-col gap-3">
            <h3 className="aw-h4">FAQs</h3>
            <div className="flex flex-col divide-y divide-rule-faint border-y border-rule-faint">
              {faqs.map((f) => (
                <details key={f.q} className="group py-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[14px] text-ink">
                    {f.q}
                    <span aria-hidden="true" className="text-muted group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-2 text-[13px] leading-relaxed text-body">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

// ─────────────── sample visuals ───────────────

const BRAND = "var(--aw-brand)";

/** A difficulty ring with a number and a word. */
export function SampleRing({ value = 43, label = "Possible" }: { value?: number; label?: string }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <span className="flex items-center gap-3" aria-hidden="true">
      <span className="aw-num text-[26px] text-ink">{value}%</span>
      <svg width="50" height="50" viewBox="0 0 50 50">
        <circle cx="25" cy="25" r={r} fill="none" stroke="var(--aw-rule-faint)" strokeWidth="6" />
        <circle cx="25" cy="25" r={r} fill="none" stroke="#F5B70A" strokeWidth="6" strokeDasharray={`${(value / 100) * c} ${c}`} transform="rotate(-90 25 25)" />
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
        <span key={t} className="px-2 py-1 text-[12px]" style={{ background: bg }}>
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
