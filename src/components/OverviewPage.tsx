"use client";

import { useState } from "react";
import { answered, brandStats, metricOf, promptGaps, rankOf, topicGrid, topicRows, trend, type Metric, type SourceType } from "@/lib/metrics";
import type { View } from "@/lib/view";
import { TrendChart, type Line } from "./TrendChart";
import { BrandName, Card, Delta, Empty, OTHER_COLORS, pct, pos, score, Seg, sortRows, SortTh, useSort, YOU_COLOR } from "./ui";

export const TYPE_COLORS: Record<SourceType, string> = {
  You: "#0943B0",
  Competitor: "#B3241A",
  UGC: "#2E6BE0",
  Reviews: "#F5B70A",
  Editorial: "#D08A4E",
  Reference: "#28A745",
  Corporate: "#A6AEBB",
};

export function TypeTag({ type }: { type: SourceType }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-white px-2 py-0.5 text-[12px] font-medium text-body">
      <i className="inline-block h-2 w-2 rounded-full" style={{ background: TYPE_COLORS[type] }} />
      {type}
    </span>
  );
}

const METRICS: { id: Metric; label: string }[] = [
  { id: "visibility", label: "Visibility" },
  { id: "sentiment", label: "Sentiment" },
  { id: "position", label: "Position" },
];

/** Position as a 0 to 100 score: #1 is 100, and each spot down takes 10 points off. */
export const positionScore = (p: number | null) => (p === null ? null : Math.max(0, 110 - p * 10));

