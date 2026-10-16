"use client";

import { COMPARES, PRESETS, resolveRange, type Compare, type Preset, type ReportRange } from "@/lib/reportRange";
import { DateField, Dropdown } from "../Pickers";

/** A report's dates and what they're compared with (docs/reports.md, section 9). */
export function RangePicker({ range, onChange, tz, historyDays, disabled }: { range: ReportRange; onChange: (r: ReportRange) => void; tz: string | null; historyDays: number; disabled?: boolean }) {
  const r = resolveRange(range, { tz, historyDays });
  const setPreset = (preset: Preset) => onChange(preset === "custom" ? { preset, start: r.start, end: r.end, compare: range.compare } : { preset, compare: range.compare });
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Dropdown<Preset> label="Dates" value={range.preset} onChange={setPreset} disabled={disabled} className="aw-dropdown--sm w-40" options={PRESETS} />
      {range.preset === "custom" ? (
        <>
          <DateField label="Start" value={range.start ?? r.start} clearable={false} disabled={disabled} className="aw-dropdown--sm w-36" onChange={(start) => start && onChange({ ...range, start })} />
          <DateField label="End" value={range.end ?? r.end} clearable={false} disabled={disabled} className="aw-dropdown--sm w-36" onChange={(end) => end && onChange({ ...range, end })} />
        </>
      ) : null}
      <span className="text-[13px] text-muted">vs</span>
      <Dropdown<Compare> label="Compare with" value={range.compare} onChange={(compare) => onChange({ ...range, compare })} disabled={disabled} className="aw-dropdown--sm w-48" options={COMPARES} />
      <span className="aw-micro" title={r.compareLabel ? `Compared with ${r.compareLabel}` : undefined}>
        {r.label}
        {r.clipped ? ` · your plan keeps ${historyDays} days` : ""}
      </span>
    </span>
  );
}
