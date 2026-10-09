"use client";

import { useState } from "react";
import { answered, battle, brandStats, rankOf, topicGrid, trend, type BattleRow, type BrandStat } from "@/lib/metrics";
import type { View } from "@/lib/view";
import { BrandLogo } from "./BrandLogo";
import { EngineName } from "./Engines";
import { TrendChart } from "./TrendChart";
import { BrandName, Card, Delta, Empty, favicon, guessDomain, pct, pos, score, Seg, sortRows, SidePanel, SortTh, Tip, TIPS, useSort, YOU_COLOR } from "./ui";

const B_COLOR = "#F5B70A";
const MAX_BRANDS = 50;
const SHOWN = 10; // brands on the chart at first

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
const SHOWN_ROWS = 9; // rows in the table before View all
const quadLabel = "text-[12px] font-medium tracking-wide text-ink uppercase";

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx={12} cy={12} r={3} />
    </svg>
  );
}

function RankIcon() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M4 20V12M10 20V6M16 20v-10M22 20H2" />
    </svg>
  );
}

/**
 * Each brand as its logo, in four quadrants. Up is named more often. Right is named higher in the list.
 * The middle lines are 50% visibility and the middle spot in the list.
 */
function Quadrant({
  dots,
  logo,
  picked,
  hover,
  onHover,
  onPick,
  crown,
}: {
  dots: Dot[];
  logo?: string;
  picked?: string;
  hover: string | null;
  onHover: (n: string | null) => void;
  onPick: (name: string) => void;
  crown: string | null;
}) {
  const worst = Math.max(4, Math.ceil(Math.max(...dots.map((d) => d.position), 1)));
  const mid = (worst + 1) / 2;
  // Kept 5% in from each edge so logos at the ends are not cut off.
  const x = (p: number) => 5 + ((worst - p) / (worst - 1)) * 90;
  const y = (v: number) => 5 + (100 - v) * 0.9;
  const ticks = Array.from({ length: worst }, (_, i) => i + 1).filter((t) => worst <= 8 || t % 2 === 1 || t === worst);
  return (
    <div className="flex h-full min-h-0 flex-col gap-1 p-4">
      <div className="flex justify-between gap-3 pl-[76px] pb-1">
        <span className={quadLabel}>Challengers</span>
        <span className={quadLabel}>Leaders</span>
      </div>
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="flex w-7 shrink-0 flex-col items-center">
          <span className="text-[12px] leading-none text-ink">▲</span>
          <span className="w-0.5 flex-1 bg-ink" />
          <span className="flex flex-1 rotate-180 items-center gap-1.5 py-2 text-[12px] font-medium whitespace-nowrap text-ink [writing-mode:vertical-rl]">
            <EyeIcon />
            Visibility
          </span>
          <span className="w-0.5 flex-1 bg-ink" />
        </div>
        <div className="relative w-9 shrink-0 font-mono text-[11px] text-ink">
          {[100, 75, 50, 25, 0].map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${y(t)}%` }}>
              {t}%
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1 border border-rule bg-white">
          <span className="absolute top-0 bg-brand-pale" style={{ left: `${x(mid)}%`, width: `${100 - x(mid)}%`, height: `${y(50)}%` }} aria-hidden="true" />
          {[0, 25, 75, 100].map((t) => (
            <span key={t} className="absolute right-0 left-0 border-t border-rule-faint" style={{ top: `${y(t)}%` }} />
          ))}
          <span className="absolute right-0 left-0 border-t-2 border-ink/40" style={{ top: `${y(50)}%` }} />
          <span className="absolute top-0 bottom-0 border-l-2 border-ink/40" style={{ left: `${x(mid)}%` }} />
          {dots.map((d) => {
            const on = hover === d.name;
            const size = d.isYou ? 36 : 30;
            return (
              <button
                key={d.name}
                type="button"
                onClick={() => !d.isYou && onPick(d.name)}
                onMouseEnter={() => onHover(d.name)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(d.name)}
                onBlur={() => onHover(null)}
                aria-label={`${d.name}: visibility ${Math.round(d.visibility)}%, average position #${d.position.toFixed(1)}`}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-[10px] border-2 bg-white p-1 transition-transform ${d.isYou ? "border-brand shadow-[3px_3px_0_0_var(--aw-brand)]" : picked === d.name ? "border-ink shadow-[3px_3px_0_0_#F5B70A]" : "border-ink shadow-[3px_3px_0_0_var(--aw-ink)]"} ${on ? "z-30 -translate-y-[calc(50%+2px)] scale-115" : "z-10 hover:z-30"}`}
                style={{ left: `${x(d.position)}%`, top: `${y(d.visibility)}%` }}
              >
                {crown === d.name ? (
                  <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[18px] leading-none" role="img" aria-label="Best brand">
                    👑
                  </span>
                ) : null}
                {d.isYou ? (
                  <span className="absolute top-1/2 right-full mr-1 -translate-y-1/2 text-[22px] leading-none" role="img" aria-label="You">
                    👉
                  </span>
                ) : null}
                <BrandLogo src={d.isYou && logo ? logo : favicon(d.domain || guessDomain(d.name))} name={d.name} size={size} />
                <span
                  className={`pointer-events-none absolute top-full left-1/2 mt-1 -translate-x-1/2 px-1.5 py-0.5 text-[11px] whitespace-nowrap ${on ? "bg-[var(--aw-ink)] text-white" : d.isYou ? "font-medium text-ink" : "hidden"}`}
                >
                  {on ? `${d.name} · ${pct(d.visibility)} · #${d.position.toFixed(1)}` : "You"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex gap-2">
        <span className="w-[76px] shrink-0" />
        <div className="relative h-5 flex-1 font-mono text-[11px] text-ink">
          {ticks.map((t) => (
            <span key={t} className="absolute top-0.5 -translate-x-1/2" style={{ left: `${x(t)}%` }}>
              #{t}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 pl-[76px] text-[12px] font-medium text-ink">
        <span className="h-0.5 flex-1 bg-ink" />
        <span className="flex items-center gap-1.5">
          <RankIcon />
          Ranking
        </span>
        <span className="h-0.5 flex-1 bg-ink" />
        <span className="-ml-2 leading-none">▶</span>
      </div>
      <div className="flex justify-between gap-3 pl-[76px]">
        <span className={quadLabel}>Rising Stars</span>
        <span className={quadLabel}>Niche Kings</span>
      </div>
    </div>
  );
}

/** Every brand AI names next to yours on a quadrant, who wins each topic, and a battle card for any two brands. */
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
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState<Set<string> | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [a, setA] = useState(brand.name);
  const [b, setB] = useState<string | null>(initial ?? null);
  const [split, setSplit] = useState<"model" | "topic" | "prompt">("model");
  const [h2h, setH2h] = useSort("gap", false);
  const [metric, setMetric] = useState<"visibility" | "sentiment" | "position">("visibility");

  if (!chats.length) return <Empty>No results in the last {days} days yet. They show up after the first check finishes, then update every day.</Empty>;

  const top = stats.slice(0, MAX_BRANDS);
  const defaults = () => new Set([brand.name, ...others.slice(0, SHOWN - 1).map((s) => s.name)]);
  const on = shown ?? defaults();
  const flip = (n: string) => setShown(on.has(n) ? new Set([...on].filter((x) => x !== n)) : new Set([...on, n]));

  const dots: Dot[] = stats
    .filter((s): s is BrandStat & { position: number } => on.has(s.name) && s.position !== null)
    .map((s) => ({ name: s.name, domain: s.domain, isYou: s.isYou, visibility: s.visibility, position: s.position }));
  const best = [...stats].filter((s) => s.position !== null).sort((x, y) => y.visibility - x.visibility || x.position! - y.position!)[0]?.name ?? null;

  const find = (n: string | null) => stats.find((s) => s.name.toLowerCase() === n?.toLowerCase());
  const A = find(a) ?? stats.find((s) => s.isYou)!;
  const B = find(b) ?? others.find((s) => s.name !== A.name) ?? stats.find((s) => s.name !== A.name);
  const was = (name: string) => before.find((x) => x.name.toLowerCase() === name.toLowerCase());
  const rankFor = (name: string) => rankOf(stats.map((s) => ({ ...s, isYou: s.name === name })), "visibility");
  const gridBrands = [stats.find((s) => s.isYou)!, ...others.slice(0, 5)];
  const grid = topicGrid(chats, topics, gridBrands.map((s) => s.name));
  const card = B ? battle(chats, A.name, B.name, engines, topics) : null;
  const rows: BattleRow[] = card ? (split === "model" ? card.byEngine : split === "topic" ? card.byTopic : card.byPrompt) : [];
  const listed = sortRows(
    top.filter((s) => !query.trim() || s.name.toLowerCase().includes(query.trim().toLowerCase())),
    sort,
    { name: (s) => s.name, visibility: (s) => s.visibility, position: (s) => (s.position === null ? null : -s.position) },
  );

  const brandTable = (rows: typeof listed) => (
    <table className="aw-table table-fixed">
      <thead className="sticky top-0 z-10">
        <tr>
          <th className="w-9">
            <input
              type="checkbox"
              aria-label="Show every listed brand on the chart"
              checked={rows.length > 0 && rows.every((s) => on.has(s.name))}
              onChange={(e) => setShown(e.target.checked ? new Set([...on, ...rows.map((s) => s.name)]) : new Set([...on].filter((n) => n === brand.name || !rows.some((s) => s.name === n))))}
              className="h-4 w-4 accent-[var(--aw-brand)]"
            />
          </th>
          <th className="w-10">#</th>
          <SortTh id="name" sort={sort} onSort={setSort} text>
            Brand
          </SortTh>
          <SortTh id="visibility" sort={sort} onSort={setSort} className="w-36">
            Visibility
            <Tip text={TIPS.visibility} />
          </SortTh>
          <SortTh id="position" sort={sort} onSort={setSort} className="w-36">
            Position
            <Tip text={TIPS.position} />
          </SortTh>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => {
          const w = was(s.name);
          return (
            <tr
              key={s.name}
              onClick={() => !s.isYou && setB(s.name)}
              onMouseEnter={() => setHover(s.name)}
              onMouseLeave={() => setHover(null)}
              className={`${s.isYou ? "is-you" : "cursor-pointer"} ${B?.name === s.name || hover === s.name ? "bg-brand-pale" : ""}`}
              aria-selected={B?.name === s.name}
            >
              <td onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={on.has(s.name)} onChange={() => flip(s.name)} aria-label={`Show ${s.name} on the chart`} className="h-4 w-4 accent-[var(--aw-brand)]" />
              </td>
              <td className="aw-num text-muted">{top.indexOf(s) + 1}</td>
              <td className="truncate">
                <span className="flex items-center gap-1">
                  {best === s.name ? (
                    <span role="img" aria-label="Best brand">
                      👑
                    </span>
                  ) : null}
                  <BrandName name={s.name} domain={s.domain} logo={s.isYou ? brand.logo : undefined} isYou={s.isYou} size={20} />
                </span>
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
        {!rows.length ? (
          <tr>
            <td colSpan={5} className="aw-small">
              No brand matches “{query}”.
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );

  const picker = (value: string, onPick: (v: string) => void, label: string, not?: string) => (
    <select aria-label={label} value={value} onChange={(e) => onPick(e.target.value)} className="max-w-56 border border-rule bg-white px-2.5 py-1.5 text-[14px] text-ink focus:border-brand focus:outline-none">
      {top
        .filter((s) => s.name !== not)
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

      <section className="aw-frame">
        <div className="aw-frame__head">
          <h2 className="aw-h4">Competitive analysis</h2>
        </div>
        <div className="grid xl:h-[600px] xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          {/* Left: every brand, with search and a box to show it on the chart */}
          <div className="flex min-h-0 flex-col border-rule xl:border-r">
            <div className="flex flex-wrap items-center gap-3 border-b border-rule-faint px-4 py-3">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search brands" aria-label="Search brands" className="aw-input min-w-40 flex-1 py-1.5! text-[14px]!" />
              {listed.length > SHOWN_ROWS ? (
                <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setFull(true)}>
                  View all {listed.length}
                </button>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {brandTable(listed.slice(0, SHOWN_ROWS))}
            </div>
          </div>

          {/* Right: the quadrant */}
          <div className="flex min-h-[520px] flex-col max-xl:border-t max-xl:border-rule">
            <div className="min-h-0 flex-1">
              <Quadrant dots={dots} logo={brand.logo} picked={B?.name} hover={hover} onHover={setHover} onPick={setB} crown={best} />
            </div>
          </div>
        </div>
      </section>

      {full ? (
        <SidePanel title="All competitors" kicker={`${listed.length} brands · last ${days} days`} onClose={() => setFull(false)}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search brands" aria-label="Search all brands" className="aw-input max-w-md py-1.5! text-[14px]!" />
          <div className="border border-rule">{brandTable(listed)}</div>
        </SidePanel>
      ) : null}

      {topics.length ? (
        <Card title="Topic Leaders">
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

          {/* Click Visibility, Sentiment or Position to chart it */}
          <div className="grid gap-px bg-rule-faint md:grid-cols-2 xl:grid-cols-4" role="tablist" aria-label="Chart metric">
            {[
              { id: "visibility" as const, lab: "Visibility", tip: TIPS.visibility, f: (s: BrandStat) => pct(s.visibility), d: (s: BrandStat) => (hadBefore ? <Delta now={s.visibility} before={was(s.name)?.visibility ?? 0} /> : null) },
              { id: "sentiment" as const, lab: "Sentiment", tip: TIPS.sentiment, f: (s: BrandStat) => score(s.sentiment), d: (s: BrandStat) => (hadBefore && was(s.name) ? <Delta now={s.sentiment} before={was(s.name)!.sentiment} digits={0} /> : null) },
              { id: "position" as const, lab: "Position", tip: TIPS.position, f: (s: BrandStat) => pos(s.position), d: (s: BrandStat) => (hadBefore && was(s.name) ? <Delta now={s.position} before={was(s.name)!.position} lowerIsBetter /> : null) },
              {
                id: null,
                lab: "Rank by visibility",
                tip: "Place among all brands named in this period, by visibility.",
                f: (s: BrandStat) => {
                  const r = rankFor(s.name);
                  return r ? `${r.rank} of ${r.of}` : "–";
                },
                d: () => null,
              },
            ].map((m) => {
              const active = m.id === metric;
              const body = (
                <>
                  <span className="aw-label flex items-center">
                    {m.lab}
                    <Tip text={m.tip} />
                  </span>
                  {[
                    { s: A, color: YOU_COLOR },
                    { s: B, color: B_COLOR },
                  ].map(({ s, color }) => (
                    <span key={s.name} className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2 text-[13px] text-ink">
                        <i className="inline-block h-2.5 w-2.5 shrink-0" style={{ background: color }} />
                        <span className="truncate">{s.name}</span>
                      </span>
                      <span className="flex items-baseline gap-2">
                        <span className="aw-num text-[22px] leading-none text-ink">{m.f(s)}</span>
                        {m.d(s)}
                      </span>
                    </span>
                  ))}
                </>
              );
              return m.id ? (
                <button
                  key={m.lab}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setMetric(m.id!)}
                  className={`flex cursor-pointer flex-col gap-3 px-6 py-5 text-left transition-colors ${active ? "bg-brand-pale shadow-[inset_0_-3px_0_var(--aw-brand)]" : "bg-white hover:bg-surface-2 hover:shadow-[inset_0_-3px_0_var(--aw-rule)]"}`}
                >
                  {body}
                </button>
              ) : (
                <div key={m.lab} className="flex flex-col gap-3 bg-white px-6 py-5">
                  {body}
                </div>
              );
            })}
          </div>

          <div className="border-t border-rule-faint px-4 pt-4 pb-2">
            <TrendChart
              wide
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
                          <span className={gap > 0 ? "text-pos" : "text-neg"}>{gap > 0 ? `${A.name} +${gap}` : `${B.name} +${-gap}`}</span>
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
