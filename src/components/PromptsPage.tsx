"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { Fragment, useEffect, useRef, useState } from "react";
import type { Chat } from "@/lib/chats";
import { addCalendarItems, flatPrompts, siteForBrand, type Brand, type Topic } from "@/lib/db";
import { answered, brandStats, promptDetail, promptGaps, promptRows, rankOf, topicRows, trend, type EngineCell, type Gap } from "@/lib/metrics";
import type { RunAuth } from "@/lib/runner";
import { putStash } from "@/lib/stash";
import { MAX_PROMPTS, MAX_TOPICS, PROMPTS_PER_TOPIC } from "@/lib/onboarding";
import type { View } from "@/lib/view";
import { BrandLogo } from "./BrandLogo";
import { ENGINE_LOGOS, EngineName } from "./Engines";
import { TypeTag } from "./SourcesPage";
import { TrendChart } from "./TrendChart";
import { BrandName, Card, Delta, Empty, favicon, OTHER_COLORS, pct, pos, Seg, YOU_COLOR } from "./ui";

type Props = {
  sb: SupabaseClient;
  auth: RunAuth;
  view: View;
  readOnly: boolean;
  focusTopic?: string | null;
  onChange: (b: Brand) => void;
  onRemove: () => void;
  onCompetitor: (name: string) => void;
  onOpen: (page: "keywords" | "calendar") => void;
};

/** The home page for AI visibility: your scores, every topic and prompt, and the biggest gaps with a way to act on each. */
export function PromptsPage(p: Props) {
  const { view, readOnly } = p;
  const [tab, setTab] = useState<"results" | "edit">("results");
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="aw-h2">Prompts</h1>
        <div className="flex items-center gap-3">
          <span className="aw-tag">
            {view.brand.prompts.length} of {MAX_PROMPTS} prompts
          </span>
          {!readOnly ? (
            <Seg
              label="Prompts view"
              value={tab}
              onChange={setTab}
              options={[
                { id: "results", label: "Results" },
                { id: "edit", label: "Edit topics and prompts" },
              ]}
            />
          ) : null}
        </div>
      </div>
      {tab === "results" || readOnly ? (
        <>
          <Scores view={view} />
          <Results view={view} focusTopic={p.focusTopic} onCompetitor={p.onCompetitor} />
          <Gaps {...p} />
        </>
      ) : (
        <Editor brand={view.brand} onChange={p.onChange} onRemove={p.onRemove} />
      )}
    </div>
  );
}

/** Position as a 0 to 100 score: #1 is 100, and each spot down takes 10 points off. */
const positionScore = (n: number | null) => (n === null ? null : Math.max(0, 110 - n * 10));

/** Visibility, sentiment and position, with change and rank. */
function Scores({ view }: { view: View }) {
  const { brand, current, previous, filter, days } = view;
  const you = { name: brand.name, domain: brand.domain };
  const chats = answered(current, filter);
  if (!chats.length) return <Empty>No results in the last {days} days yet. They show up after the first check finishes, then update every day.</Empty>;
  const prev = answered(previous, filter);
  const stats = brandStats(chats, you);
  const before = brandStats(prev, you);
  const me = stats.find((s) => s.isYou)!;
  const meBefore = before.find((s) => s.isYou);
  const hadBefore = prev.length > 0;
  const change = hadBefore ? me.visibility - (meBefore?.visibility ?? 0) : null;
  const headline =
    change === null
      ? `${brand.name}'s visibility is ${pct(me.visibility)} in the last ${days} days`
      : `${brand.name}'s visibility is ${Math.abs(change) < 0.5 ? "steady" : `trending ${change > 0 ? "up" : "down"} by ${Math.abs(change).toFixed(1)} points`} vs the ${days} days before`;

  return (
    <section className="aw-frame">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3.5">
        <span className="text-[15px] text-ink">{headline}</span>
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
  );
}

