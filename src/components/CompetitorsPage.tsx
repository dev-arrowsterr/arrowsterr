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

      <Card title={`Brands named alongside ${brand.name}`} action={<span className="aw-small">Top {Math.min(stats.length, MAX_BRANDS)} of {stats.length} · click one to compare</span>}>
        <div className="max-h-[560px] overflow-y-auto">
          <table className="aw-table">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="w-12">#</th>
                <SortTh id="name" sort={sort} onSort={setSort} text>
                  Brand
                </SortTh>
                <SortTh id="visibility" sort={sort} onSort={setSort} className="w-48">
                  Visibility
                  <Tip text={TIPS.visibility} />
                </SortTh>
                <SortTh id="sentiment" sort={sort} onSort={setSort} className="w-40">
                  Sentiment
                  <Tip text={TIPS.sentiment} />
                </SortTh>
                <SortTh id="position" sort={sort} onSort={setSort} className="w-40">
                  Position
                  <Tip text={TIPS.position} />
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {sortRows(stats.slice(0, MAX_BRANDS).map((s, i) => ({ ...s, rank: i + 1 })), sort, {
                name: (s) => s.name,
                visibility: (s) => s.visibility,
                sentiment: (s) => s.sentiment,
                position: (s) => (s.position === null ? null : -s.position),
              }).map((s) => {
                const w = was(s.name);
                return (
                  <tr
                    key={s.name}
                    onClick={() => !s.isYou && setB(s.name)}
                    className={`${s.isYou ? "is-you" : "cursor-pointer"} ${B?.name === s.name ? "bg-brand-pale" : ""}`}
                    aria-selected={B?.name === s.name}
                    title={s.isYou ? undefined : `Compare ${s.name} with ${A.name}`}
                  >
                    <td className="aw-num text-muted">{s.rank}</td>
                    <td>
                      <BrandName name={s.name} domain={s.domain} logo={s.isYou ? brand.logo : undefined} isYou={s.isYou} size={20} />
                    </td>
                    <td className="aw-num whitespace-nowrap">
                      {pct(s.visibility)} {hadBefore ? <Delta now={s.visibility} before={w?.visibility ?? 0} /> : null}
                    </td>
                    <td className="aw-num whitespace-nowrap">
                      {score(s.sentiment)} {hadBefore && w ? <Delta now={s.sentiment} before={w.sentiment} digits={0} /> : null}
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

          <div className="border-t border-rule-faint px-4 pt-5 pb-2">
            <span className="aw-label px-2">Visibility over time</span>
            <TrendChart
              points={trend(current, [A.name, B.name], "visibility", filter)}
              metric="visibility"
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

          <div className="grid gap-px border-t border-rule bg-rule-faint lg:grid-cols-2">
            {[
              { s: A, list: card.sitesA, color: YOU_COLOR },
              { s: B, list: card.sitesB, color: B_COLOR },
            ].map(({ s, list, color }) => (
              <div key={s.name} className="flex flex-col bg-white">
                <span className="aw-label flex items-center gap-2 px-6 pt-5 pb-2">
                  <i className="inline-block h-2.5 w-2.5" style={{ background: color }} />
                  Sites cited when {s.name} is named
                </span>
                <ul className="divide-y divide-rule-faint">
                  {list.map((d) => (
                    <li key={d.domain} className="flex items-center justify-between gap-3 px-6 py-2.5 text-[14px]">
                      <span className="flex min-w-0 items-center gap-2 text-ink">
                        <BrandLogo src={favicon(d.domain)} name={d.domain} size={16} />
                        <span className="truncate">{d.domain}</span>
                      </span>
                      <span className="aw-num text-muted">{d.count}×</span>
                    </li>
                  ))}
                  {!list.length ? <li className="aw-small px-6 py-4">No sites cited yet.</li> : null}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
