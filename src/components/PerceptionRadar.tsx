"use client";

import { useState } from "react";
import type { Perception } from "@/lib/stats";

export type RadarSeries = { name: string; color: string; isYou: boolean };

const SIZE = 420;
const PADX = 110; // room for topic labels on the left and right
const C = SIZE / 2;
const R = 140;

/** One corner per topic. Each brand's shape shows how often AI links it to each topic. */
export function PerceptionRadar({
  topics,
  data,
  series,
  identity,
}: {
  topics: string[];
  data: Perception;
  series: RadarSeries[];
  identity: string[];
}) {
  const [focus, setFocus] = useState<string | null>(null);
  // Scale to the biggest value (next 25%), so small shares still make a readable shape.
  const top = Math.max(0, ...Object.values(data).flatMap((d) => Object.values(d)));
  const max = Math.min(100, Math.max(25, Math.ceil(top / 25) * 25));
  const angle = (i: number) => -Math.PI / 2 + (i / topics.length) * Math.PI * 2;
  const pt = (i: number, v: number) => [C + (Math.cos(angle(i)) * R * v) / max, C + (Math.sin(angle(i)) * R * v) / max] as const;
  const ring = (v: number) => topics.map((_, i) => pt(i, v).join(",")).join(" ");
  // Your brand draws last so it sits on top.
  const ordered = [...series].sort((a, b) => Number(a.isYou) - Number(b.isYou));

  return (
    <div className="flex flex-col gap-4">
      <svg viewBox={`${-PADX} 0 ${SIZE + PADX * 2} ${SIZE}`} className="mx-auto block h-auto w-full max-w-[560px]" role="img" aria-label="Brand perception by topic">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <polygon points={ring(max * f)} fill="none" className="aw-chart-grid" />
            <text x={C + 4} y={C - R * f - 3} style={{ fontSize: 11 }} fill="var(--aw-g500)">
              {Math.round(max * f)}%
            </text>
          </g>
        ))}
        {topics.map((_, i) => {
          const [x, y] = pt(i, max);
          return <line key={i} x1={C} y1={C} x2={x} y2={y} className="aw-chart-grid" />;
        })}
        {ordered.map((s) => {
          const dim = focus && focus !== s.name;
          return (
            <g key={s.name} opacity={dim ? 0.15 : 1}>
              <polygon
                points={topics.map((t, i) => pt(i, data[s.name]?.[t] ?? 0).join(",")).join(" ")}
                fill={s.color}
                fillOpacity={s.isYou ? 0.18 : 0.08}
                stroke={s.color}
                strokeWidth={s.isYou ? 3 : 2}
                strokeLinejoin="round"
              />
              {topics.map((t, i) => {
                const v = data[s.name]?.[t] ?? 0;
                const [x, y] = pt(i, v);
                return (
                  <circle key={t} cx={x} cy={y} r={s.isYou ? 5 : 4} fill={s.color} stroke="#fff" strokeWidth={2}>
                    <title>{`${s.name} · ${t}: ${Math.round(v)}%`}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
        {topics.map((t, i) => {
          const [x, y] = pt(i, max * 1.16);
          const anchor = Math.abs(x - C) < 10 ? "middle" : x > C ? "start" : "end";
          const wanted = identity.includes(t);
          return (
            <text
              key={t}
              x={x}
              y={y + 5}
              textAnchor={anchor}
              style={{ fontSize: 14, fontWeight: wanted ? 600 : 400 }}
              fill={wanted ? "var(--aw-brand)" : "var(--aw-g600)"}
            >
              {wanted ? "★ " : ""}
              {t}
            </text>
          );
        })}
      </svg>
      <div className="flex flex-wrap justify-center gap-2">
        {series.map((s) => (
          <button
            key={s.name}
            type="button"
            className={`aw-pill gap-2 ${focus === s.name ? "is-on" : ""}`}
            onMouseEnter={() => setFocus(s.name)}
            onMouseLeave={() => setFocus(null)}
            onFocus={() => setFocus(s.name)}
            onBlur={() => setFocus(null)}
          >
            <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}
