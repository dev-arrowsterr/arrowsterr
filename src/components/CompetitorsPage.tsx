"use client";

import { useState } from "react";
import { answered, brandStats, competitorDetail, trend } from "@/lib/metrics";
import type { View } from "@/lib/view";
import { BrandLogo } from "./BrandLogo";
import { EngineName } from "./Engines";
import { TrendChart } from "./TrendChart";
import { BrandName, Card, Delta, Empty, favicon, pct, pos, score, YOU_COLOR } from "./ui";

const THEM_COLOR = "#F5B70A";

/** Two bars: them and you, with the numbers written out. */
function Pair({ them, you, name, youName }: { them: number | null; you: number | null; name: string; youName: string }) {
  return (
    <div className="flex flex-col gap-1">
      {[
        { label: name, v: them, color: THEM_COLOR },
        { label: youName, v: you, color: YOU_COLOR },
      ].map((b) => (
        <div key={b.label} className="flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-rule-faint">
            <div className="h-full rounded-full" style={{ width: `${b.v ?? 0}%`, background: b.color }} />
          </div>
          <span className="aw-num w-10 text-right text-[12px] text-ink">{pct(b.v)}</span>
        </div>
      ))}
    </div>
  );
}

/** Every competitor ranked, and a detailed view of the one you pick. */
export function CompetitorsPage({ view }: { view: View }) {
  const { brand, current, previous, filter, topics, engines, days } = view;
  const you = { name: brand.name, domain: brand.domain };
  const chats = answered(current, filter);
  const stats = brandStats(chats, you);
  const before = brandStats(answered(previous, filter), you);
  const hadBefore = answered(previous, filter).length > 0;
  const others = stats.filter((s) => !s.isYou);
  const [picked, setPicked] = useState<string | null>(null);
  const sel = others.find((s) => s.name === picked) ?? others[0];

  if (!chats.length) return <Empty>No results in the last {days} days. Click Run now, or wait for the daily run.</Empty>;

  const detail = sel ? competitorDetail(chats, sel.name, brand.name, engines, topics) : null;
  const me = stats.find((s) => s.isYou)!;
  const points = sel ? trend(current, [sel.name, brand.name], "visibility", filter) : [];

  return (
    <div className="flex flex-col gap-5">
      <h1 className="aw-h2">Competitors</h1>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <Card title={`${others.length} brands named alongside ${brand.name}`} className="self-start">
          <div className="max-h-[720px] overflow-auto">
            <table className="aw-table aw-table--compact">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="w-8">#</th>
                  <th>Brand</th>
                  <th>Visibility</th>
                  <th>Sentiment</th>
                  <th>Position</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s, i) => {
                  const b = before.find((x) => x.name.toLowerCase() === s.name.toLowerCase());
                  return (
                    <tr
                      key={s.name}
                      onClick={() => !s.isYou && setPicked(s.name)}
                      className={`${s.isYou ? "is-you" : "cursor-pointer"} ${sel?.name === s.name ? "bg-brand-pale" : ""}`}
                      aria-selected={sel?.name === s.name}
                    >
                      <td className="aw-num text-muted">{i + 1}</td>
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

            <div className="grid gap-5 lg:grid-cols-2">
              <Card title="By model">
                <ul className="flex flex-col gap-3 p-5">
                  {detail.byEngine.map((e) => (
                    <li key={e.engine} className="flex flex-col gap-1.5">
                      <span className="text-[13px] text-body">
                        <EngineName engine={e.engine} size={14} />
                      </span>
                      <Pair them={e.them} you={e.you} name={sel.name} youName={brand.name} />
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="By topic">
                <ul className="flex flex-col gap-3 p-5">
                  {detail.byTopic.map((t) => (
                    <li key={t.topic} className="flex flex-col gap-1.5">
                      <span className="truncate text-[13px] text-body">{t.topic}</span>
                      <Pair them={t.them} you={t.you} name={sel.name} youName={brand.name} />
                    </li>
                  ))}
                </ul>
                <p className="aw-micro px-5 pb-4">
                  Gold is {sel.name}. Blue is {brand.name}.
                </p>
              </Card>
            </div>

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
