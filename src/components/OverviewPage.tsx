"use client";

import { useState } from "react";
import { answered, brandStats, competitorDomains, domainRows, metricOf, rankOf, trend, typeShares, urlRows, type Metric, type SourceType } from "@/lib/metrics";
import type { View } from "@/lib/view";
import { Donut, Legend } from "./Donut";
import { TrendChart, type Line } from "./TrendChart";
import { BrandName, Card, Delta, Empty, favicon, OTHER_COLORS, pct, pos, score, Seg, YOU_COLOR } from "./ui";
import { BrandLogo } from "./BrandLogo";

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

function Rank({ label, now, before }: { label: string; now: { rank: number; of: number } | null; before: { rank: number; of: number } | null }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px] text-muted">
      {label}:
      <b className="aw-num text-ink">{now ? `${now.rank}/${now.of}` : "–"}</b>
      {now && before && now.rank !== before.rank ? (
        <span className={now.rank < before.rank ? "text-pos" : "text-neg"} title={now.rank < before.rank ? "Moved up" : "Moved down"}>
          {now.rank < before.rank ? "↑" : "↓"}
        </span>
      ) : null}
    </span>
  );
}

/** Peec-style overview: trend chart, competitors, sites and site types. */
export function OverviewPage({ view, onOpen }: { view: View; onOpen: (page: "competitors" | "domains" | "urls") => void }) {
  const [metric, setMetric] = useState<Metric>("visibility");
  const [mode, setMode] = useState<"line" | "bar">("line");
  const [srcTab, setSrcTab] = useState<"domains" | "urls">("domains");
  const { brand, current, previous, filter, days } = view;
  const you = { name: brand.name, domain: brand.domain };

  const chats = answered(current, filter);
  if (!chats.length) {
    return <Empty>No results in the last {days} days. Click Run now, or wait for the daily run.</Empty>;
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

  const comp = competitorDomains(stats);
  const domains = domainRows(chats, brand.domain, comp);
  const urls = urlRows(chats, brand.domain, comp);
  const shares = typeShares(domains);
  const ownShare = shares.find((s) => s.type === "You")?.share ?? 0;

  const change = hadBefore ? me.visibility - (meBefore?.visibility ?? 0) : null;
  const headline =
    change === null
      ? `${brand.name}'s visibility is ${pct(me.visibility)} in the last ${days} days`
      : `${brand.name}'s visibility is ${Math.abs(change) < 0.5 ? "steady" : `trending ${change > 0 ? "up" : "down"} by ${Math.abs(change).toFixed(1)} points`} vs the ${days} days before`;

  return (
    <div className="flex flex-col gap-5">
      <div className="aw-frame flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <span className="text-[15px] text-ink">
          <span className="font-medium">Overview</span>
          <span className="text-muted"> · </span>
          {headline}
        </span>
        <span className="flex flex-wrap items-center gap-4">
          <Rank label="Visibility" now={rankOf(stats, "visibility")} before={hadBefore ? rankOf(before, "visibility") : null} />
          <Rank label="Sentiment" now={rankOf(stats, "sentiment")} before={hadBefore ? rankOf(before, "sentiment") : null} />
          <Rank label="Position" now={rankOf(stats, "position")} before={hadBefore ? rankOf(before, "position") : null} />
        </span>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
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
                  <th>Brand</th>
                  <th>Visibility</th>
                  <th>Sentiment</th>
                  <th>Position</th>
                </tr>
              </thead>
              <tbody>
                {stats.slice(0, 8).map((s, i) => {
                  const b = prevOf(s.name);
                  return (
                    <tr key={s.name} className={s.isYou ? "is-you" : ""}>
                      <td className="aw-num text-muted">{i + 1}</td>
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

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Card>
          <div className="flex items-center justify-between gap-3 border-b border-rule-faint px-5 py-3">
            <Seg
              label="Sources"
              value={srcTab}
              onChange={setSrcTab}
              options={[
                { id: "domains", label: "Domains" },
                { id: "urls", label: "URLs" },
              ]}
            />
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => onOpen(srcTab)}>
              View all
            </button>
          </div>
          <div className="overflow-x-auto">
            {srcTab === "domains" ? (
              <table className="aw-table aw-table--compact">
                <thead>
                  <tr>
                    <th className="w-8">#</th>
                    <th>Domain</th>
                    <th>Type</th>
                    <th>Used</th>
                    <th>Avg. citations</th>
                  </tr>
                </thead>
                <tbody>
                  {domains.slice(0, 8).map((d, i) => (
                    <tr key={d.domain} className={d.type === "You" ? "is-you" : ""}>
                      <td className="aw-num text-muted">{i + 1}</td>
                      <td>
                        <span className="flex items-center gap-2 text-ink">
                          <BrandLogo src={favicon(d.domain)} name={d.domain} size={18} />
                          {d.domain}
                        </span>
                      </td>
                      <td>
                        <TypeTag type={d.type} />
                      </td>
                      <td className="aw-num">{pct(d.used)}</td>
                      <td className="aw-num">{d.avgCitations.toFixed(1)}</td>
                    </tr>
                  ))}
                  {!domains.length ? (
                    <tr>
                      <td colSpan={5} className="aw-small">
                        No sites cited yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            ) : (
              <table className="aw-table aw-table--compact">
                <thead>
                  <tr>
                    <th className="w-8">#</th>
                    <th>URL</th>
                    <th>Type</th>
                    <th>Used</th>
                  </tr>
                </thead>
                <tbody>
                  {urls.slice(0, 8).map((u, i) => (
                    <tr key={u.url}>
                      <td className="aw-num text-muted">{i + 1}</td>
                      <td className="max-w-md">
                        <a href={u.url} target="_blank" rel="noopener noreferrer nofollow" className="flex min-w-0 items-center gap-2">
                          <BrandLogo src={favicon(u.domain)} name={u.domain} size={18} />
                          <span className="truncate">{u.title || u.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                        </a>
                      </td>
                      <td>
                        <TypeTag type={u.type} />
                      </td>
                      <td className="aw-num">{pct(u.used)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        <Card
          title="Domains by type"
          action={
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => onOpen("domains")} aria-label="Open domains">
              ↗
            </button>
          }
        >
          <div className="flex flex-col items-center gap-5 p-5 sm:flex-row sm:items-center">
            <Donut
              label="Share of citations by site type"
              slices={shares.map((s) => ({ label: s.type, value: s.share, color: TYPE_COLORS[s.type] }))}
              center={
                <>
                  <span className="aw-num text-[24px] font-semibold text-ink">{pct(ownShare)}</span>
                  <span className="text-[11px] text-muted">your site</span>
                </>
              }
            />
            <Legend slices={shares.filter((s) => s.share > 0).map((s) => ({ label: s.type, value: s.share, color: TYPE_COLORS[s.type] }))} />
          </div>
        </Card>
      </div>
    </div>
  );
}
