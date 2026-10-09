// A ring chart with a value in the middle. Every slice also shows in a legend with its %.
export type Slice = { label: string; value: number; color: string };

const R = 52;
const STROKE = 18;
const CIRC = 2 * Math.PI * R;
const GAP = 3; // white space between slices, in px along the ring

export function Donut({ slices, center, size = 140, label }: { slices: Slice[]; center: React.ReactNode; size?: number; label: string }) {
  const total = slices.reduce((n, s) => n + s.value, 0) || 1;
  const shown = slices.filter((s) => s.value > 0);
  // Where each slice starts along the ring.
  const starts = shown.map((_, i) => shown.slice(0, i).reduce((n, s) => n + (s.value / total) * CIRC, 0));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 140 140" width={size} height={size} role="img" aria-label={label}>
        <circle cx={70} cy={70} r={R} fill="none" stroke="var(--aw-skel)" strokeWidth={STROKE} />
        {shown.map((s, i) => {
          const len = (s.value / total) * CIRC;
          const dash = Math.max(0, len - (shown.length > 1 ? GAP : 0));
          return (
            <circle
              key={s.label}
              cx={70}
              cy={70}
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={STROKE}
              strokeDasharray={`${dash} ${CIRC - dash}`}
              strokeDashoffset={-starts[i]}
              transform="rotate(-90 70 70)"
            >
              <title>{`${s.label}: ${Math.round((s.value / total) * 100)}%`}</title>
            </circle>
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>
    </div>
  );
}

export function Legend({ slices }: { slices: Slice[] }) {
  const total = slices.reduce((n, s) => n + s.value, 0) || 1;
  return (
    <ul className="flex w-full min-w-0 flex-col gap-2.5">
      {slices.map((s) => (
        <li key={s.label} className="flex items-center justify-between gap-3 text-[14px]">
          <span className="flex min-w-0 items-center gap-2 text-body">
            <i className="inline-block h-2.5 w-2.5 shrink-0" style={{ background: s.color }} />
            <span className="truncate">{s.label}</span>
          </span>
          <span className="aw-num font-medium text-ink">{Math.round((s.value / total) * 100)}%</span>
        </li>
      ))}
    </ul>
  );
}

/** One score out of 100 as a filled ring, like Ahrefs' DR ring. */
export function Gauge({ value, color = "var(--aw-brand)", size = 84, label }: { value: number | null; color?: string; size?: number; label: string }) {
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 84 84" width={size} height={size} role="img" aria-label={`${label}: ${value === null ? "none" : Math.round(v)} of 100`} className="shrink-0">
      <circle cx={42} cy={42} r={r} fill="none" stroke="var(--aw-surface-3)" strokeWidth={16} />
      {v > 0 ? <circle cx={42} cy={42} r={r} fill="none" stroke={color} strokeWidth={16} strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 42 42)" /> : null}
    </svg>
  );
}
