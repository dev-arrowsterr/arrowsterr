"use client";

import { useState } from "react";
import { MAX_COMPETITORS, type Brand, type TrackedCompetitor } from "@/lib/db";
import { answered, brandStats, competitorDetail, rankOf, topicGrid, trend, withTracked, type CompetitorRow } from "@/lib/metrics";
import type { View } from "@/lib/view";
import { BrandLogo } from "./BrandLogo";
import { EngineName } from "./Engines";
import { TrendChart } from "./TrendChart";
import { BrandName, Card, Delta, Empty, favicon, pct, pos, score, Seg, sortRows, SortTh, useSort, YOU_COLOR } from "./ui";

const THEM_COLOR = "#F5B70A";
const bare = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

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

/** Competitors you track and every brand AI names, with a full comparison for the one you pick. */
export function CompetitorsPage({
  view,
  initial,
  canEdit,
  onBrand,
  onTopic,
}: {
  view: View;
  initial?: string | null;
  canEdit: boolean;
  onBrand: (b: Brand) => void;
  onTopic: (topic: string) => void;
}) {
  const { brand, current, previous, filter, topics, engines, days } = view;
  const you = { name: brand.name, domain: brand.domain };
  const tracked = brand.profile.competitors ?? [];
  const chats = answered(current, filter);
  const prev = answered(previous, filter);
  const hadBefore = prev.length > 0;
  const stats = brandStats(chats, you);
  const before = brandStats(prev, you);
  const rows = withTracked(stats, tracked);
  const [scope, setScope] = useState<"tracked" | "all">(tracked.length ? "tracked" : "all");
  const [picked, setPicked] = useState<string | null>(initial ?? null);
  const [split, setSplit] = useState<"model" | "topic">("model");
  const [sort, setSort] = useSort("visibility");
  const [h2h, setH2h] = useSort("key", false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", domain: "" });

  const others = rows.filter((r) => !r.isYou);
  const list = (scope === "tracked" ? rows.filter((r) => r.isYou || r.tracked) : rows).slice(0, MAX_COMPETITORS + 1);
  const sel = others.find((s) => s.name.toLowerCase() === picked?.toLowerCase()) ?? list.find((r) => !r.isYou) ?? others[0];
  const me = rows.find((s) => s.isYou)!;

  const saveTracked = (next: TrackedCompetitor[]) => onBrand({ ...brand, profile: { ...brand.profile, competitors: next } });
  const isTracked = (r: CompetitorRow) => r.tracked;
  const toggle = (r: CompetitorRow) => {
    if (r.tracked) saveTracked(tracked.filter((t) => t.name.toLowerCase() !== r.name.toLowerCase() && (!t.domain || bare(t.domain) !== bare(r.domain ?? ""))));
    else if (tracked.length < MAX_COMPETITORS) saveTracked([...tracked, { name: r.name, domain: r.domain ?? "" }]);
  };

  if (!chats.length && !tracked.length) return <Empty>No results in the last {days} days yet. They show up after the first check finishes, then update every day.</Empty>;

  const detail = sel ? competitorDetail(chats, sel.name, brand.name, engines, topics) : null;
  const points = sel ? trend(current, [sel.name, brand.name], "visibility", filter) : [];
  const gridBrands = [me, ...(tracked.length ? others.filter((r) => r.tracked) : others).slice(0, 5)];
  const grid = topicGrid(chats, topics, gridBrands.map((s) => s.name));
  const was = (name: string) => before.find((x) => x.name.toLowerCase() === name.toLowerCase());
  const rankFor = (name: string) => {
    const r = rankOf(stats.map((s) => ({ ...s, isYou: s.name.toLowerCase() === name.toLowerCase() })), "visibility");
    return r && stats.some((s) => s.name.toLowerCase() === name.toLowerCase()) ? r : null;
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="aw-h2">Competitors</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="aw-tag">
            {tracked.length} of {MAX_COMPETITORS} tracked
          </span>
          {canEdit ? (
            <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={() => setAdding(!adding)} disabled={tracked.length >= MAX_COMPETITORS}>
              + Track competitor
            </button>
          ) : null}
        </div>
      </div>

      {adding ? (
        <form
          className="aw-frame flex flex-wrap items-center gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const name = form.name.trim();
            if (!name || tracked.some((t) => t.name.toLowerCase() === name.toLowerCase())) return;
            saveTracked([...tracked, { name, domain: bare(form.domain) }]);
            setForm({ name: "", domain: "" });
            setAdding(false);
            setScope("tracked");
          }}
        >
          <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Brand name, like Birdeye" aria-label="Competitor name" className="aw-input w-56 py-2! text-[14px]!" />
          <input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="Website, like birdeye.com" aria-label="Competitor website" className="aw-input w-56 py-2! text-[14px]!" />
          <button type="submit" className="aw-btn aw-btn--primary aw-btn--sm" disabled={!form.name.trim()}>
            Track
          </button>
          <button type="button" className="aw-text-link text-[13px]" onClick={() => setAdding(false)}>
            Cancel
          </button>
          <span className="aw-small w-full">Tracked competitors stay on this page even when no answer names them. Answers that name them by brand or website count.</span>
        </form>
      ) : null}

      {topics.length && chats.length ? (
        <Card title="Who wins each topic">
          <div className="overflow-x-auto">
            <table className="aw-table aw-table--compact aw-table--tight">
              <thead>
                <tr>
                  <th>Topic</th>
                  {gridBrands.map((b) => (
                    <th key={b.name} className="w-36">
                      {b.isYou ? (
                        <BrandName name={b.name} domain={b.domain} logo={brand.logo} isYou size={16} />
                      ) : (
                        <button type="button" onClick={() => setPicked(b.name)} title={`Compare with ${b.name}`} className="text-left">
                          <BrandName name={b.name} domain={b.domain} size={16} />
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.map((g) => (
                  <tr key={g.topic}>
                    <td className="max-w-64">
                      <button type="button" onClick={() => onTopic(g.topic)} className="aw-text-link truncate text-left" title={`Open ${g.topic} on the Prompts page`}>
                        {g.topic}
                      </button>
                    </td>
                    {gridBrands.map((b) => {
                      const lead = g.leader === b.name;
                      return (
                        <td key={b.name} className={b.isYou ? "bg-brand-pale" : ""}>
                          <span className="flex items-center gap-2">
                            <span className={`aw-num ${lead ? "font-medium text-ink" : "text-body"}`}>{pct(g.values[b.name])}</span>
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

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Card
          title="Brands"
          className="self-start xl:sticky xl:top-20"
          action={
            <Seg
              label="Brands shown"
              value={scope}
              onChange={setScope}
              options={[
                { id: "tracked", label: `Tracked ${tracked.length}` },
                { id: "all", label: `All named ${stats.length - 1}` },
              ]}
            />
          }
        >
          <div className="max-h-[calc(100vh-12rem)] overflow-y-auto">
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
                  {canEdit ? <th className="w-10" aria-label="Track" /> : null}
                </tr>
              </thead>
              <tbody>
                {sortRows(list.map((s, i) => ({ ...s, rank: i + 1 })), sort, {
                  name: (s) => s.name,
                  visibility: (s) => s.visibility,
                  sentiment: (s) => s.sentiment,
                  position: (s) => (s.position === null ? null : -s.position),
                }).map((s) => {
                  const b = was(s.name);
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
                      {canEdit ? (
                        <td>
                          {!s.isYou ? (
                            <button
                              type="button"
                              aria-pressed={isTracked(s)}
                              aria-label={isTracked(s) ? `Stop tracking ${s.name}` : `Track ${s.name}`}
                              title={isTracked(s) ? "Tracked. Click to stop tracking" : "Track this competitor"}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggle(s);
                              }}
                              disabled={!isTracked(s) && tracked.length >= MAX_COMPETITORS}
                              className={`text-[16px] ${isTracked(s) ? "text-[#F5B70A]" : "text-muted hover:text-ink"}`}
                            >
                              {isTracked(s) ? "★" : "☆"}
                            </button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
                {list.length <= 1 ? (
                  <tr>
                    <td colSpan={6} className="aw-small">
                      {scope === "tracked" ? "No competitors tracked yet. Click the star next to a brand under All named, or click Track competitor." : "No other brands named yet."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        {sel && detail ? (
          <div className="flex min-w-0 flex-col gap-5">
            <section className="aw-frame">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-rule-faint px-5 py-4">
                <BrandName name={sel.name} domain={sel.domain} size={32} />
                <span className="flex items-center gap-3">
                  {sel.domain ? (
                    <a href={`https://${sel.domain}`} target="_blank" rel="noopener noreferrer nofollow" className="text-[13px]">
                      {sel.domain}
                    </a>
                  ) : null}
                  {canEdit ? (
                    <button type="button" className={`aw-btn aw-btn--sm ${sel.tracked ? "aw-btn--primary" : "aw-btn--secondary"}`} aria-pressed={sel.tracked} onClick={() => toggle(sel)}>
                      {sel.tracked ? "★ Tracked" : "☆ Track"}
                    </button>
                  ) : null}
                </span>
              </div>
              <div className="grid gap-px bg-rule-faint sm:grid-cols-2 xl:grid-cols-4">
                {(() => {
                  const b = was(sel.name);
                  const r = rankFor(sel.name);
                  return [
                    { lab: "AI visibility", v: pct(sel.visibility), d: hadBefore ? <Delta now={sel.visibility} before={b?.visibility ?? 0} /> : null, you: pct(me.visibility) },
                    { lab: "Sentiment", v: score(sel.sentiment), d: hadBefore ? <Delta now={sel.sentiment} before={b?.sentiment ?? null} digits={0} /> : null, you: score(me.sentiment) },
                    { lab: "Avg. position", v: pos(sel.position), d: hadBefore ? <Delta now={sel.position} before={b?.position ?? null} lowerIsBetter /> : null, you: pos(me.position) },
                    { lab: "Rank by visibility", v: r ? `${r.rank} of ${r.of}` : "–", d: null, you: (() => {
                      const y = rankOf(stats, "visibility");
                      return y ? `${y.rank} of ${y.of}` : "–";
                    })() },
                  ].map((m) => (
                    <div key={m.lab} className="flex flex-col gap-1.5 bg-white p-4">
                      <span className="aw-label">{m.lab}</span>
                      <span className="flex items-baseline gap-2">
                        <span className="aw-num text-[26px] leading-none text-ink">{m.v}</span>
                        {m.d}
                      </span>
                      <span className="aw-small">
                        {brand.name}: {m.you}
                      </span>
                    </div>
                  ));
                })()}
              </div>
              <p className="aw-small border-t border-rule-faint px-5 py-2.5">
                Named in {sel.mentions} of {chats.length} AI answers in the last {days} days.
              </p>
            </section>

            <Card title={`Head to head: ${sel.name} vs ${brand.name}`} action={<Seg label="Compare by" value={split} onChange={setSplit} options={[{ id: "model", label: "By model" }, { id: "topic", label: "By topic" }]} />}>
              <div className="px-3 pt-4 pb-1">
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
              <div className="overflow-x-auto border-t border-rule-faint">
                <table className="aw-table aw-table--compact aw-table--tight">
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
                    {sortRows(
                      (split === "model" ? detail.byEngine.map((e) => ({ key: e.engine, them: e.them, you: e.you })) : detail.byTopic.map((t) => ({ key: t.topic, them: t.them, you: t.you }))).filter((r) => r.them !== null || r.you !== null),
                      h2h,
                      {
                        key: (r) => r.key,
                        them: (r) => r.them,
                        you: (r) => r.you,
                        gap: (r) => (r.them === null || r.you === null ? null : r.you - r.them),
                      },
                    ).map((r) => {
                      const gap = r.them === null || r.you === null ? null : Math.round(r.you - r.them);
                      return (
                        <tr key={r.key}>
                          <td className="max-w-52 truncate text-ink">{split === "model" ? <EngineName engine={r.key} size={14} /> : r.key}</td>
                          <td className="w-36">
                            <Bar v={r.them} color={THEM_COLOR} />
                          </td>
                          <td className="w-36">
                            <Bar v={r.you} color={YOU_COLOR} />
                          </td>
                          <td className="aw-num whitespace-nowrap">
                            {gap === null ? <span className="text-muted">–</span> : gap === 0 ? <span className="text-muted">Even</span> : <span className={gap > 0 ? "text-pos" : "text-neg"}>{gap > 0 ? `You +${gap}` : `You ${gap}`}</span>}
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
          <Empty>Pick a brand to compare.</Empty>
        )}
      </div>
    </div>
  );
}
