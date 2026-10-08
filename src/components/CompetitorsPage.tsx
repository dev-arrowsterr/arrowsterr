"use client";

import { useState } from "react";
import { answered, battle, brandStats, rankOf, topicGrid, trend, type BattleRow } from "@/lib/metrics";
import type { View } from "@/lib/view";
import { BrandLogo } from "./BrandLogo";
import { EngineName } from "./Engines";
import { TrendChart } from "./TrendChart";
import { BrandName, Card, Delta, Empty, favicon, pct, pos, score, Seg, sortRows, SortTh, Tip, TIPS, useSort, YOU_COLOR } from "./ui";

const B_COLOR = "#F5B70A";
const MAX_BRANDS = 50;

/** A value with a thin bar next to it. */
function Bar({ v, color }: { v: number | null; color: string }) {
  return (
    <span className="flex items-center gap-3">
      <span className="aw-num w-11 text-right text-[14px] text-ink">{pct(v)}</span>
      <span className="h-2 flex-1 bg-rule-faint">
        <span className="block h-full" style={{ width: `${v ?? 0}%`, background: color }} />
      </span>
    </span>
  );
}

type Dot = { name: string; domain: string | null; isYou: boolean; visibility: number; position: number };

/**
 * Each brand as its logo. Up is named more often. Right is named higher in the list.
 * Top right is where you want to be.
 */
