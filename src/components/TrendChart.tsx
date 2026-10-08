"use client";

import { useState } from "react";
import type { Metric, Point } from "@/lib/metrics";

export type Line = { name: string; color: string; isYou: boolean };

const W = 760;
const H = 260;
const PAD = { l: 40, r: 16, t: 14, b: 28 };

type ChartMetric = Metric | "count";
const fmt = (m: ChartMetric, v: number | null) => (v === null ? "–" : m === "visibility" ? `${Math.round(v)}%` : m === "position" ? `#${v.toFixed(1)}` : `${Math.round(v)}`);
/** A round top for count charts: 5, 10, 20, 50, 100 ... */
const niceMax = (v: number) => {
  const p = 10 ** Math.floor(Math.log10(Math.max(v, 5)));
  return [1, 2, 5, 10].map((m) => m * p).find((x) => x >= v) ?? 10 * p;
};

/** Smooth path through points (Catmull-Rom turned into curves). */
function smooth(pts: [number, number][]) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1] ?? pts[i], pts[i], pts[i + 1], pts[i + 2] ?? pts[i + 1]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/** Each brand over time, as lines or grouped bars. Hover shows every value for that day. */
export function TrendChart({ points, lines, metric, mode }: { points: Point[]; lines: Line[]; metric: ChartMetric; mode: "line" | "bar" }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = points.flatMap((p) => lines.map((l) => p.values[l.name])).filter((v): v is number => v !== null);
  // Visibility runs 0 to 100. Sentiment 0 to 100. Position: #1 at the top.
  const max = metric === "position" ? Math.max(3, Math.ceil(Math.max(...values, 1))) : metric === "count" ? niceMax(Math.max(...values, 1)) : 100;
  const min = metric === "position" ? 1 : 0;
  const n = points.length;
  const x = (i: number) => PAD.l + (n <= 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (n - 1));
  const y = (v: number) => (metric === "position" ? PAD.t + ((v - min) / (max - min)) * (H - PAD.t - PAD.b) : H - PAD.b - ((v - min) / (max - min)) * (H - PAD.t - PAD.b));
  const ticks = metric === "position" ? [1, Math.round((1 + max) / 2), max] : metric === "count" ? [0, max / 4, max / 2, (3 * max) / 4, max] : [0, 25, 50, 75, 100];
  const slot = (W - PAD.l - PAD.r) / Math.max(n, 1);
  const barW = Math.max(2, Math.min(14, (slot * 0.8) / Math.max(lines.length, 1)));
  const bx = (i: number, j: number) => PAD.l + slot * i + slot / 2 - (barW * lines.length) / 2 + j * barW;
  const p = hover !== null ? points[hover] : null;

  if (!n) return <p className="aw-small p-5">No results in this period yet.</p>;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`${metric} over time`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="aw-chart-grid" />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" className="aw-chart-label">
              {fmt(metric, t)}
            </text>
          </g>
        ))}
        {points.map((pt, i) =>
          n <= 8 || i % Math.ceil(n / 8) === 0 || i === n - 1 ? (
            <text key={pt.at} x={mode === "bar" ? PAD.l + slot * i + slot / 2 : x(i)} y={H - 8} textAnchor="middle" className="aw-chart-label">
              {pt.label}
            </text>
          ) : null,
        )}
        {mode === "line" ? (
          <>
            {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--aw-rule)" /> : null}
            {[...lines].reverse().map((l) => {
              const pts = points.map((pt, i) => (pt.values[l.name] === null ? null : ([x(i), y(pt.values[l.name]!)] as [number, number]))).filter(Boolean) as [number, number][];
              return (
                <g key={l.name}>
                  <path d={smooth(pts)} fill="none" stroke={l.color} strokeWidth={l.isYou ? 3 : 2} strokeLinecap="round" />
                  {pts.map(([px, py], i) =>
                    n <= 1 || hover !== null ? <circle key={i} cx={px} cy={py} r={l.isYou ? 4 : 3} fill="#fff" stroke={l.color} strokeWidth={2} /> : null,
                  )}
                </g>
              );
            })}
          </>
        ) : (
          points.map((pt, i) =>
            lines.map((l, j) => {
              const v = pt.values[l.name];
              if (v === null) return null;
              const top = metric === "position" ? y(v) : y(v);
              const base = metric === "position" ? H - PAD.b : y(0);
              return <rect key={`${i}-${l.name}`} x={bx(i, j)} y={Math.min(top, base)} width={barW - 1} height={Math.abs(base - top) || 1} rx={2} fill={l.color} opacity={hover === null || hover === i ? 1 : 0.35} />;
            }),
          )
        )}
        {points.map((pt, i) => (
          <rect
            key={`hit-${pt.at}`}
            x={mode === "bar" ? PAD.l + slot * i : x(i) - (n <= 1 ? W : (W - PAD.l - PAD.r) / (n - 1) / 2)}
            y={0}
            width={mode === "bar" ? slot : n <= 1 ? W * 2 : (W - PAD.l - PAD.r) / (n - 1)}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      {p ? (
        <div
          className="aw-tip pointer-events-none absolute top-2 min-w-48"
          style={{ left: `${Math.min(70, Math.max(2, ((mode === "bar" ? PAD.l + slot * hover! + slot / 2 : x(hover!)) / W) * 100 + 2))}%` }}
        >
          <div className="mb-1 font-medium">{p.label}</div>
          {[...lines]
            .sort((a, b) => (metric === "position" ? (p.values[a.name] ?? 99) - (p.values[b.name] ?? 99) : (p.values[b.name] ?? -1) - (p.values[a.name] ?? -1)))
            .map((l) => (
              <div key={l.name} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2" style={{ color: "#A9B1C1" }}>
                  <i className="inline-block h-2 w-2" style={{ background: l.color }} />
                  {l.name}
                </span>
                <span style={{ color: "#FFFFFF" }}>{fmt(metric, p.values[l.name])}</span>
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}