/** The scoreboard: your scores, trend, top competitors, each topic and the biggest gaps. Topics and gaps open the Prompts page. */
export function OverviewPage({ view, onOpen }: { view: View; onOpen: (page: "competitors" | "prompts", name?: string) => void }) {
  const [metric, setMetric] = useState<Metric>("visibility");
  const [mode, setMode] = useState<"line" | "bar">("line");
  const [brandSort, setBrandSort] = useSort("visibility");
  const { brand, current, previous, filter, days, topics, engines } = view;
  const you = { name: brand.name, domain: brand.domain };

  const chats = answered(current, filter);
  if (!chats.length) {
    return <Empty>No results in the last {days} days yet. They show up after the first check finishes, then update every day.</Empty>;
  }
  const stats = brandStats(chats, you);
  const before = brandStats(answered(previous, filter), you);
  const prevOf = (name: string) => before.find((b) => b.name.toLowerCase() === name.toLowerCase());
  const me = stats.find((s) => s.isYou)!;
  const meBefore = before.find((s) => s.isYou);
  const hadBefore = answered(previous, filter).length > 0;

  const top = [me, ...stats.filter((s) => !s.isYou)].slice(0, 6);
  const lines: Line[] = top.map((s, i) => ({ name: s.name, isYou: s.isYou, color: s.isYou ? YOU_COLOR : OTHER_COLORS[(i - 1) % OTHER_COLORS.length] }));
  const points = trend(current, lines.map((l) => l.name), metric, filter);

  const byTopic = topicRows(chats, topics, engines, brand.name);
  const grid = topicGrid(chats, topics, [...new Set([me.name, ...stats.slice(0, 10).map((s) => s.name)])]);
  const gaps = promptGaps(chats, topics, brand.name);

  const change = hadBefore ? me.visibility - (meBefore?.visibility ?? 0) : null;
  const headline =
    change === null
      ? `${brand.name}'s visibility is ${pct(me.visibility)} in the last ${days} days`
      : `${brand.name}'s visibility is ${Math.abs(change) < 0.5 ? "steady" : `trending ${change > 0 ? "up" : "down"} by ${Math.abs(change).toFixed(1)} points`} vs the ${days} days before`;

  return (
    <div className="flex flex-col gap-5">
      <section className="aw-frame">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3.5">
          <span className="text-[15px] text-ink">
            <span className="font-medium">Overview</span>
            <span className="text-muted"> · </span>
            {headline}
          </span>
          <span className="aw-label">Scores out of 100</span>
        </div>
        <div className="grid sm:grid-cols-3">
          {(
            [
              { id: "visibility", lab: "Visibility", now: me.visibility, before: hadBefore ? (meBefore?.visibility ?? 0) : null, help: "Share of AI answers that name you" },
              { id: "sentiment", lab: "Sentiment", now: me.sentiment, before: hadBefore ? (meBefore?.sentiment ?? null) : null, help: "How well AI talks about you" },
              { id: "position", lab: "Position", now: positionScore(me.position), before: hadBefore ? positionScore(meBefore?.position ?? null) : null, help: me.position === null ? "Not named yet" : `Average spot #${me.position.toFixed(1)} in the list` },
            ] as const
          ).map((m, i) => {
            const r = rankOf(stats, m.id);
            const rb = hadBefore ? rankOf(before, m.id) : null;
            return (
              <div key={m.id} className={`flex flex-col gap-3 px-5 py-5 ${i ? "border-t border-rule sm:border-t-0 sm:border-l" : ""}`}>
                <span className="aw-label">{m.lab}</span>
                <span className="flex items-baseline gap-2">
                  <span className="aw-num text-[38px] leading-none tracking-tight text-ink">{m.now === null ? "–" : Math.round(m.now)}</span>
                  <span className="aw-num text-[14px] text-muted">/100</span>
                  <Delta now={m.now} before={m.before} digits={0} />
                </span>
                <span className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
                  {m.help}
                  <span className="aw-num">
                    {r ? `Rank ${r.rank} of ${r.of}` : "Not ranked"}
                    {r && rb && r.rank !== rb.rank ? <span className={r.rank < rb.rank ? "text-pos" : "text-neg"}>{r.rank < rb.rank ? " ↑" : " ↓"}</span> : null}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-faint px-5 py-3">
            <Seg label="Metric" value={metric} onChange={setMetric} options={METRICS} />
            <Seg
              label="Chart type"
              value={mode}
              onChange={setMode}
              options={[
                { id: "line", label: "Line" },
                { id: "bar", label: "Bar" },
              ]}
            />
          </div>
          <div className="px-3 pt-4 pb-2">
            <TrendChart points={points} lines={lines} metric={metric} mode={mode} />
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 px-5 pb-4">
            {lines.map((l) => (
              <li key={l.name} className="flex items-center gap-2 text-[13px] text-body">
                <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />
                {l.name}
                <b className="aw-num text-ink">
                  {metric === "visibility" ? pct(metricOf(top.find((t) => t.name === l.name), metric)) : metric === "position" ? pos(metricOf(top.find((t) => t.name === l.name), metric)) : score(metricOf(top.find((t) => t.name === l.name), metric))}
                </b>
              </li>
            ))}
          </ul>
        </Card>

        <Card
          title={`${brand.name}'s competitors`}
          action={
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => onOpen("competitors")} aria-label="Open competitors">
              ↗
            </button>
          }
        >
          <div className="overflow-x-auto">
            <table className="aw-table aw-table--compact">
              <thead>
                <tr>
                  <th className="w-8">#</th>
                  <SortTh id="name" sort={brandSort} onSort={setBrandSort} text>
                    Brand
                  </SortTh>
                  <SortTh id="visibility" sort={brandSort} onSort={setBrandSort}>
                    Visibility
                  </SortTh>
                  <SortTh id="sentiment" sort={brandSort} onSort={setBrandSort}>
                    Sentiment
                  </SortTh>
                  <SortTh id="position" sort={brandSort} onSort={setBrandSort}>
                    Position
                  </SortTh>
                </tr>
              </thead>
              <tbody>
                {sortRows(stats.slice(0, 6).map((s, i) => ({ ...s, rank: i + 1 })), brandSort, {
                  name: (s) => s.name,
                  visibility: (s) => s.visibility,
                  sentiment: (s) => s.sentiment,
                  position: (s) => (s.position === null ? null : -s.position),
                }).map((s) => {
                  const b = prevOf(s.name);
                  return (
                    <tr
                      key={s.name}
                      className={s.isYou ? "is-you" : "cursor-pointer"}
                      onClick={() => !s.isYou && onOpen("competitors", s.name)}
                      title={s.isYou ? undefined : `Open ${s.name}`}
                    >
                      <td className="aw-num text-muted">{s.rank}</td>
                      <td className="max-w-40">
                        <BrandName name={s.name} domain={s.domain} logo={s.isYou ? brand.logo : undefined} isYou={s.isYou} size={18} />
                      </td>
                      <td className="aw-num whitespace-nowrap">
                        {pct(s.visibility)} {hadBefore ? <Delta now={s.visibility} before={b?.visibility ?? 0} /> : null}
                      </td>
                      <td className="aw-num whitespace-nowrap">
                        {score(s.sentiment)} {hadBefore ? <Delta now={s.sentiment} before={b?.sentiment ?? null} digits={0} /> : null}
                      </td>
                      <td className="aw-num whitespace-nowrap">
                        {pos(s.position)} {hadBefore ? <Delta now={s.position} before={b?.position ?? null} lowerIsBetter /> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card
          title="Visibility by topic"
          action={
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => onOpen("prompts")}>
              All prompts
            </button>
          }
        >
          <ul className="divide-y divide-rule-faint">
            {byTopic.map((t) => {
              const g = grid.find((x) => x.topic === t.topic);
              const lead = g?.leader && g.leader.toLowerCase() !== brand.name.toLowerCase() ? g.leader : null;
              return (
                <li key={t.topic}>
                  <button type="button" onClick={() => onOpen("prompts", t.topic)} className="flex w-full flex-col gap-2 px-5 py-3.5 text-left hover:bg-surface-2" title={`Open ${t.topic} on the Prompts page`}>
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-[14px] text-ink">
                        {t.topic} <span className="text-muted">· {t.prompts} prompts</span>
                      </span>
                      <span className="aw-num text-[15px] text-ink">{pct(t.visibility)}</span>
                    </span>
                    <span className="block h-1.5 bg-rule-faint">
                      <span className="block h-full bg-brand" style={{ width: `${t.visibility ?? 0}%` }} />
                    </span>
                    <span className="aw-small">{g?.leader ? (lead ? `Leader: ${lead} at ${pct(g.values[lead])}` : "You lead this topic") : "No brands named yet"}</span>
                  </button>
                </li>
              );
            })}
            {!byTopic.length ? <li className="aw-small px-5 py-4">No topics yet. Add them on the Prompts page.</li> : null}
          </ul>
        </Card>

        <Card title="Biggest gaps">
          <ul className="divide-y divide-rule-faint">
            {gaps.slice(0, 5).map((g) => (
              <li key={g.prompt}>
                <button type="button" onClick={() => onOpen("prompts", g.topic)} className="flex w-full items-start justify-between gap-3 px-5 py-3 text-left hover:bg-surface-2">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[14px] text-ink">{g.prompt}</span>
                    <span className="aw-micro">{g.topic}</span>
                  </span>
                  <span className="aw-num shrink-0 text-right text-[12px]">
                    <span className="block text-ink">
                      {g.leader} {pct(g.them)}
                    </span>
                    <span className="text-muted">you {pct(g.you)}</span>
                  </span>
                </button>
              </li>
            ))}
            {!gaps.length ? <li className="aw-small px-5 py-4">No gaps. You show up at least as often as any other brand on every prompt.</li> : null}
          </ul>
        </Card>
      </div>
    </div>
  );
}
