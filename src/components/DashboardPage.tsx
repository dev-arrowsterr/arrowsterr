"use client";

import { useState } from "react";
import { isAnswered, type Chat, type Run } from "@/lib/chats";
import { brandRows, marketSentiment, mentionRows, sentimentRows, sourceRows, timeline, type BrandRow } from "@/lib/stats";
import type { Brand } from "./App";
import { BrandLogo } from "./BrandLogo";
import { ENGINE_LOGOS } from "./Engines";
import { Donut, Legend, type Slice } from "./Donut";
import { VisibilityChart, type Series } from "./VisibilityChart";

const TIMEFRAMES = [7, 30, 60, 90];
// Your brand is always brand green. Competitors take the next colors in order (palette checked for color blindness).
const YOU_COLOR = "#1E7A4D";
const OTHER_COLORS = ["#2a78d6", "#eb6834", "#4a3aa7", "#e87ba4"];
const MAX_RANKED = 40;
const SOURCE_TYPES = ["Owned", "Competitor", "Third-party"] as const;

const pct = (n: number) => `${Math.round(n)}%`;
const favicon = (domain: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function BrandCell({ row, brand }: { row: BrandRow; brand: Brand }) {
  // No website saved for this brand (older runs): guess "name.com", which works for most brands.
  const guess = `${row.name.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`;
  const logo = row.isYou ? brand.logo : favicon(row.domain ?? guess);
  return (
    <span className="flex items-center gap-2 font-medium text-ink">
      <BrandLogo src={logo} name={row.name} size={20} />
      <span className="truncate">{row.name}</span>
      {row.isYou ? <span className="aw-badge">You</span> : null}
    </span>
  );
}

function Card({ title, children, foot, flush }: { title: string; children: React.ReactNode; foot?: React.ReactNode; flush?: boolean }) {
  return (
    <section className="aw-frame aw-frame--shadow flex min-w-0 flex-col">
      <div className="aw-frame__head">
        <h2 className="aw-h4">{title}</h2>
      </div>
      <div className={flush ? "min-h-0 flex-1" : "aw-frame__body flex-1"}>{children}</div>
      {foot ? <div className="aw-frame__foot">{foot}</div> : null}
    </section>
  );
}

// Ring colors. Green is always you or good, red is missing or negative. Every slice also shows in a legend with its %.
const COLORS = { you: "#1E7A4D", no: "#B3241A", neutral: "#C8DDD1", competitor: "#eb6834", thirdParty: "#2a78d6", more: "#9BB5A3" };

/** Change vs the period just before this one. */
function Delta({ now, before, days, unit }: { now: number; before: number | null; days: number; unit: string }) {
  if (before === null) return <span className="aw-small">No earlier data to compare</span>;
  const d = Math.round(now - before);
  const tone = d > 0 ? "ranked" : d < 0 ? "missed" : "pending";
  return (
    <span className="flex items-center gap-2 text-[13px] text-g600">
      <span className={`aw-status aw-status--${tone}`}>
        {d > 0 ? "+" : d < 0 ? "−" : "±"}
        {Math.abs(d)} {unit}
      </span>
      vs previous {days} days
    </span>
  );
}

/** Scrolls inside a card and fills the card's height. */
function Scroll({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative h-full min-h-80">
      <div className="absolute inset-0 overflow-auto">{children}</div>
    </div>
  );
}

export function DashboardPage({
  brand,
  runs,
  running,
  progress,
  canRun,
  onRun,
}: {
  brand: Brand;
  runs: Run[];
  running: boolean;
  progress: { done: number; total: number };
  canRun: string | null; // null when ready, otherwise the reason it can't run
  onRun: () => void;
}) {
  const [days, setDays] = useState(30);
  const [now] = useState(() => Date.now());
  const [engine, setEngine] = useState("All");

  // A run started after the page loaded is always in range.
  const since = new Date(now - days * 864e5).toISOString();
  const inRange = runs.filter((r) => r.at >= since);
  const engines = [...new Set(runs.flatMap((r) => r.engines))];
  const pick = (c: Chat) => engine === "All" || c.engine === engine;
  const chats = inRange.flatMap((r) => r.chats).filter(pick);
  const answered = chats.filter(isAnswered);

  const rows = brandRows(chats, brand.name);
  const you = rows.find((r) => r.isYou);
  const top4 = rows.filter((r) => !r.isYou).sort((a, b) => b.visibility - a.visibility).slice(0, 4);
  const featured = you ? [you, ...top4] : top4;

  const series: Series[] = featured.map((r, i) => ({
    name: r.name,
    isYou: r.isYou,
    total: r.visibility,
    color: r.isYou ? YOU_COLOR : OTHER_COLORS[(you ? i - 1 : i) % OTHER_COLORS.length],
  }));
  if (!you) series.unshift({ name: brand.name, isYou: true, total: 0, color: YOU_COLOR });
  const points = timeline(inRange, series.map((s) => s.name), pick);

  // Best average position first. Ties go to the brand mentioned more often.
  const ranking = [...rows].sort((a, b) => a.position - b.position || b.visibility - a.visibility).slice(0, MAX_RANKED);
  if (you && !ranking.includes(you)) ranking.push(you);

  // Sentiment: you, the top 4 competitors, and the market (every mention that is not you).
  const [youSentiment, ...competitorSentiment] = sentimentRows(chats, [brand.name, ...top4.map((r) => r.name)]);
  const market = marketSentiment(chats, brand.name);
  const topAvg = competitorSentiment.filter((r) => r.mentions).length
    ? competitorSentiment.reduce((n, r) => n + r.score * r.mentions, 0) / competitorSentiment.reduce((n, r) => n + r.mentions, 0)
    : 0;
  const diff = Math.round(youSentiment.score - market.score);

  const mentions = mentionRows(inRange, brand.name, pick);
  const sources = sourceRows(chats);

  // Owned: your site. Competitor: a site of a brand the engines named. Third-party: everything else.
  const competitorDomains = rows.filter((r) => !r.isYou && r.domain).map((r) => r.domain!);
  const under = (domain: string, root: string) => domain === root || domain.endsWith("." + root);
  const sourceType = (domain: string): (typeof SOURCE_TYPES)[number] =>
    under(domain, brand.domain) ? "Owned" : competitorDomains.some((d) => under(domain, d)) ? "Competitor" : "Third-party";
  const totalCites = sources.reduce((n, s) => n + s.chats, 0);
  const typeShare = Object.fromEntries(
    SOURCE_TYPES.map((t) => [t, totalCites ? (sources.filter((s) => sourceType(s.domain) === t).reduce((n, s) => n + s.chats, 0) / totalCites) * 100 : 0]),
  ) as Record<(typeof SOURCE_TYPES)[number], number>;
  // The period just before this one, for the change chips.
  const prevSince = new Date(now - 2 * days * 864e5).toISOString();
  const prevChats = runs.filter((r) => r.at >= prevSince && r.at < since).flatMap((r) => r.chats).filter(pick);
  const prevAnswered = prevChats.filter(isAnswered);
  const prevPresence = prevAnswered.length ? (brandRows(prevChats, brand.name).find((r) => r.isYou)?.visibility ?? 0) : null;
  const prevSources = sourceRows(prevChats);
  const prevCites = prevSources.reduce((n, s) => n + s.chats, 0);
  const prevOwned = prevCites ? (prevSources.filter((s) => sourceType(s.domain) === "Owned").reduce((n, s) => n + s.chats, 0) / prevCites) * 100 : null;

  const presenceSlices: Slice[] = [
    { label: "Mentioned", value: you?.visibility ?? 0, color: COLORS.you },
    { label: "Not mentioned", value: 100 - (you?.visibility ?? 0), color: COLORS.no },
  ];
  const sentimentSlices: Slice[] = [
    { label: "Positive", value: youSentiment.positive, color: COLORS.you },
    { label: "Neutral", value: youSentiment.neutral, color: COLORS.neutral },
    { label: "Negative", value: youSentiment.negative, color: COLORS.no },
  ];
  const citationSlices: Slice[] = [
    { label: "Your site", value: typeShare.Owned, color: COLORS.you },
    { label: "Competitors", value: typeShare.Competitor, color: COLORS.competitor },
    { label: "Third-party", value: typeShare["Third-party"], color: COLORS.thirdParty },
  ];

  // Competitive presence: each brand's share of all brand mentions. You plus the top 4, then everyone else.
  const totalMentions = rows.reduce((n, r) => n + r.mentions, 0) || 1;
  const shown = you ? [you, ...top4] : top4;
  const others = rows.filter((r) => !shown.includes(r));
  const presenceBars = [
    ...shown
      .sort((a, b) => b.mentions - a.mentions)
      .map((r) => ({
        name: r.name,
        isYou: r.isYou,
        share: (r.mentions / totalMentions) * 100,
        logo: r.isYou ? brand.logo : favicon(r.domain ?? `${r.name.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`),
        color: series.find((s) => s.name === r.name)?.color ?? COLORS.more,
      })),
    ...(others.length
      ? [{ name: `More (${others.length})`, isYou: false, share: (others.reduce((n, r) => n + r.mentions, 0) / totalMentions) * 100, logo: "", color: COLORS.more }]
      : []),
  ];

  const latest = runs.at(-1);
  const latestErrors = (latest?.chats ?? []).filter((c) => c.error);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="aw-h2 mb-0!">Dashboard</h1>
        <div className="flex flex-wrap items-center gap-3">
          <select aria-label="Timeframe" className="aw-select w-auto!" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {TIMEFRAMES.map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </select>
          <select aria-label="AI model" className="aw-select w-auto!" value={engine} onChange={(e) => setEngine(e.target.value)}>
            <option value="All">All models</option>
            {engines.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          <button type="button" className="aw-btn aw-btn--primary" onClick={onRun} disabled={running || Boolean(canRun)}>
            {running ? "Running..." : "Run now"}
          </button>
        </div>
      </div>

      {canRun && !running ? <p className="aw-error">{canRun}</p> : null}

      {running ? (
        <div className="flex flex-col gap-2">
          <div className="aw-progress">
            <div className="aw-progress__fill" style={{ width: `${Math.max(3, (progress.done / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
          <span className="aw-small aw-num">
            {progress.done} of {progress.total} chats in. Results fill in as they arrive. Keep this tab open.
          </span>
        </div>
      ) : latest ? (
        <span className="aw-small -mt-5">
          Last run {new Date(latest.at).toLocaleString()} · {runs.length} {runs.length === 1 ? "run" : "runs"} saved
          {latestErrors.length ? ` · ${latestErrors.length} chats failed (first: ${latestErrors[0].error})` : ""}
        </span>
      ) : null}

      {!runs.length ? (
        <div className="aw-callout max-w-2xl text-[16px]!">
          No results yet. Click <strong>Run now</strong> to ask the AI engines your {brand.prompts.length} prompts.
        </div>
      ) : !chats.length ? (
        <div className="aw-callout max-w-2xl text-[16px]!">No runs in this timeframe. Pick a longer one or click Run now.</div>
      ) : (
        <>
          <div className="aw-stats">
            <div className="aw-stat">
              <div className="aw-stat__num">{brand.prompts.length}</div>
              <div className="aw-stat__lab">Prompts tracked</div>
            </div>
            <div className="aw-stat">
              <div className="aw-stat__num">{answered.length}</div>
              <div className="aw-stat__lab">Responses</div>
            </div>
            <div className="aw-stat">
              <div className="flex h-[37px] items-center gap-2">
                {[...new Set(chats.map((c) => c.engine))].map((e) => (
                  <span key={e} title={e}>
                    <BrandLogo src={ENGINE_LOGOS[e] ?? ""} name={e} size={26} />
                  </span>
                ))}
              </div>
              <div className="aw-stat__lab">AI assistants</div>
            </div>
            <div className="aw-stat">
              <div className="aw-stat__num">{you ? `#${you.position.toFixed(1)}` : "–"}</div>
              <div className="aw-stat__lab">Average position</div>
            </div>
          </div>

          <div className="aw-grid-3">
            <Card title="Presence">
              <div className="flex flex-col gap-5">
                <div className="flex flex-col items-center gap-5">
                  <Donut
                    label="Share of chats that mention you"
                    slices={presenceSlices}
                    center={
                      <>
                        <span className="aw-num text-[26px] font-medium text-ink">{pct(you?.visibility ?? 0)}</span>
                        <span className="text-[12px] text-g500">of chats</span>
                      </>
                    }
                  />
                  <Legend slices={presenceSlices} />
                </div>
                <Delta now={you?.visibility ?? 0} before={prevPresence} days={days} unit="pts" />
              </div>
            </Card>

            <Card title="Sentiment">
              <div className="flex flex-col gap-5">
                <div className="flex flex-col items-center gap-5">
                  <Donut
                    label="How positively AI talks about you"
                    slices={sentimentSlices}
                    center={
                      <>
                        <span className="aw-num text-[26px] font-medium text-ink">{youSentiment.mentions ? Math.round(youSentiment.score) : "–"}</span>
                        <span className="text-[12px] text-g500">out of 100</span>
                      </>
                    }
                  />
                  <Legend slices={sentimentSlices} />
                </div>
                <div className="flex flex-col gap-1.5 border-t border-border pt-3 text-[14px]">
                  <div className="flex justify-between gap-3">
                    <span className="text-g600">Top competitors</span>
                    <span className="aw-num font-semibold text-ink">{competitorSentiment.some((r) => r.mentions) ? Math.round(topAvg) : "–"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-g600">Market benchmark</span>
                    <span className="aw-num font-semibold text-ink">{market.mentions ? Math.round(market.score) : "–"}</span>
                  </div>
                  {youSentiment.mentions && market.mentions ? (
                    <span className={`aw-status mt-1 self-start ${diff >= 0 ? "aw-status--ranked" : "aw-status--missed"}`}>
                      {diff === 0 ? "Same as market" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} vs market`}
                    </span>
                  ) : null}
                </div>
              </div>
            </Card>

            <Card title="Citations">
              <div className="flex flex-col gap-5">
                <div className="flex flex-col items-center gap-5">
                  <Donut
                    label="Who owns the sources AI cites"
                    slices={citationSlices}
                    center={
                      <>
                        <span className="aw-num text-[26px] font-medium text-ink">{pct(typeShare.Owned)}</span>
                        <span className="text-[12px] text-g500">your site</span>
                      </>
                    }
                  />
                  <Legend slices={citationSlices} />
                </div>
                <Delta now={typeShare.Owned} before={prevOwned} days={days} unit="pts" />
              </div>
            </Card>
          </div>

          <div className="aw-grid-2">
            <Card title="Visibility">
              <VisibilityChart points={points} series={series} />
            </Card>

            <Card title="Competitive presence">
              <div className="flex flex-col gap-4">
                {presenceBars.map((b) => (
                  <div key={b.name} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-3 text-[14px]">
                      <span className={`flex min-w-0 items-center gap-2 ${b.isYou ? "font-semibold text-ink" : "text-ink-2"}`}>
                        {b.logo ? <BrandLogo src={b.logo} name={b.name} size={18} /> : null}
                        <span className="truncate">{b.name}</span>
                      </span>
                      <span className="aw-num font-semibold text-ink">{pct(b.share)}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded bg-skel">
                      <div className="h-full rounded" style={{ width: `${b.share}%`, background: b.color }} />
                    </div>
                  </div>
                ))}
                <p className="aw-help mt-0!">Share of all brand mentions in AI answers.</p>
              </div>
            </Card>
          </div>

          <div className="aw-grid-2">
            <Card title={`Industry ranking · top ${ranking.length}`} flush>
              <Scroll>
                <table className="aw-table aw-table--dense aw-table--sticky">
                  <thead>
                    <tr>
                      <th>Brand</th>
                      <th>Avg position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((r, i) => (
                      <tr key={r.name} className={r.isYou ? "is-you" : undefined}>
                        <td>
                          <span className="flex items-center gap-3">
                            <span className="aw-num w-5 text-g500">{i + 1}</span>
                            <BrandCell row={r} brand={brand} />
                          </span>
                        </td>
                        <td className="aw-num">#{r.position.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Scroll>
            </Card>

            <Card title={`Sources · ${sources.length}`} flush>
              {sources.length ? (
                <div className="flex h-full flex-col">
                  <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
                    {SOURCE_TYPES.map((t) => (
                      <span key={t} className={`aw-status ${t === "Owned" ? "aw-status--ranked" : "aw-status--pending"}`}>
                        {t} {pct(typeShare[t])}
                      </span>
                    ))}
                  </div>
                  <Scroll>
                    <table className="aw-table aw-table--dense aw-table--sticky">
                      <thead>
                        <tr>
                          <th>Source</th>
                          <th>Type</th>
                          <th>Used</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sources.map((s) => {
                          const type = sourceType(s.domain);
                          return (
                            <tr key={s.domain} className={type === "Owned" ? "is-you" : undefined}>
                              <td>
                                <span className="flex items-center gap-2 font-medium text-ink">
                                  <BrandLogo src={type === "Owned" ? brand.logo : favicon(s.domain)} name={s.domain} size={20} />
                                  {s.domain}
                                </span>
                              </td>
                              <td className="whitespace-nowrap">{type}</td>
                              <td className="aw-num" title={`Cited in ${s.chats} of ${answered.length} chats`}>
                                {pct(s.used)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </Scroll>
                </div>
              ) : (
                <p className="aw-small p-6">No sources cited in this timeframe.</p>
              )}
            </Card>
          </div>

          <div>
            <Card title={`${brand.name} mentions · ${mentions.length}`} flush>
              {mentions.length ? (
                <Scroll>
                  <table className="aw-table aw-table--dense aw-table--sticky">
                    <thead>
                      <tr>
                        <th>Prompt</th>
                        <th>Model</th>
                        <th>Position</th>
                        <th>Sources</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mentions.map((m, i) => (
                        <tr key={`${m.at}-${m.engine}-${m.prompt}-${i}`}>
                          <td className="min-w-36">{m.prompt}</td>
                          <td title={m.engine}>
                            <BrandLogo src={ENGINE_LOGOS[m.engine] ?? ""} name={m.engine} size={22} />
                          </td>
                          <td className="aw-num">#{m.position}</td>
                          <td>
                            {m.sources.length ? (
                              <span className="flex flex-wrap gap-1.5">
                                {m.sources.slice(0, 6).map((src) => (
                                  <a key={src.url} href={src.url} target="_blank" rel="noopener noreferrer nofollow" title={src.title || src.domain} className="plain">
                                    <BrandLogo src={favicon(src.domain)} name={src.domain} size={18} />
                                  </a>
                                ))}
                                {m.sources.length > 6 ? <span className="aw-small">+{m.sources.length - 6}</span> : null}
                              </span>
                            ) : (
                              <span className="aw-small">None</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap">{when(m.at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Scroll>
              ) : (
                <p className="aw-small p-6">No mentions of {brand.name} in this timeframe yet.</p>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
