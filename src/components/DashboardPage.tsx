"use client";

import { useState } from "react";
import { isAnswered, type Chat, type Run } from "@/lib/chats";
import { brandRows, mentionRows, sourceRows, timeline, type BrandRow } from "@/lib/stats";
import type { Brand } from "./App";
import { BrandLogo } from "./BrandLogo";
import { ENGINE_LOGOS } from "./Engines";
import { VisibilityChart, type Series } from "./VisibilityChart";

type SortKey = "position" | "sentiment" | "visibility";

const TIMEFRAMES = [7, 30, 60, 90];
// Your brand is always brand green. Competitors take the next colors in order (palette checked for color blindness).
const YOU_COLOR = "#1E7A4D";
const OTHER_COLORS = ["#2a78d6", "#eb6834", "#4a3aa7", "#e87ba4"];
const SHOW = 6;

const pct = (n: number) => `${Math.round(n)}%`;
const favicon = (domain: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function SentimentPill({ value }: { value: number }) {
  const tone = value >= 60 ? "ranked" : value >= 40 ? "pending" : "missed";
  const word = value >= 60 ? "Positive" : value >= 40 ? "Neutral" : "Negative";
  return (
    <span className={`aw-status aw-status--${tone}`} title={word}>
      {Math.round(value)}
      <span className="sr-only"> {word}</span>
    </span>
  );
}

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

function SortHead({ k, label, sort, onSort }: { k: SortKey; label: string; sort: SortKey; onSort: (k: SortKey) => void }) {
  return (
    <th>
      <button type="button" onClick={() => onSort(k)} className="font-medium" aria-pressed={sort === k}>
        {label} {sort === k ? (k === "position" ? "↑" : "↓") : ""}
      </button>
    </th>
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

function ShowAll({ open, count, onClick }: { open: boolean; count: number; onClick: () => void }) {
  return (
    <button type="button" className="aw-text-link" onClick={onClick}>
      {open ? "Show less" : `Show all ${count}`}
    </button>
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
  const [sort, setSort] = useState<SortKey>("position");
  const [allMentions, setAllMentions] = useState(false);
  const [allSources, setAllSources] = useState(false);

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

  const order = (list: BrandRow[]) =>
    [...list].sort((a, b) => (sort === "position" ? a.position - b.position || b.visibility - a.visibility : b[sort] - a[sort]));
  const ranking = order(rows);

  const mentions = mentionRows(inRange, brand.name, pick);
  const sources = sourceRows(chats);
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

            <Card title={`Industry ranking · ${rows.length} brands`} flush>
              {/* Fills the card's height next to the chart. Scroll to see every brand. */}
              <div className="relative h-full min-h-80">
                <div className="absolute inset-0 overflow-auto">
                <table className="aw-table aw-table--dense aw-table--sticky">
                  <thead>
                    <tr>
                      <th>Brand</th>
                      <SortHead k="position" label="Position" sort={sort} onSort={setSort} />
                      <SortHead k="sentiment" label="Sentiment" sort={sort} onSort={setSort} />
                      <SortHead k="visibility" label="Visibility" sort={sort} onSort={setSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((r, i) => {
                      return (
                        <tr key={r.name} className={r.isYou ? "is-you" : undefined}>
                          <td>
                            <span className="flex items-center gap-3">
                              <span className="aw-num w-4 text-g500">{i + 1}</span>
                              <BrandCell row={r} brand={brand} />
                            </span>
                          </td>
                          <td className="aw-num">{r.position.toFixed(1)}</td>
                          <td>
                            <SentimentPill value={r.sentiment} />
                          </td>
                          <td className="aw-num">{pct(r.visibility)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            </Card>
          </div>

          <div className="aw-grid-2">
            <Card
              title={`${brand.name} mentions`}
              foot={mentions.length > SHOW ? <ShowAll open={allMentions} count={mentions.length} onClick={() => setAllMentions(!allMentions)} /> : null}
            >
              {mentions.length ? (
                <div className="table-scroll -mx-1">
                  <table className="aw-table aw-table--dense">
                    <thead>
                      <tr>
                        <th>Prompt</th>
                        <th>Model</th>
                        <th>Position</th>
                        <th>Sentiment</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(allMentions ? mentions : mentions.slice(0, SHOW)).map((m, i) => (
                        <tr key={`${m.at}-${m.engine}-${m.prompt}-${i}`}>
                          <td className="min-w-36">{m.prompt}</td>
                          <td title={m.engine}>
                            <BrandLogo src={ENGINE_LOGOS[m.engine] ?? ""} name={m.engine} size={22} />
                          </td>
                          <td className="aw-num">#{m.position}</td>
                          <td>
                            <SentimentPill value={m.sentiment} />
                          </td>
                          <td className="whitespace-nowrap">{when(m.at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="aw-small">No mentions of {brand.name} in this timeframe yet.</p>
              )}
            </Card>

            <Card
              title="Sources"
              foot={sources.length > SHOW ? <ShowAll open={allSources} count={sources.length} onClick={() => setAllSources(!allSources)} /> : null}
            >
              {sources.length ? (
                <div className="table-scroll -mx-1">
                  <table className="aw-table aw-table--dense">
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(allSources ? sources : sources.slice(0, SHOW)).map((s) => {
                        const mine = s.domain === brand.domain || s.domain.endsWith("." + brand.domain);
                        return (
                          <tr key={s.domain} className={mine ? "is-you" : undefined}>
                            <td>
                              <span className="flex items-center gap-2 font-medium text-ink">
                                <BrandLogo src={mine ? brand.logo : favicon(s.domain)} name={s.domain} size={20} />
                                {s.domain}
                              </span>
                            </td>
                            <td className="aw-num" title={`Cited in ${s.chats} of ${answered.length} chats`}>
                              {pct(s.used)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="aw-small">No sources cited in this timeframe.</p>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