function Scatter({ dots, logo, picked, onPick }: { dots: Dot[]; logo?: string; picked?: string; onPick: (name: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const worst = Math.max(4, Math.ceil(Math.max(...dots.map((d) => d.position), 1)));
  // Left edge is the worst average spot, right edge is #1.
  // Kept 4% in from each edge so logos at the ends are not cut off.
  const x = (p: number) => 4 + ((worst - p) / (worst - 1)) * 92;
  const y = (v: number) => 4 + (100 - v) * 0.92;
  const xTicks = Array.from({ length: worst }, (_, i) => i + 1).filter((t) => worst <= 8 || t % 2 === 1 || t === worst);
  return (
    <div className="flex gap-3 px-5 pt-6 pb-4">
      <div className="relative h-[420px] w-10 shrink-0 font-mono text-[11px] text-muted">
        {[100, 75, 50, 25, 0].map((t) => (
          <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${y(t)}%` }}>
            {t}%
          </span>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative h-[420px] border-b border-l border-rule">
          {[0, 25, 50, 75, 100].map((t) => (
            <span key={t} className="absolute right-0 left-0 border-t border-rule-faint" style={{ top: `${y(t)}%` }} />
          ))}
          {xTicks.map((t) => (
            <span key={t} className="absolute top-0 bottom-0 border-l border-rule-faint" style={{ left: `${x(t)}%` }} />
          ))}
          <span className="absolute top-2 right-3 font-mono text-[11px] tracking-wide text-muted uppercase">Leaders</span>
          {dots.map((d) => {
            const on = hover === d.name;
            const size = d.isYou ? 34 : 28;
            return (
              <button
                key={d.name}
                type="button"
                onClick={() => !d.isYou && onPick(d.name)}
                onMouseEnter={() => setHover(d.name)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(d.name)}
                onBlur={() => setHover(null)}
                aria-label={`${d.name}: visibility ${Math.round(d.visibility)}%, average position #${d.position.toFixed(1)}`}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-[8px] bg-white p-0.5 ring-2 ${d.isYou ? "ring-brand" : picked === d.name ? "ring-[#F5B70A]" : "ring-white"} ${on ? "z-20 scale-110" : "z-10"} transition-transform`}
                style={{ left: `${x(d.position)}%`, top: `${y(d.visibility)}%` }}
              >
                <BrandLogo src={d.isYou && logo ? logo : favicon(d.domain || `${d.name.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`)} name={d.name} size={size} />
                {on || d.isYou ? (
                  <span className={`pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-1 text-left text-[12px] ${on ? "top-full mt-1.5 bg-[var(--aw-ink)] text-white" : "top-full mt-1 font-medium text-ink"}`}>
                    {on ? (
                      <>
                        <span className="font-medium text-white!">{d.name}</span> · {pct(d.visibility)} · #{d.position.toFixed(1)}
                      </>
                    ) : (
                      "You"
                    )}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="relative h-6 font-mono text-[11px] text-muted">
          {xTicks.map((t) => (
            <span key={t} className="absolute top-1.5 -translate-x-1/2" style={{ left: `${x(t)}%` }}>
              #{t}
            </span>
          ))}
        </div>
        <div className="flex justify-between pt-1 text-[12px] text-muted">
          <span>← Named lower in the list</span>
          <span className="aw-label">Average position</span>
          <span>Named first →</span>
        </div>
      </div>
    </div>
  );
}

/** Every brand AI names next to yours, who wins each topic, and a battle card for any two brands. */
export function CompetitorsPage({ view, initial, onTopic }: { view: View; initial?: string | null; onTopic: (topic: string) => void }) {
  const { brand, current, previous, filter, topics, engines, days } = view;
  const you = { name: brand.name, domain: brand.domain };
  const chats = answered(current, filter);
  const prev = answered(previous, filter);
  const hadBefore = prev.length > 0;
  const stats = brandStats(chats, you);
  const before = brandStats(prev, you);
  const others = stats.filter((s) => !s.isYou);
  const [sort, setSort] = useSort("visibility");
  const [a, setA] = useState(brand.name);
  const [b, setB] = useState<string | null>(initial ?? null);
  const [split, setSplit] = useState<"model" | "topic" | "prompt">("model");
  const [h2h, setH2h] = useSort("gap", false);
  const [metric, setMetric] = useState<"visibility" | "sentiment" | "position">("visibility");

  if (!chats.length) return <Empty>No results in the last {days} days yet. They show up after the first check finishes, then update every day.</Empty>;

  const find = (n: string | null) => stats.find((s) => s.name.toLowerCase() === n?.toLowerCase());
  const A = find(a) ?? stats.find((s) => s.isYou)!;
  const B = find(b) ?? others.find((s) => s.name !== A.name) ?? stats.find((s) => s.name !== A.name);
  const was = (name: string) => before.find((x) => x.name.toLowerCase() === name.toLowerCase());
  const rankFor = (name: string) => rankOf(stats.map((s) => ({ ...s, isYou: s.name === name })), "visibility");
  const gridBrands = [stats.find((s) => s.isYou)!, ...others.slice(0, 5)];
  const grid = topicGrid(chats, topics, gridBrands.map((s) => s.name));
  const card = B ? battle(chats, A.name, B.name, engines, topics) : null;
  const rows: BattleRow[] = card ? (split === "model" ? card.byEngine : split === "topic" ? card.byTopic : card.byPrompt) : [];

  const picker = (value: string, onPick: (v: string) => void, label: string, not?: string) => (
    <select aria-label={label} value={value} onChange={(e) => onPick(e.target.value)} className="max-w-56 border border-rule bg-white px-2.5 py-1.5 text-[14px] text-ink focus:border-brand focus:outline-none">
      {stats
        .filter((s) => s.name !== not)
        .slice(0, MAX_BRANDS)
        .map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
            {s.isYou ? " (you)" : ""}
          </option>
        ))}
    </select>
  );

  return (
    <div className="flex flex-col gap-8">
      <h1 className="aw-h2">Competitors</h1>

      <Card
        title="Competitive analysis"
        action={
          <span className="aw-small">
            Top {Math.min(stats.length, MAX_BRANDS)} of {stats.length} brands · click one to compare
          </span>
        }
      >
        <Scatter
          dots={stats.slice(0, MAX_BRANDS).filter((s): s is typeof s & { position: number } => s.position !== null).map((s) => ({ name: s.name, domain: s.domain, isYou: s.isYou, visibility: s.visibility, position: s.position }))}
          logo={brand.logo}
          picked={B?.name}
          onPick={setB}
        />
        {stats.some((s) => s.position === null) ? <p className="aw-small px-5 pb-3">Brands never named have no position, so they are not on the chart. They are in the table below.</p> : null}
        <div className="max-h-[480px] overflow-y-auto border-t border-rule">
          <table className="aw-table">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="w-12">#</th>
                <SortTh id="name" sort={sort} onSort={setSort} text>
                  Brand
                </SortTh>
                <SortTh id="visibility" sort={sort} onSort={setSort} className="w-56">
                  Visibility
                  <Tip text={TIPS.visibility} />
                </SortTh>
                <SortTh id="position" sort={sort} onSort={setSort} className="w-56">
                  Position
                  <Tip text={TIPS.position} />
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {sortRows(stats.slice(0, MAX_BRANDS), sort, {
                name: (s) => s.name,
                visibility: (s) => s.visibility,
                position: (s) => (s.position === null ? null : -s.position),
              }).map((s, i) => {
                const w = was(s.name);
                return (
                  <tr
                    key={s.name}
                    onClick={() => !s.isYou && setB(s.name)}
                    className={`${s.isYou ? "is-you" : "cursor-pointer"} ${B?.name === s.name ? "bg-brand-pale" : ""}`}
                    aria-selected={B?.name === s.name}
                    title={s.isYou ? undefined : `Compare ${s.name} with ${A.name}`}
                  >
                    <td className="aw-num text-muted">{i + 1}</td>
                    <td>
                      <BrandName name={s.name} domain={s.domain} logo={s.isYou ? brand.logo : undefined} isYou={s.isYou} size={20} />
                    </td>
                    <td className="aw-num whitespace-nowrap">
                      {pct(s.visibility)} {hadBefore ? <Delta now={s.visibility} before={w?.visibility ?? 0} /> : null}
                    </td>
                    <td className="aw-num whitespace-nowrap">
                      {pos(s.position)} {hadBefore && w ? <Delta now={s.position} before={w.position} lowerIsBetter /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {topics.length ? (
        <Card title="Who wins each topic">
          <div className="overflow-x-auto">
            <table className="aw-table">
              <thead>
                <tr>
                  <th>Topic</th>
                  {gridBrands.map((g) => (
                    <th key={g.name} className="w-40">
                      {g.isYou ? (
                        <BrandName name={g.name} domain={g.domain} logo={brand.logo} isYou size={16} />
                      ) : (
                        <button type="button" onClick={() => setB(g.name)} title={`Compare ${g.name} with ${A.name}`} className="text-left">
                          <BrandName name={g.name} domain={g.domain} size={16} />
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.map((g) => (
                  <tr key={g.topic}>
                    <td className="max-w-72">
                      <button type="button" onClick={() => onTopic(g.topic)} className="aw-text-link truncate text-left" title={`Open ${g.topic} on the Prompts page`}>
                        {g.topic}
                      </button>
                    </td>
                    {gridBrands.map((x) => {
                      const lead = g.leader === x.name;
                      return (
                        <td key={x.name} className={x.isYou ? "bg-brand-pale" : ""}>
                          <span className="flex items-center gap-2">
                            <span className={`aw-num ${lead ? "font-medium text-ink" : "text-body"}`}>{pct(g.values[x.name])}</span>
                            {lead ? <span className="aw-status aw-status--ranked px-1.5! py-0.5! text-[10px]!">Leader</span> : null}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {B && card ? (
        <section className="aw-frame">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-rule px-6 py-5">
            <h2 className="aw-h3">Battle card</h2>
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-2">
                <i className="inline-block h-3 w-3" style={{ background: YOU_COLOR }} />
                {picker(A.name, setA, "Brand A", B.name)}
              </span>
              <span className="aw-label">vs</span>
              <span className="flex items-center gap-2">
                <i className="inline-block h-3 w-3" style={{ background: B_COLOR }} />
                {picker(B.name, setB, "Brand B", A.name)}
              </span>
            </div>
          </div>

          <div className="grid gap-px bg-rule-faint md:grid-cols-2 xl:grid-cols-4">
            {[
              { lab: "Visibility", tip: TIPS.visibility, f: (s: typeof A) => pct(s.visibility), d: (s: typeof A) => (hadBefore ? <Delta now={s.visibility} before={was(s.name)?.visibility ?? 0} /> : null) },
              { lab: "Sentiment", tip: TIPS.sentiment, f: (s: typeof A) => score(s.sentiment), d: (s: typeof A) => (hadBefore && was(s.name) ? <Delta now={s.sentiment} before={was(s.name)!.sentiment} digits={0} /> : null) },
              { lab: "Position", tip: TIPS.position, f: (s: typeof A) => pos(s.position), d: (s: typeof A) => (hadBefore && was(s.name) ? <Delta now={s.position} before={was(s.name)!.position} lowerIsBetter /> : null) },
              {
                lab: "Rank by visibility",
                tip: "Place among all brands named in this period, by visibility.",
                f: (s: typeof A) => {
                  const r = rankFor(s.name);
                  return r ? `${r.rank} of ${r.of}` : "–";
                },
                d: () => null,
              },
            ].map((m) => (
              <div key={m.lab} className="flex flex-col gap-3 bg-white px-6 py-5">
                <span className="aw-label">
                  {m.lab}
                  <Tip text={m.tip} />
                </span>
                {[
                  { s: A, color: YOU_COLOR },
                  { s: B, color: B_COLOR },
                ].map(({ s, color }) => (
                  <span key={s.name} className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2 text-[13px] text-body">
                      <i className="inline-block h-2.5 w-2.5 shrink-0" style={{ background: color }} />
                      <span className="truncate">{s.name}</span>
                    </span>
                    <span className="flex items-baseline gap-2">
                      <span className="aw-num text-[22px] leading-none text-ink">{m.f(s)}</span>
                      {m.d(s)}
                    </span>
                  </span>
                ))}
              </div>
            ))}
          </div>

          <div className="border-t border-rule-faint px-4 pt-4 pb-2">
            <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-2">
              <span className="aw-label">Over time</span>
              <Seg
                label="Chart metric"
                value={metric}
                onChange={setMetric}
                options={[
                  { id: "visibility", label: "Visibility" },
                  { id: "sentiment", label: "Sentiment" },
                  { id: "position", label: "Position" },
                ]}
              />
            </div>
            <TrendChart
              points={trend(current, [A.name, B.name], metric, filter)}
              metric={metric}
              mode="line"
              lines={[
                { name: A.name, color: YOU_COLOR, isYou: true },
                { name: B.name, color: B_COLOR, isYou: false },
              ]}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-6 py-4">
            <span className="aw-label">Visibility, side by side</span>
            <Seg
              label="Compare by"
              value={split}
              onChange={setSplit}
              options={[
                { id: "model", label: "By model" },
                { id: "topic", label: "By topic" },
                { id: "prompt", label: "By prompt" },
              ]}
            />
          </div>
          <div className="max-h-[640px] overflow-auto border-t border-rule-faint">
            <table className="aw-table">
              <thead className="sticky top-0 z-10">
                <tr>
                  <SortTh id="key" sort={h2h} onSort={setH2h} text>
                    {split === "model" ? "Model" : split === "topic" ? "Topic" : "Prompt"}
                  </SortTh>
                  <SortTh id="a" sort={h2h} onSort={setH2h} className="w-56">
                    {A.name}
                  </SortTh>
                  <SortTh id="b" sort={h2h} onSort={setH2h} className="w-56">
                    {B.name}
                  </SortTh>
                  <SortTh id="gap" sort={h2h} onSort={setH2h} className="w-36">
                    Gap
                    <Tip text={`${A.name}'s visibility minus ${B.name}'s, in points.`} />
                  </SortTh>
                </tr>
              </thead>
              <tbody>
                {sortRows(rows, h2h, {
                  key: (r) => r.key,
                  a: (r) => r.a,
                  b: (r) => r.b,
                  gap: (r) => (r.a === null || r.b === null ? null : r.a - r.b),
                }).map((r) => {
                  const gap = r.a === null || r.b === null ? null : Math.round(r.a - r.b);
                  return (
                    <tr key={`${r.topic ?? ""}-${r.key}`}>
                      <td className="max-w-md">
                        {split === "model" ? (
                          <EngineName engine={r.key} size={16} />
                        ) : (
                          <span className="flex flex-col">
                            <span className="text-ink">{r.key}</span>
                            {r.topic ? <span className="aw-micro">{r.topic}</span> : null}
                          </span>
                        )}
                      </td>
                      <td>
                        <Bar v={r.a} color={YOU_COLOR} />
                      </td>
                      <td>
                        <Bar v={r.b} color={B_COLOR} />
                      </td>
                      <td className="aw-num whitespace-nowrap">
                        {gap === null ? (
                          <span className="text-muted">–</span>
                        ) : gap === 0 ? (
                          <span className="text-muted">Even</span>
                        ) : (
                          <span className={gap > 0 ? "text-pos" : "text-neg"}>
                            {gap > 0 ? `${A.name} +${gap}` : `${B.name} +${-gap}`}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

        </section>
      ) : null}
    </div>
  );
}