/** Prompts where another brand beats you, each with a way into the SEO tools. */
function Gaps({ sb, auth, view, readOnly, onOpen }: Props) {
  const { brand, current, filter, topics } = view;
  const [busy, setBusy] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const gaps = promptGaps(answered(current, filter), topics, brand.name).slice(0, 8);
  if (!answered(current, filter).length) return null;

  async function site() {
    const s = await siteForBrand(sb, brand, !readOnly);
    if (!s) throw new Error(`Ask an editor to open Keywords once for ${brand.domain} to set it up.`);
    return s;
  }
  async function keywords(term: string) {
    setError("");
    try {
      const s = await site();
      putStash(`kw:${s.id}:seed`, term);
      onOpen("keywords");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function plan(g: Gap) {
    setBusy(g.prompt);
    setError("");
    try {
      const s = await site();
      await addCalendarItems(sb, auth.workspaceId, [
        {
          site_id: s.id,
          keyword: g.prompt,
          secondary: [],
          stage: null,
          theme: g.topic,
          volume: null,
          difficulty: null,
          intent: null,
          cpc: null,
          source: "AI gap",
          notes: `AI answers name ${g.leader} in ${pct(g.them)} and ${brand.name} in ${pct(g.you)}. Write a page that answers this prompt.`,
        },
      ]);
      putStash(`cal:${s.id}:items`, null);
      setAdded((x) => new Set([...x, g.prompt]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <Card title="Biggest gaps" action={<span className="aw-small">Prompts where another brand shows up more than you</span>}>
      {error ? <p className="aw-error m-4">{error}</p> : null}
      <ul className="divide-y divide-rule-faint">
        {gaps.map((g) => (
          <li key={g.prompt} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[14px] text-ink">{g.prompt}</span>
              <span className="aw-micro">
                {g.topic} · {g.leader} {pct(g.them)} · you {pct(g.you)}
              </span>
            </span>
            {!readOnly ? (
              <span className="flex shrink-0 gap-2">
                <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => keywords(g.topic)} title={`Research keywords for ${g.topic}`}>
                  Find keywords
                </button>
                {added.has(g.prompt) ? (
                  <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => onOpen("calendar")}>
                    Added. Open Calendar
                  </button>
                ) : (
                  <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={() => plan(g)} disabled={Boolean(busy)}>
                    {busy === g.prompt ? "Adding..." : "Add to Calendar"}
                  </button>
                )}
              </span>
            ) : null}
          </li>
        ))}
        {!gaps.length ? <li className="aw-small px-5 py-4">No gaps. You show up at least as often as any other brand on every prompt.</li> : null}
      </ul>
      {!readOnly && gaps.length ? (
        <p className="aw-small border-t border-rule-faint px-5 py-3">
          Find keywords opens Keyword research for the topic. Add to Calendar plans a page for the prompt. From the Calendar, build a brief and write it in the Writer. Its AI citations show up in Calendar Results.
        </p>
      ) : null}
    </Card>
  );
}

const ENGINE_SHORT: Record<string, string> = { ChatGPT: "ChatGPT", Claude: "Claude", Gemini: "Gemini", Perplexity: "Perplexity", "AI Overview": "AIO", "AI Mode": "AI Mode" };
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
const ago = (iso: string | null) => {
  if (!iso) return "–";
  const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
  return d <= 0 ? "Today" : d === 1 ? "Yesterday" : `${d} days ago`;
};

/** A share with a thin bar under it. */
function Share({ v }: { v: number | null }) {
  return (
    <span className="flex flex-col gap-1">
      <span className="aw-num text-[14px] text-ink">{pct(v)}</span>
      <span className="block h-1 w-14 bg-rule-faint">
        <span className="block h-full bg-brand" style={{ width: `${v ?? 0}%` }} />
      </span>
    </span>
  );
}

/** One model's latest answer to a prompt: your spot in the list when it named you, blank when it did not. */
function Cell({ c }: { c: EngineCell }) {
  if (c.status !== "named") return null;
  return (
    <span title={`${c.engine} named you at #${c.position}`} className="aw-status aw-status--ranked px-1.5! py-0.5! text-[12px]!">
      #{c.position}
    </span>
  );
}

function Results({ view, focusTopic, onCompetitor }: { view: View; focusTopic?: string | null; onCompetitor: (name: string) => void }) {
  const { brand, current, filter, topics, engines } = view;
  const [open, setOpen] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [charts, setCharts] = useState<Set<string>>(new Set());
  const focusRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  const chats = answered(current, filter);
  const rows = promptRows(current, topics, engines, brand.name, filter, brand.domain);
  const tops = topicRows(chats, topics, engines, brand.name);
  if (!topics.length) return <div className="aw-callout">No prompts yet. Open Edit topics and prompts to add some.</div>;
  const flip = (set: Set<string>, k: string) => (set.has(k) ? new Set([...set].filter((x) => x !== k)) : new Set([...set, k]));
  const cols = engines.length + 3;

  return (
    <section className="aw-frame overflow-x-auto">
      <table className="aw-table aw-table--compact aw-table--tight min-w-[880px]">
        <thead>
          <tr>
            <th>Topic and prompt</th>
            <th className="w-24">Visibility</th>
            {engines.map((e) => (
              <th key={e} className="w-28">
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <BrandLogo src={ENGINE_LOGOS[e] ?? ""} name={e} size={14} />
                  {ENGINE_SHORT[e] ?? e}
                </span>
              </th>
            ))}
            <th className="w-28">Last checked</th>
          </tr>
        </thead>
        {topics.map((t) => {
          const top = tops.find((x) => x.topic === t.name)!;
          const list = rows.filter((r) => r.topic === t.name);
          const isClosed = closed.has(t.name);
          const last = list.map((r) => r.latestAt).filter(Boolean).sort().pop() ?? null;
          const showChart = charts.has(t.name);
          const inTopic = (c: Chat) => filter(c) && t.prompts.includes(c.prompt);
          const leaders = showChart
            ? brandStats(answered(current, inTopic), { name: brand.name, domain: brand.domain })
                .filter((s) => !s.isYou)
                .slice(0, 3)
                .map((s) => s.name)
            : [];
          const lines = [brand.name, ...leaders].map((n, i) => ({ name: n, isYou: i === 0, color: i === 0 ? YOU_COLOR : OTHER_COLORS[i - 1] }));
          return (
            <tbody key={t.name}>
              <tr ref={focusTopic === t.name ? focusRef : undefined} className={`bg-surface-2 ${focusTopic === t.name ? "is-you" : ""}`}>
                <td>
                  <span className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setClosed((s) => flip(s, t.name))}
                      aria-expanded={!isClosed}
                      className="flex items-center gap-2 text-left text-[15px] font-medium text-ink"
                    >
                      <span aria-hidden="true" className="text-muted">
                        {isClosed ? "▸" : "▾"}
                      </span>
                      {t.name}
                      <span className="font-normal text-muted">· {t.prompts.length} prompts</span>
                    </button>
                    <button type="button" className={`aw-chip aw-chip--btn ${showChart ? "is-on" : ""}`} onClick={() => setCharts((s) => flip(s, t.name))} aria-pressed={showChart}>
                      {showChart ? "Hide trend" : "Show trend"}
                    </button>
                  </span>
                </td>
                <td>
                  <Share v={top.visibility} />
                </td>
                {engines.map((e) => (
                  <td key={e}>
                    <Share v={top.byEngine[e]} />
                  </td>
                ))}
                <td className="aw-small whitespace-nowrap">{ago(last)}</td>
              </tr>
              {showChart ? (
                <tr>
                  <td colSpan={cols} className="bg-white">
                    <TrendChart points={trend(current, lines.map((l) => l.name), "visibility", inTopic)} lines={lines} metric="visibility" mode="line" />
                    <ul className="flex flex-wrap gap-x-5 gap-y-1 px-2 pb-2">
                      {lines.map((l) => (
                        <li key={l.name} className="flex items-center gap-2 text-[13px] text-body">
                          <i className="inline-block h-2.5 w-2.5" style={{ background: l.color }} />
                          {l.isYou ? `${l.name} (you)` : l.name}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ) : null}
              {isClosed
                ? null
                : list.map((r) => {
                    const isOpen = open === r.prompt;
                    return (
                      <Fragment key={r.prompt}>
                        <tr onClick={() => setOpen(isOpen ? null : r.prompt)} aria-expanded={isOpen} className={`cursor-pointer ${isOpen ? "bg-paper" : ""}`}>
                          <td>
                            <span className="flex items-start gap-2 pl-5">
                              <span aria-hidden="true" className="text-muted">
                                {isOpen ? "▾" : "▸"}
                              </span>
                              <span className="text-[14px] leading-snug text-ink">{r.prompt}</span>
                            </span>
                          </td>
                          <td className="aw-num">{pct(r.visibility)}</td>
                          {r.latest.map((c) => (
                            <td key={c.engine}>
                              <Cell c={c} />
                            </td>
                          ))}
                          <td className="aw-small whitespace-nowrap">{ago(r.latestAt)}</td>
                        </tr>
                        {isOpen ? (
                          <tr>
                            <td colSpan={cols} className="p-0!">
                              <Detail view={view} prompt={r.prompt} topic={r.topic} onCompetitor={onCompetitor} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
            </tbody>
          );
        })}
      </table>
      <p className="aw-small border-t border-rule-faint px-4 py-3">
        #N is your spot in the list of brands that answer named. Blank means it did not name you. Click a prompt to see the brands and sites in its answers.
      </p>
    </section>
  );
}

/** Everything about one prompt: rank by model, each model's answer, the top brands and the sites cited. */
function Detail({ view, prompt, topic, onCompetitor }: { view: View; prompt: string; topic: string; onCompetitor: (name: string) => void }) {
  const { brand, current, engines, filter } = view;
  const d = promptDetail(current, prompt, engines, { name: brand.name, domain: brand.domain }, filter);
  const firstAnswered = d.engines.find((e) => e.answered)?.engine ?? engines[0];
  const [tab, setTab] = useState(firstAnswered);
  const [allBrands, setAllBrands] = useState(false);
  const [allSites, setAllSites] = useState(false);
  const cur = d.engines.find((e) => e.engine === tab) ?? d.engines[0];
  const last = d.engines.map((e) => e.at).filter(Boolean).sort().pop() ?? null;

  return (
    <div className="flex flex-col gap-5 border-t border-rule bg-paper p-5">
      {/* 1. Header */}
      <div className="flex flex-col gap-1">
        <span className="aw-micro">
          {topic} · {last ? `Checked ${new Date(last).toLocaleString()}` : "Not checked yet"}
        </span>
        <span className="text-[17px] font-medium text-ink">{prompt}</span>
      </div>
      <div className="grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-3 xl:grid-cols-6">
        {d.engines.map((e) => (
          <button
            key={e.engine}
            type="button"
            onClick={() => setTab(e.engine)}
            aria-pressed={tab === e.engine}
            className={`flex flex-col gap-2 p-3 text-left ${tab === e.engine ? "bg-brand-pale" : "bg-white hover:bg-surface-2"}`}
          >
            <EngineName engine={e.engine} size={14} />
            <span className="aw-num text-[24px] leading-none text-ink">{e.rank !== null ? `#${e.rank}` : "\u00a0"}</span>
            <span className="aw-small">{!e.answered ? "No answer" : e.sentiment !== null ? `Sentiment ${Math.round(e.sentiment)}` : "\u00a0"}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* 2. One model's answer */}
        <section className="aw-frame flex flex-col">
          <div className="flex flex-wrap gap-1 border-b border-rule-faint px-3 py-2" role="tablist" aria-label="Model">
            {d.engines.map((e) => (
              <button key={e.engine} type="button" role="tab" aria-selected={tab === e.engine} onClick={() => setTab(e.engine)} className={`aw-chip aw-chip--btn ${tab === e.engine ? "is-on" : ""}`}>
                {ENGINE_SHORT[e.engine] ?? e.engine}
              </button>
            ))}
          </div>
          {!cur.answered ? (
            <p className="aw-small p-5">No answer from {cur.engine} for this prompt in this period.</p>
          ) : (
            <div className="flex flex-col gap-5 p-5">
              <div className="flex flex-col gap-2">
                <span className="aw-label">{cur.quote ? (cur.quote.brand.toLowerCase() === brand.name.toLowerCase() ? "What it says about you" : `What it says about ${cur.quote.brand}`) : "What it says"}</span>
                {cur.quote ? (
                  <blockquote className="border-l-2 border-brand bg-white px-4 py-3 text-[14px] leading-relaxed text-ink">{cur.quote.text}</blockquote>
                ) : (
                  <p className="aw-small">The quote shows up from the next daily check.</p>
                )}
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <span className="aw-label">Brands in this answer</span>
                  <ol className="flex flex-col">
                    {cur.brands.map((b) => (
                      <li key={b.name} className={`flex items-center gap-3 px-2 py-1.5 text-[14px] ${b.isYou ? "bg-brand-pale" : ""}`}>
                        <span className="aw-num w-6 text-muted">#{b.position}</span>
                        <BrandName name={b.name} domain={b.domain} logo={b.isYou ? brand.logo : undefined} isYou={b.isYou} size={16} />
                      </li>
                    ))}
                    {!cur.brands.length ? <li className="aw-small">No brands named.</li> : null}
                  </ol>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="aw-label">Sources in this answer</span>
                  <ol className="flex flex-col gap-1">
                    {cur.sources.map((s, i) => (
                      <li key={s.url} className={`flex min-w-0 items-center gap-2 px-2 py-1 text-[13px] ${s.isYou ? "bg-brand-pale" : ""}`}>
                        <span className="aw-num w-6 shrink-0 text-muted">#{i + 1}</span>
                        <BrandLogo src={favicon(s.domain)} name={s.domain} size={14} />
                        <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate" title={s.url}>
                          {s.title && s.title.length > 12 ? s.title : shortUrl(s.url)}
                        </a>
                        {s.isYou ? <span className="aw-tag shrink-0">You</span> : null}
                      </li>
                    ))}
                    {!cur.sources.length ? <li className="aw-small">No sources cited.</li> : null}
                  </ol>
                </div>
              </div>
            </div>
          )}
        </section>

        <div className="flex flex-col gap-5">
          {/* 3. Top brands */}
          <section className="aw-frame">
            <div className="flex items-center justify-between gap-3 border-b border-rule-faint px-4 py-3">
              <span className="aw-label">Top brands for this prompt</span>
              <span className="aw-small">Latest answer from each model</span>
            </div>
            <table className="aw-table aw-table--compact aw-table--tight">
              <thead>
                <tr>
                  <th>Brand</th>
                  <th className="w-24">Models</th>
                  <th className="w-24">Avg. rank</th>
                </tr>
              </thead>
              <tbody>
                {(allBrands ? d.brands : d.brands.slice(0, 5)).map((b) => (
                  <tr key={b.name} className={b.isYou ? "is-you" : "cursor-pointer"} onClick={() => !b.isYou && onCompetitor(b.name)} title={b.isYou ? undefined : `Open ${b.name} on the Competitors page`}>
                    <td className="max-w-48">
                      <BrandName name={b.name} domain={b.domain} logo={b.isYou ? brand.logo : undefined} isYou={b.isYou} size={16} />
                    </td>
                    <td className="aw-num">
                      {b.engines} of {d.answered}
                    </td>
                    <td className="aw-num">{pos(b.rank)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.brands.length > 5 ? (
              <button type="button" className="aw-text-link px-4 py-2.5 text-[13px]" onClick={() => setAllBrands(!allBrands)}>
                {allBrands ? "Show top 5" : `Show all ${d.brands.length}`}
              </button>
            ) : null}
          </section>

          {/* 4. Sites cited */}
          <section className="aw-frame">
            <div className="flex items-center justify-between gap-3 border-b border-rule-faint px-4 py-3">
              <span className="aw-label">Sites cited for this prompt</span>
              <span className="aw-small">{d.sites.filter((x) => x.withoutYou).length} name competitors, not you</span>
            </div>
            <ul className="divide-y divide-rule-faint">
              {(allSites ? d.sites : d.sites.slice(0, 6)).map((x) => (
                <li key={x.domain} className="flex flex-col gap-1.5 px-4 py-3">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-[14px] text-ink">
                      <BrandLogo src={favicon(x.domain)} name={x.domain} size={16} />
                      <span className="truncate">{x.domain}</span>
                      <TypeTag type={x.type} />
                    </span>
                    <span className="aw-small whitespace-nowrap">
                      {x.engines} {x.engines === 1 ? "model" : "models"}
                    </span>
                  </span>
                  {x.withoutYou ? <span className="aw-status aw-status--warn self-start px-1.5! py-0.5! text-[11px]!">Names competitors, not you</span> : null}
                  <ul className="flex flex-col gap-0.5 pl-6">
                    {x.pages.slice(0, 2).map((pg) => (
                      <li key={pg.url} className="min-w-0 text-[13px]">
                        <a href={pg.url} target="_blank" rel="noopener noreferrer nofollow" className="block truncate" title={pg.url}>
                          {pg.title && pg.title.length > 12 ? pg.title : shortUrl(pg.url)} ↗
                        </a>
                      </li>
                    ))}
                    {x.pages.length > 2 ? <li className="aw-small">+{x.pages.length - 2} more pages</li> : null}
                  </ul>
                </li>
              ))}
              {!d.sites.length ? <li className="aw-small px-4 py-4">No sites cited yet.</li> : null}
            </ul>
            {d.sites.length > 6 ? (
              <button type="button" className="aw-text-link px-4 py-2.5 text-[13px]" onClick={() => setAllSites(!allSites)}>
                {allSites ? "Show top 6" : `Show all ${d.sites.length}`}
              </button>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

/** Rename, add and remove topics and prompts. Saves on every change. */
function Editor({ brand, onChange, onRemove }: { brand: Brand; onChange: (b: Brand) => void; onRemove: () => void }) {
  const topics: Topic[] = brand.topics.length ? brand.topics : brand.prompts.length ? [{ name: "Other prompts", prompts: brand.prompts }] : [];
  const [newTopic, setNewTopic] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const total = flatPrompts(topics).length;
  const save = (next: Topic[]) => onChange({ ...brand, topics: next, prompts: flatPrompts(next) });

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <label className="flex cursor-pointer items-start gap-3 rounded-aw border border-rule bg-white px-4 py-3 shadow-aw-sm">
        <input type="checkbox" checked={brand.daily} onChange={(e) => onChange({ ...brand, daily: e.target.checked })} className="mt-1 h-4 w-4 accent-[#0943B0]" />
        <span className="flex flex-col">
          <span className="text-[14px] font-medium text-ink">Check every day</span>
          <span className="aw-small">{brand.daily ? "On. The server checks every prompt on every model once a day." : "Off. This brand is paused and is not checked."}</span>
        </span>
      </label>

      {topics.map((t, ti) => (
        <section key={`${ti}-${t.name}`} className="aw-frame">
          <div className="flex items-center gap-2 border-b border-rule-faint px-4 py-3">
            <input
              aria-label="Topic name"
              defaultValue={t.name}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== t.name) save(topics.map((x, i) => (i === ti ? { ...x, name: v } : x)));
              }}
              className="aw-input flex-1 py-2! font-medium"
            />
            <span className="aw-small whitespace-nowrap">{t.prompts.length} prompts</span>
            <button
              type="button"
              className="aw-btn aw-btn--secondary aw-btn--sm"
              onClick={() => {
                if (confirm(`Remove the topic "${t.name}" and its prompts?`)) save(topics.filter((_, i) => i !== ti));
              }}
            >
              Remove
            </button>
          </div>
          <ul className="flex flex-col gap-1.5 p-3">
            {t.prompts.map((p, pi) => (
              <li key={`${pi}-${p}`} className="flex items-center gap-2 rounded-aw bg-surface-2 px-2 py-1.5">
                <input
                  aria-label="Prompt"
                  defaultValue={p}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== p) save(topics.map((x, i) => (i === ti ? { ...x, prompts: x.prompts.map((y, j) => (j === pi ? v : y)) } : x)));
                  }}
                  className="min-w-0 flex-1 bg-transparent px-2 py-1 text-[14px] text-ink outline-none focus:bg-white"
                />
                <button
                  type="button"
                  aria-label={`Remove prompt: ${p}`}
                  className="px-2 text-[16px] text-muted hover:text-neg"
                  onClick={() => save(topics.map((x, i) => (i === ti ? { ...x, prompts: x.prompts.filter((_, j) => j !== pi) } : x)))}
                >
                  ×
                </button>
              </li>
            ))}
            <li className="flex gap-2 pt-1">
              <input
                value={drafts[ti] ?? ""}
                onChange={(e) => setDrafts({ ...drafts, [ti]: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const v = (drafts[ti] ?? "").trim();
                  if (!v || total >= MAX_PROMPTS) return;
                  save(topics.map((x, i) => (i === ti ? { ...x, prompts: [...x.prompts, v] } : x)));
                  setDrafts({ ...drafts, [ti]: "" });
                }}
                placeholder={total >= MAX_PROMPTS ? `You have used all ${MAX_PROMPTS} prompts` : "+ Add prompt and press Enter"}
                disabled={total >= MAX_PROMPTS}
                className="aw-input py-2!"
              />
            </li>
          </ul>
        </section>
      ))}

      <div className="flex gap-2">
        <input
          value={newTopic}
          onChange={(e) => setNewTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const v = newTopic.trim();
            if (!v || topics.length >= MAX_TOPICS) return;
            save([...topics, { name: v, prompts: [v] }]);
            setNewTopic("");
          }}
          placeholder={topics.length >= MAX_TOPICS ? `You can track up to ${MAX_TOPICS} topics` : "Add a topic, like: review management software"}
          disabled={topics.length >= MAX_TOPICS}
          className="aw-input"
        />
        <button
          type="button"
          className="aw-btn aw-btn--secondary"
          disabled={!newTopic.trim() || topics.length >= MAX_TOPICS || total >= MAX_PROMPTS}
          onClick={() => {
            save([...topics, { name: newTopic.trim(), prompts: [newTopic.trim()] }]);
            setNewTopic("");
          }}
        >
          Add topic
        </button>
      </div>
      <p className="aw-small">
        Up to {MAX_TOPICS} topics and {MAX_PROMPTS} prompts. A new topic starts with its own name as the first prompt. Aim for about {PROMPTS_PER_TOPIC} prompts per topic.
      </p>
      <button
        type="button"
        className="aw-text-link self-start text-neg!"
        onClick={() => {
          if (confirm(`Stop tracking ${brand.name}? Its results will be deleted.`)) onRemove();
        }}
      >
        Remove this brand
      </button>
    </div>
  );
}
