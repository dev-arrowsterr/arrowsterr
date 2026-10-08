"use client";

import { useState } from "react";
import { answered, brandStats, competitorDetail, trend } from "@/lib/metrics";
import type { View } from "@/lib/view";
import { BrandLogo } from "./BrandLogo";
import { EngineName } from "./Engines";
import { TrendChart } from "./TrendChart";
import { BrandName, Card, Delta, Empty, favicon, pct, pos, score, Seg, sortRows, SortTh, useSort, YOU_COLOR } from "./ui";

const THEM_COLOR = "#F5B70A";

/** A value with a thin bar under it. */
function Bar({ v, color }: { v: number | null; color: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="aw-num w-10 text-right text-[13px] text-ink">{pct(v)}</span>
      <span className="h-1.5 flex-1 bg-rule-faint">
        <span className="block h-full" style={{ width: `${v ?? 0}%`, background: color }} />
      </span>
    </span>
  );
}

/** Every competitor ranked, and a detailed view of the one you pick. */
export function CompetitorsPage({ view, initial }: { view: View; initial?: string | null }) {
  const { brand, current, previous, filter, topics, engines, days } = view;
  const you = { name: brand.name, domain: brand.domain };
  const chats = answered(current, filter);
  const stats = brandStats(chats, you);
  const before = brandStats(answered(previous, filter), you);
  const hadBefore = answered(previous, filter).length > 0;
  const others = stats.filter((s) => !s.isYou);
  const [picked, setPicked] = useState<string | null>(initial ?? null);
  const [split, setSplit] = useState<"model" | "topic">("model");
  const [sort, setSort] = useSort("visibility");
  const [h2h, setH2h] = useSort("key", false);
  const sel = others.find((s) => s.name.toLowerCase() === picked?.toLowerCase()) ?? others[0];

  if (!chats.length) return <Empty>No results in the last {days} days yet. They show up after the first check finishes, then update every day.</Empty>;

  const detail = sel ? competitorDetail(chats, sel.name, brand.name, engines, topics) : null;
  const me = stats.find((s) => s.isYou)!;
  const points = sel ? trend(current, [sel.name, brand.name], "visibility", filter) : [];

  return (
    <div className="flex flex-col gap-5">
      <h1 className="aw-h2">Competitors</h1>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title={`${others.length} brands named alongside ${brand.name}`} className="self-start">
          <div className="max-h-[720px] overflow-y-auto">
            <table className="aw-table aw-table--compact aw-table--tight">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="w-8">#</th>
                  <SortTh id="name" sort={sort} onSort={setSort} text>
                    Brand
                  </SortTh>
                  <SortTh id="visibility" sort={sort} onSort={setSort}>
                    Visibility
                  </SortTh>
                  <SortTh id="sentiment" sort={sort} onSort={setSort}>
                    Sentiment
                  </SortTh>
                  <SortTh id="position" sort={sort} onSort={setSort}>
                    Position
                  </SortTh>
                </tr>
              </thead>
              <tbody>
                {sortRows(stats.map((s, i) => ({ ...s, rank: i + 1 })), sort, {
                  name: (s) => s.name,
                  visibility: (s) => s.visibility,
                  sentiment: (s) => s.sentiment,
                  position: (s) => (s.position === null ? null : -s.position),
                }).map((s) => {
                  const b = before.find((x) => x.name.toLowerCase() === s.name.toLowerCase());
                  return (
                    <tr
                      key={s.name}
                      onClick={() => !s.isYou && setPicked(s.name)}
                      className={`${s.isYou ? "is-you" : "cursor-pointer"} ${sel?.name === s.name ? "bg-brand-pale" : ""}`}
                      aria-selected={sel?.name === s.name}
                    >
                      <td className="aw-num text-muted">{s.rank}</td>
                      <td className="max-w-48">
                        <BrandName name={s.name} domain={s.domain} logo={s.isYou ? brand.logo : undefined} isYou={s.isYou} size={18} />
                      </td>
                      <td className="aw-num whitespace-nowrap">
                        {pct(s.visibility)} {hadBefore ? <Delta now={s.visibility} before={b?.visibility ?? 0} /> : null}
                      </td>
                      <td className="aw-num">{score(s.sentiment)}</td>
                      <td className="aw-num">{pos(s.position)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {sel && detail ? (
          <div className="flex min-w-0 flex-col gap-5">
            <section className="aw-frame p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <BrandName name={sel.name} domain={sel.domain} size={36} />
                <a href={`https://${sel.domain ?? ""}`} target="_blank" rel="noopener noreferrer nofollow" className="text-[13px]">
                  {sel.domain}
                </a>
              </div>
              <div className="aw-stats mt-4" style={{ ["--cols" as string]: 4 }}>
                {[
                  { lab: "Visibility", them: pct(sel.visibility), you: pct(me.visibility) },
                  { lab: "Sentiment", them: score(sel.sentiment), you: score(me.sentiment) },
                  { lab: "Position", them: pos(sel.position), you: pos(me.position) },
                  { lab: "Mentions", them: String(sel.mentions), you: String(me.mentions) },
                ].map((s) => (
                  <div key={s.lab} className="aw-stat">
                    <div className="aw-stat__num">{s.them}</div>
                    <div className="aw-stat__lab">
                      {s.lab} · you {s.you}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <Card title={`Visibility over time: ${sel.name} vs ${brand.name}`}>
              <div className="px-3 pt-4 pb-2">
                <TrendChart
                  points={points}
                  metric="visibility"
                  mode="line"
                  lines={[
                    { name: brand.name, color: YOU_COLOR, isYou: true },
                    { name: sel.name, color: THEM_COLOR, isYou: false },
                  ]}
                />
              </div>
            </Card>

            <Card title="Head to head" action={<Seg label="Compare by" value={split} onChange={setSplit} options={[{ id: "model", label: "By model" }, { id: "topic", label: "By topic" }]} />}>
              <div className="overflow-x-auto">
                <table className="aw-table aw-table--compact">
                  <thead>
                    <tr>
                      <SortTh id="key" sort={h2h} onSort={setH2h} text>
                        {split === "model" ? "Model" : "Topic"}
                      </SortTh>
                      <SortTh id="them" sort={h2h} onSort={setH2h}>
                        <span className="flex items-center gap-1.5">
                          <i className="inline-block h-2 w-2" style={{ background: THEM_COLOR }} />
                          {sel.name}
                        </span>
                      </SortTh>
                      <SortTh id="you" sort={h2h} onSort={setH2h}>
                        <span className="flex items-center gap-1.5">
                          <i className="inline-block h-2 w-2" style={{ background: YOU_COLOR }} />
                          {brand.name}
                        </span>
                      </SortTh>
                      <SortTh id="gap" sort={h2h} onSort={setH2h}>
                        Gap
                      </SortTh>
                    </tr>
                  </thead>
                  <tbody>
                    {sortRows(split === "model" ? detail.byEngine.map((e) => ({ key: e.engine, them: e.them, you: e.you })) : detail.byTopic.map((t) => ({ key: t.topic, them: t.them, you: t.you })), h2h, {
                      key: (r) => r.key,
                      them: (r) => r.them,
                      you: (r) => r.you,
                      gap: (r) => (r.them === null || r.you === null ? null : r.you - r.them),
                    }).map((r) => {
                      const gap = r.them === null || r.you === null ? null : Math.round(r.you - r.them);
                      return (
                        <tr key={r.key}>
                          <td className="max-w-52 truncate text-ink">{split === "model" ? <EngineName engine={r.key} size={14} /> : r.key}</td>
                          <td className="w-40">
                            <Bar v={r.them} color={THEM_COLOR} />
                          </td>
                          <td className="w-40">
                            <Bar v={r.you} color={YOU_COLOR} />
                          </td>
                          <td className="aw-num whitespace-nowrap">
                            {gap === null ? (
                              <span className="text-muted">–</span>
                            ) : gap === 0 ? (
                              <span className="text-muted">Even</span>
                            ) : (
                              <span className={gap > 0 ? "text-pos" : "text-neg"}>
                                {gap > 0 ? `You +${gap}` : `You ${gap}`}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card title={`Prompts where ${sel.name} beats you`}>
                <ul className="divide-y divide-rule-faint">
                  {detail.gaps.map((g) => (
                    <li key={g.prompt} className="flex items-start justify-between gap-3 px-5 py-3">
                      <span className="flex min-w-0 flex-col">
                        <span className="text-[14px] text-ink">{g.prompt}</span>
                        <span className="aw-micro">{g.topic}</span>
                      </span>
                      <span className="aw-num shrink-0 text-right text-[12px]">
                        <span className="text-ink">{pct(g.them)}</span>
                        <span className="text-muted"> vs you {pct(g.you)}</span>
                      </span>
                    </li>
                  ))}
                  {!detail.gaps.length ? <li className="aw-small px-5 py-4">You match or beat {sel.name} on every prompt.</li> : null}
                </ul>
              </Card>
              <Card title={`Sites cited when ${sel.name} is named`}>
                <ul className="divide-y divide-rule-faint">
                  {detail.domains.map((d) => (
                    <li key={d.domain} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[14px]">
                      <span className="flex min-w-0 items-center gap-2 text-ink">
                        <BrandLogo src={favicon(d.domain)} name={d.domain} size={16} />
                        <span className="truncate">{d.domain}</span>
                      </span>
                      <span className="aw-num text-muted">{d.count}×</span>
                    </li>
                  ))}
                  {!detail.domains.length ? <li className="aw-small px-5 py-4">No sites cited yet.</li> : null}
                </ul>
              </Card>
            </div>
          </div>
        ) : (
          <Empty>No competitors named yet.</Empty>
        )}
      </div>
    </div>
  );
}
