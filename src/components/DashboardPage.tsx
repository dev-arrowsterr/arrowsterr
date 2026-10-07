"use client";

import { useState } from "react";
import { isAnswered, type Chat, type Run } from "@/lib/chats";
import { brandRows, marketSentiment, mentionRows, sentimentRows, sourceRows, timeline, type BrandRow, type SentimentRow } from "@/lib/stats";
import type { Brand } from "./App";
import { BrandLogo } from "./BrandLogo";
import { ENGINE_LOGOS } from "./Engines";
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

// Sentiment colors: brand green for positive, gray for neutral, brand red for negative. Every bar also shows its numbers.
const SENT = { positive: "#1E7A4D", neutral: "#C8DDD1", negative: "#B3241A" };

function SentimentStat({ label, value, strong }: { label: string; value: number | null; strong?: boolean }) {
  return (
    <div className={`rounded-aw border-2 border-line p-4 ${strong ? "bg-brand-pale" : "bg-white"}`}>
      <div className="aw-stat__num">{value === null ? "–" : Math.round(value)}</div>
      <div className="aw-stat__lab">{label}, out of 100</div>
    </div>
  );
}

function SentimentBar({ row, isYou, isMarket }: { row: SentimentRow; isYou: boolean; isMarket: boolean }) {
  const parts = [
    { key: "positive", value: row.positive, color: SENT.positive },
    { key: "neutral", value: row.neutral, color: SENT.neutral },
    { key: "negative", value: row.negative, color: SENT.negative },
  ];
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr_3rem] items-center gap-3 text-[14px]">
      <span className={`truncate ${isYou || isMarket ? "font-semibold text-ink" : "text-ink-2"}`}>{row.name}</span>
      {row.mentions ? (
        <span
          className="flex h-3 w-full gap-0.5 overflow-hidden rounded"
          title={`${Math.round(row.positive)}% positive, ${Math.round(row.neutral)}% neutral, ${Math.round(row.negative)}% negative, from ${row.mentions} mentions`}
        >
          {parts.map((p) => (p.value ? <span key={p.key} style={{ width: `${p.value}%`, background: p.color }} /> : null))}
        </span>
      ) : (
        <span className="aw-small">No mentions</span>
      )}
      <span className="aw-num text-right font-semibold text-ink">{row.mentions ? Math.round(row.score) : "–"}</span>
    </div>
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
              <div className="aw-stat__num">{pct(you?.visibility ?? 0)}</div>
              <div className="aw-stat__lab">Visibility</div>
            </div>
            <div className="aw-stat">
              <div className="aw-stat__num">{you ? `#${you.position.toFixed(1)}` : "–"}</div>
              <div className="aw-stat__lab">Average position</div>
            </div>
            <div className="aw-stat">
              <div className="aw-stat__num">{you ? Math.round(you.sentiment) : "–"}</div>
              <div className="aw-stat__lab">Sentiment, out of 100</div>
            </div>
            <div className="aw-stat">
              <div className="aw-stat__num">{mentions.length}</div>
              <div className="aw-stat__lab">Mentions in {answered.length} chats</div>
            </div>
          </div>

          <div className="aw-grid-2">
            <Card title="Visibility">
              <VisibilityChart points={points} series={series} />
            </Card>

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
          </div>

          <Card title="Sentiment">
            <div className="flex flex-col gap-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <SentimentStat label={brand.name} value={youSentiment.mentions ? youSentiment.score : null} strong />
                <SentimentStat label="Top competitors" value={competitorSentiment.some((r) => r.mentions) ? topAvg : null} />
                <SentimentStat label="Market benchmark" value={market.mentions ? market.score : null} />
              </div>
              {youSentiment.mentions && market.mentions ? (
                <p className="aw-ui">
                  AI talks about {brand.name}{" "}
                  <strong>
                    {diff === 0 ? "exactly as positively as" : `${Math.abs(diff)} ${Math.abs(diff) === 1 ? "point" : "points"} ${diff > 0 ? "more" : "less"} positively than`}
                  </strong>{" "}
                  the market average.
                </p>
              ) : null}
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-4 text-[13px] text-g600">
                  <span className="flex items-center gap-2">
                    <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SENT.positive }} /> Positive (60+)
                  </span>
                  <span className="flex items-center gap-2">
                    <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SENT.neutral }} /> Neutral (40 to 59)
                  </span>
                  <span className="flex items-center gap-2">
                    <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SENT.negative }} /> Negative (under 40)
                  </span>
                </div>
                {[youSentiment, ...competitorSentiment, market].map((r, i, all) => (
                  <SentimentBar key={r.name} row={r} isYou={i === 0} isMarket={i === all.length - 1} />
                ))}
              </div>
            </div>
          </Card>

          <div className="aw-grid-2">
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
        </>
      )}
    </div>
  );
}
