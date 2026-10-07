"use client";

import { useState } from "react";
import type { DayPoint } from "@/lib/stats";

export type Series = { name: string; color: string; isYou: boolean; total: number };

const W = 640;
const H = 300;
const PAD = { l: 48, r: 16, t: 14, b: 34 };

const fmtDay = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** % of chats mentioning each brand, one line per brand over time. */
export function VisibilityChart({ points, series }: { points: DayPoint[]; series: Series[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(10, Math.ceil(Math.max(0, ...points.flatMap((p) => Object.values(p.values).map((v) => v ?? 0))) / 10) * 10);
  const x = (i: number) => (points.length === 1 ? (PAD.l + W - PAD.r) / 2 : PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const ticks = [0, max / 2, max];
  const labelIdx = points.length <= 4 ? points.map((_, i) => i) : [0, Math.floor((points.length - 1) / 2), points.length - 1];

  // Draw your brand last so it sits on top.
  const ordered = [...series].sort((a, b) => Number(a.isYou) - Number(b.isYou));

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Visibility over time by brand">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className={t === 0 ? "aw-chart-base" : "aw-chart-grid"} />
              <text x={PAD.l - 8} y={y(t) + 5} textAnchor="end" className="aw-chart-label" style={{ fontSize: 15 }}>
                {Math.round(t)}%
              </text>
            </g>
          ))}
          {labelIdx.map((i) => (
            <text key={i} x={x(i)} y={H - 10} textAnchor="middle" className="aw-chart-label" style={{ fontSize: 15 }}>
              {fmtDay(points[i].day)}
            </text>
          ))}
          {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--aw-g500)" strokeWidth={1} /> : null}
          {ordered.map((s) => {
            const pts = points.map((p, i) => (p.values[s.name] == null ? null : ([x(i), y(p.values[s.name]!)] as const)));
            const d = pts.reduce((acc, pt, i) => (pt ? acc + `${acc && pts[i - 1] ? "L" : "M"}${pt[0]},${pt[1]}` : acc), "");
            return (
              <g key={s.name}>
                <path d={d} fill="none" stroke={s.color} strokeWidth={s.isYou ? 3 : 2} strokeLinecap="round" strokeLinejoin="round" />
                {pts.map((pt, i) =>
                  pt ? <circle key={i} cx={pt[0]} cy={pt[1]} r={s.isYou ? 5 : 4} fill={s.color} stroke="#fff" strokeWidth={2} /> : null,
                )}
              </g>
            );
          })}
          {points.map((p, i) => {
            const half = points.length === 1 ? (W - PAD.l - PAD.r) / 2 : (W - PAD.l - PAD.r) / (points.length - 1) / 2;
            return (
              <rect
                key={p.day}
                x={x(i) - half}
                y={0}
                width={half * 2}
                height={H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
        </svg>
        {hover !== null ? (
          <div
            className="aw-tip pointer-events-none absolute top-2 z-10 min-w-40"
            style={{ left: `${(x(hover) / W) * 100}%`, transform: x(hover) > W / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}
          >
            <b>{fmtDay(points[hover].day)}</b>
            {series.map((s) => (
              <div key={s.name} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2">
                  <i className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.name}
                </span>
                <span>{points[hover].values[s.name] == null ? "–" : `${Math.round(points[hover].values[s.name]!)}%`}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {series.map((s) => (
          <li key={s.name} className="flex items-center justify-between gap-3 text-[14px]">
            <span className={`flex min-w-0 items-center gap-2 ${s.isYou ? "font-semibold text-ink" : "text-ink-2"}`}>
              <i className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="truncate">{s.name}</span>
            </span>
            <span className="aw-num font-semibold text-ink">{Math.round(s.total)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
