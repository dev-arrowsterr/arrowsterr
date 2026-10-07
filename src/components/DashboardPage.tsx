"use client";

import { Fragment, useState } from "react";
import type { Run } from "@/lib/chats";
import { brandRows, sourceRows, type BrandRow } from "@/lib/stats";
import type { Brand } from "./App";
import { BrandLogo } from "./BrandLogo";
import { ChatPill, ChatTabs, EngineName } from "./Engines";

type SortKey = "position" | "sentiment" | "visibility";

const pct = (n: number) => `${Math.round(n)}%`;

function SentimentPill({ value }: { value: number }) {
  const tone = value >= 60 ? "ranked" : value >= 40 ? "pending" : "missed";
  const word = value >= 60 ? "Positive" : value >= 40 ? "Neutral" : "Negative";
  return (
    <span className={`aw-status aw-status--${tone}`}>
      {Math.round(value)} {word}
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

export function DashboardPage({
  brand,
  run,
  running,
  progress,
  canRun,
  onRun,
}: {
  brand: Brand;
  run: Run | null;
  running: boolean;
  progress: { done: number; total: number };
  canRun: string | null; // null when ready, otherwise the reason it can't run
  onRun: () => void;
}) {
  const [engine, setEngine] = useState("All");
  const [sort, setSort] = useState<SortKey>("position");
  const [open, setOpen] = useState<string | null>(null);

  const engines = run?.engines ?? [];
  const chats = (run?.chats ?? []).filter((c) => engine === "All" || c.engine === engine);
  const answered = chats.filter((c) => c.text);
  const rows = brandRows(chats, brand.name);
  const you = rows.find((r) => r.isYou);
  const sources = sourceRows(chats).slice(0, 15);
  const errors = chats.filter((c) => c.error);

  const sorted = [...rows].sort((a, b) =>
    sort === "position" ? a.position - b.position || b.visibility - a.visibility : b[sort] - a[sort],
  );
  const ranking = sorted.slice(0, 15);
  if (you && !ranking.includes(you)) ranking.push(you);

  const byVisibility = [...rows].sort((a, b) => b.visibility - a.visibility).slice(0, 8);
  if (you && !byVisibility.includes(you)) byVisibility.push(you);

  const promptList = [...new Set((run?.chats ?? []).map((c) => c.prompt))];
  const find = (prompt: string, e: string) => run?.chats.find((c) => c.prompt === prompt && c.engine === e);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="aw-h2 mb-0!">Dashboard</h1>
        <div className="flex flex-wrap items-center gap-3">
          {run && !running ? <span className="aw-small">Last run {new Date(run.at).toLocaleString()}</span> : null}
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
            {progress.done} of {progress.total} chats in. Results fill in below as they arrive. Keep this tab open.
          </span>
        </div>
      ) : null}

      {!run ? (
        <div className="aw-callout max-w-2xl text-[16px]!">
          No results yet. Click <strong>Run now</strong> to ask the AI engines your {brand.prompts.length} prompts.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by engine">
            {["All", ...engines].map((e) => (
              <button key={e} type="button" className={`aw-pill ${engine === e ? "is-on" : ""}`} onClick={() => setEngine(e)}>
                {e === "All" ? "All models" : <EngineName engine={e} size={16} />}
              </button>
            ))}
          </div>

          <div className="aw-stats">
            <div className="aw-stat">
              <div className="aw-stat__num">{pct(you?.visibility ?? 0)}</div>
              <div className="aw-stat__lab">Visibility: chats that mention {brand.name}</div>
            </div>
            <div className="aw-stat">
              <div className="aw-stat__num">{you ? `#${you.position.toFixed(1)}` : "–"}</div>
              <div className="aw-stat__lab">Average position when mentioned</div>
            </div>
            <div className="aw-stat">
              <div className="aw-stat__num">{you ? Math.round(you.sentiment) : "–"}</div>
              <div className="aw-stat__lab">Sentiment, out of 100</div>
            </div>
            <div className="aw-stat">
              <div className="aw-stat__num">
                {answered.length}
                <span className="text-[18px]! text-g500"> / {chats.length}</span>
              </div>
              <div className="aw-stat__lab">Chats answered</div>
            </div>
          </div>

          {errors.length ? (
            <div className="aw-callout aw-callout--warn text-[15px]!">
              {errors.length} {errors.length === 1 ? "chat" : "chats"} had an error. First one: {errors[0].error}
            </div>
          ) : null}

          <div className="aw-grid-2">
            <section className="aw-frame aw-frame--shadow min-w-0">
              <div className="aw-frame__head">
                <h2 className="aw-h4">Visibility</h2>
              </div>
              <div className="aw-frame__body">
                {byVisibility.length ? (
                  <div className="aw-score">
                    {byVisibility.map((r) => (
                      <div key={r.name} className="aw-score__row" title={`${r.name}: mentioned in ${r.mentions} of ${answered.length} chats`}>
                        <span className={`w-32! truncate ${r.isYou ? "font-semibold text-ink" : "aw-score__lab"}`}>{r.name}</span>
                        <span className="aw-score__track">
                          <span
                            className="block h-full rounded"
                            style={{ width: `${r.visibility}%`, background: r.isYou ? "var(--aw-brand)" : "var(--aw-brand-mist)" }}
                          />
                        </span>
                        <span className="aw-score__val">{pct(r.visibility)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="aw-small">No brands found yet.</p>
                )}
              </div>
            </section>

            <section className="aw-table-wrap table-scroll min-w-0">
              <table className="aw-table aw-table--compact">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Brand</th>
                    <SortHead k="position" label="Position" sort={sort} onSort={setSort} />
                    <SortHead k="sentiment" label="Sentiment" sort={sort} onSort={setSort} />
                    <SortHead k="visibility" label="Visibility" sort={sort} onSort={setSort} />
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((r: BrandRow) => (
                    <tr key={r.name} className={r.isYou ? "is-you" : undefined}>
                      <td>
                        <span className={`aw-rank ${sorted.indexOf(r) === 0 ? "aw-rank--top" : ""}`}>{sorted.indexOf(r) + 1}</span>
                      </td>
                      <td>
                        <span className="aw-table__name">
                          {r.isYou ? <BrandLogo src={brand.logo} name={r.name} size={20} /> : null}
                          {r.name}
                          {r.isYou ? <span className="aw-badge">Your brand</span> : null}
                        </span>
                      </td>
                      <td className="aw-num">{r.position.toFixed(1)}</td>
                      <td>
                        <SentimentPill value={r.sentiment} />
                      </td>
                      <td className="aw-num">{pct(r.visibility)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <div className="aw-grid-2">
            <section className="flex min-w-0 flex-col gap-4">
              <h2 className="aw-h3">Sources</h2>
              {sources.length ? (
                <div className="aw-table-wrap table-scroll">
                  <table className="aw-table aw-table--compact">
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sources.map((s) => (
                        <tr key={s.domain} className={s.domain === brand.domain || s.domain.endsWith("." + brand.domain) ? "is-you" : undefined}>
                          <td>
                            <span className="aw-table__name">
                              <BrandLogo src={`https://www.google.com/s2/favicons?domain=${s.domain}&sz=64`} name={s.domain} size={18} />
                              {s.domain}
                            </span>
                          </td>
                          <td className="aw-num" title={`Cited in ${s.chats} of ${answered.length} chats`}>
                            {pct(s.used)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="aw-small">No sources cited yet.</p>
              )}
            </section>
          </div>

          <section className="flex min-w-0 flex-col gap-4">
              <h2 className="aw-h3">Chats</h2>
              <div className="aw-table-wrap table-scroll">
                <table className="aw-table aw-table--compact">
                  <thead>
                    <tr>
                      <th>Prompt</th>
                      {engines.map((e) => (
                        <th key={e}>
                          <EngineName engine={e} size={16} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {promptList.map((p) => (
                      <Fragment key={p}>
                        <tr className="cursor-pointer" onClick={() => setOpen(open === p ? null : p)}>
                          <td className="min-w-52">
                            <span className="mr-2 text-g500">{open === p ? "▾" : "▸"}</span>
                            {p}
                          </td>
                          {engines.map((e) => (
                            <td key={e}>
                              <ChatPill chat={find(p, e)} brand={brand.name} />
                            </td>
                          ))}
                        </tr>
                        {open === p ? (
                          <tr>
                            <td colSpan={engines.length + 1} className="bg-paper!">
                              <ChatTabs engines={engines} find={(e) => find(p, e)} brand={brand.name} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
        </>
      )}
    </div>
  );
}
