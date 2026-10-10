"use client";

import { useState } from "react";
import { ownMention, type Chat } from "@/lib/chats";
import { battle, ownsDomain, rankOf, siteOf, type BrandStat } from "@/lib/metrics";
import { MARKETS, type DomainReport } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import type { View } from "@/lib/view";
import { BrandLogo } from "./BrandLogo";
import { EngineName } from "./Engines";
import { flag, short } from "./research/KeywordOverview";
import { post } from "./research/shared";
import { Delta, favicon, guessDomain, pct, pos, score, SidePanel, Thinking, Tip, TIPS, YOU_COLOR } from "./ui";

/** Side B of the battle card, and the competitor in its deep dive. */
export const B_COLOR = "#F5B70A";

/** A value with a thin bar next to it. */
export function Bar({ v, color }: { v: number | null; color: string }) {
  return (
    <span className="flex items-center gap-3">
      <span className="aw-num w-11 text-right text-[14px] text-ink">{pct(v)}</span>
      <span className="h-2 flex-1 bg-rule-faint">
        <span className="block h-full" style={{ width: `${v ?? 0}%`, background: color }} />
      </span>
    </span>
  );
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const path = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") || u;

type Win = { prompt: string; topic: string; won: number; answers: number; them: number; themPos: number | null; you: number; youPos: number | null; engines: string[] };

/** Prompts where the competitor is named and you are not, or named above you. */
function winsOf(chats: Chat[], name: string, you: string, topics: View["topics"]): Win[] {
  const by = new Map<string, Chat[]>();
  for (const c of chats) by.set(c.prompt, [...(by.get(c.prompt) ?? []), c]);
  return [...by.entries()]
    .map(([prompt, list]) => {
      const them = list.map((c) => c.brands.find((b) => same(b.name, name))).filter((b) => b !== undefined);
      const me = list.map((c) => ownMention(c, you)).filter((b) => b !== null);
      const won = list.filter((c) => {
        const t = c.brands.find((b) => same(b.name, name));
        const y = ownMention(c, you);
        return t && (!y || t.position < y.position);
      });
      return {
        prompt,
        topic: topics.find((t) => t.prompts.includes(prompt))?.name ?? "",
        won: won.length,
        answers: list.length,
        them: (them.length / list.length) * 100,
        themPos: avg(them.map((b) => b.position)),
        you: (me.length / list.length) * 100,
        youPos: avg(me.map((b) => b.position)),
        engines: [...new Set(won.map((c) => c.engine))],
      };
    })
    .filter((r) => r.won > 0)
    .sort((a, b) => b.won - a.won || b.them - b.you - (a.them - a.you) || (a.themPos ?? 99) - (b.themPos ?? 99));
}

/** Sites cited in the answers that name the competitor. */
function sourcesOf(chats: Chat[], name: string) {
  const named = chats.filter((c) => c.brands.some((b) => same(b.name, name)));
  const count = new Map<string, number>();
  for (const c of named) for (const site of new Set(c.sources.map(siteOf).filter(Boolean))) count.set(site, (count.get(site) ?? 0) + 1);
  return {
    answers: named.length,
    sites: [...count.entries()].map(([site, n]) => ({ site, n })).sort((a, b) => b.n - a.n || a.site.localeCompare(b.site)),
  };
}

const SECTION = "aw-frame flex min-w-0 flex-col";

/** One competitor in depth: AI visibility next to yours, by model, the prompts they win, the sites behind them and their Google numbers. */
export function CompetitorPanel({
  s,
  stats,
  prev,
  you,
  chats,
  view,
  hadBefore,
  auth,
  report,
  onReport,
  onClose,
}: {
  s: BrandStat;
  stats: BrandStat[];
  prev: BrandStat[];
  you: BrandStat;
  chats: Chat[];
  view: View;
  hadBefore: boolean;
  auth: RunAuth | null;
  report?: DomainReport;
  onReport: (r: DomainReport) => void;
  onClose: () => void;
}) {
  const { brand, topics, engines, days } = view;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const before = prev.find((x) => same(x.name, s.name));
  const voiceIn = (rows: BrandStat[], x: BrandStat | undefined) => {
    const all = rows.reduce((n, r) => n + r.mentions, 0);
    return x && all ? (x.mentions / all) * 100 : null;
  };
  const rank = rankOf(stats.map((r) => ({ ...r, isYou: r.name === s.name })), "visibility");
  const models = battle(chats, s.name, you.name, engines, topics).byEngine.map((r) => {
    const named = chats.filter((c) => c.engine === r.key).flatMap((c) => c.brands.filter((b) => same(b.name, s.name)));
    return { ...r, position: avg(named.map((b) => b.position)) };
  });
  const wins = winsOf(chats, s.name, you.name, topics);
  const cited = sourcesOf(chats, s.name);
  const domain = s.domain?.toLowerCase().replace(/^www\./, "") ?? null;
  const country = brand.profile?.country && MARKETS[brand.profile.country] ? brand.profile.country : "United States";

  const load = async () => {
    if (!auth || !domain) return;
    setBusy(true);
    setError("");
    try {
      onReport(await post<DomainReport>(auth, "/api/research/domain", { domain, scope: "domain", country }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stat = (lab: string, tip: string | null, v: React.ReactNode, delta: React.ReactNode, mine: string) => (
    <div key={lab} className="aw-stat flex flex-col gap-1.5">
      <div className="aw-stat__lab flex items-center">
        {lab}
        {tip ? <Tip text={tip} /> : null}
      </div>
      <span className="flex items-baseline gap-2">
        <span className="aw-stat__num">{v}</span>
        {delta}
      </span>
      <span className="flex items-center gap-1.5 text-[12px] text-muted">
        <i className="inline-block h-2 w-2" style={{ background: YOU_COLOR }} aria-hidden="true" />
        You {mine}
      </span>
    </div>
  );

  const topKeywords = report ? [...report.keywords].sort((a, b) => (b.etv ?? 0) - (a.etv ?? 0) || (a.rank ?? 999) - (b.rank ?? 999)).slice(0, 10) : [];
  const topPages = report ? report.pages.slice(0, 10) : [];
  const o = report?.overview ?? null;

  return (
    <SidePanel
      kicker={`Competitor · last ${days} days`}
      title={
        <span className="flex items-center gap-3">
          <span className="rounded-[10px] border-2 border-ink bg-white p-1 shadow-[3px_3px_0_0_#F5B70A]">
            <BrandLogo src={favicon(s.domain || guessDomain(s.name))} name={s.name} size={32} />
          </span>
          <span className="truncate">{s.name}</span>
        </span>
      }
      onClose={onClose}
    >
      <div className="-mt-2 flex flex-wrap items-center gap-2">
        {domain ? (
          <a href={`https://${domain}`} target="_blank" rel="noopener noreferrer nofollow" className="text-[14px]">
            {domain} ↗
          </a>
        ) : null}
        {rank ? (
          <span className="aw-chip">
            <i />#{rank.rank} of {rank.of} by visibility
          </span>
        ) : null}
        {Math.round(s.visibility) > Math.round(you.visibility) ? (
          <span className="aw-status aw-status--missed">Ahead of you</span>
        ) : Math.round(s.visibility) < Math.round(you.visibility) ? (
          <span className="aw-status aw-status--ranked">Behind you</span>
        ) : (
          <span className="aw-status aw-status--pending">Level with you</span>
        )}
      </div>

      <div className="aw-stats aw-stats--tight" style={{ ["--cols" as string]: 5 }}>
        {stat("Visibility", TIPS.visibility, pct(s.visibility), hadBefore ? <Delta now={s.visibility} before={before?.visibility ?? 0} /> : null, pct(you.visibility))}
        {stat("Avg. position", TIPS.position, pos(s.position), hadBefore && before ? <Delta now={s.position} before={before.position} lowerIsBetter /> : null, pos(you.position))}
        {stat("Sentiment", TIPS.sentiment, score(s.sentiment), hadBefore && before ? <Delta now={s.sentiment} before={before.sentiment} digits={0} /> : null, score(you.sentiment))}
        {stat("Share of voice", "The brand's share of all brand mentions in these answers.", pct(voiceIn(stats, s)), hadBefore ? <Delta now={voiceIn(stats, s)} before={voiceIn(prev, before)} /> : null, pct(voiceIn(stats, you)))}
        {stat(
          "Mentions",
          TIPS.mentions,
          <>
            {s.mentions.toLocaleString("en-US")}
            <span className="text-[15px] font-normal text-muted"> / {chats.length.toLocaleString("en-US")}</span>
          </>,
          hadBefore && before ? <Delta now={s.mentions} before={before.mentions} digits={0} /> : null,
          you.mentions.toLocaleString("en-US"),
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className={SECTION}>
          <div className="aw-frame__head justify-between">
            <h3 className="aw-h4">Prompts they win</h3>
            <span className="aw-micro">{wins.length}</span>
          </div>
          {wins.length ? (
            <div className="max-h-[520px] overflow-auto">
              <table className="aw-table">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th>Prompt</th>
                    <th className="w-24">Position</th>
                    <th className="w-24">Them</th>
                    <th className="w-24">You</th>
                    <th className="w-24">Won</th>
                    <th className="w-32">Models</th>
                  </tr>
                </thead>
                <tbody>
                  {wins.map((w) => (
                    <tr key={w.prompt}>
                      <td>
                        <span className="flex flex-col gap-0.5">
                          <span className="text-[14px] text-ink">{w.prompt}</span>
                          {w.topic ? <span className="text-[12px] text-muted">{w.topic}</span> : null}
                        </span>
                      </td>
                      <td className="aw-num text-ink">{pos(w.themPos)}</td>
                      <td className="aw-num">{pct(w.them)}</td>
                      <td className="aw-num">
                        <span className="flex flex-col">
                          <span>{pct(w.you)}</span>
                          {w.youPos !== null ? <span className="text-[12px] text-muted">{pos(w.youPos)}</span> : null}
                        </span>
                      </td>
                      <td className="aw-num whitespace-nowrap">
                        {w.won} <span className="text-muted">of {w.answers}</span>
                      </td>
                      <td>
                        <span className="flex flex-wrap items-center gap-1">
                          {w.engines.map((e) => (
                            <span key={e} title={e}>
                              <EngineName engine={e} size={16} />
                            </span>
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="aw-small p-5">None in this period.</p>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-6">
          <section className={SECTION}>
            <div className="aw-frame__head justify-between">
              <h3 className="aw-h4">By model</h3>
              <span className="flex items-center gap-3 text-[12px] text-muted">
                <span className="flex items-center gap-1.5">
                  <i className="inline-block h-2 w-2" style={{ background: B_COLOR }} aria-hidden="true" />
                  {s.name}
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="inline-block h-2 w-2" style={{ background: YOU_COLOR }} aria-hidden="true" />
                  You
                </span>
              </span>
            </div>
            <ul className="flex flex-col gap-4 p-5">
              {models.map((m) => (
                <li key={m.key} className="flex flex-col gap-1.5">
                  <span className="flex items-center justify-between gap-3 text-[14px] text-ink">
                    <EngineName engine={m.key} size={16} />
                    <span className="aw-num text-[12px] text-muted">{pos(m.position)}</span>
                  </span>
                  <Bar v={m.a} color={B_COLOR} />
                  <Bar v={m.b} color={YOU_COLOR} />
                </li>
              ))}
              {!models.length ? <li className="aw-small">–</li> : null}
            </ul>
          </section>

          <section className={SECTION}>
            <div className="aw-frame__head justify-between">
              <h3 className="aw-h4">Top sources</h3>
              <span className="aw-micro">{cited.answers} answers</span>
            </div>
            {cited.sites.length ? (
              <table className="aw-table">
                <thead>
                  <tr>
                    <th>Site</th>
                    <th className="w-20">Answers</th>
                    <th className="w-20">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {cited.sites.slice(0, 10).map((x) => (
                    <tr key={x.site}>
                      <td className="max-w-0">
                        <span className="flex min-w-0 items-center gap-2">
                          <BrandLogo src={favicon(x.site)} name={x.site} size={16} />
                          <span className="truncate text-ink">{x.site}</span>
                          {domain && ownsDomain(x.site, domain) ? <span className="aw-tag shrink-0">Their site</span> : null}
                          {ownsDomain(x.site, brand.domain?.toLowerCase().replace(/^www\./, "")) ? <span className="aw-badge shrink-0">You</span> : null}
                        </span>
                      </td>
                      <td className="aw-num">{x.n}</td>
                      <td className="aw-num">{pct((x.n / cited.answers) * 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="aw-small p-5">–</p>
            )}
          </section>
        </div>
      </div>

      {domain && (auth || report) ? (
        <section className={SECTION}>
          <div className="aw-frame__head justify-between">
            <h3 className="aw-h4">SEO performance</h3>
            {report ? (
              <span className="aw-micro">
                {flag(report.country)} {report.country} · {report.domain}
              </span>
            ) : auth ? (
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={busy} onClick={load}>
                {busy ? "Loading…" : "Load SEO stats"}
              </button>
            ) : null}
          </div>
          {error ? <p className="aw-error m-5">{error}</p> : null}
          {busy ? (
            <div className="p-5">
              <Thinking text={`Loading ${domain}`} />
            </div>
          ) : null}
          {report ? (
            <div className="flex flex-col gap-6 p-5">
              {o ? (
                <div className="aw-stats aw-stats--tight" style={{ ["--cols" as string]: 5 }}>
                  {[
                    { lab: "Est. visits / month", v: short(o.traffic) },
                    { lab: "Keywords on Google", v: short(o.keywords) },
                    { lab: "In top 3", v: short(o.top3) },
                    { lab: "In top 10", v: short(o.top10) },
                    {
                      lab: "New · lost",
                      v: (
                        <span className="text-[22px]">
                          <span className="text-pos">↗ {short(o.newKw)}</span> <span className="text-neg">↘ {short(o.lostKw)}</span>
                        </span>
                      ),
                    },
                  ].map((x) => (
                    <div key={x.lab} className="aw-stat">
                      <div className="aw-stat__lab">{x.lab}</div>
                      <span className="aw-stat__num">{x.v}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="aw-small">No Google data for {report.domain} in {report.country}.</p>
              )}
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="min-w-0 border border-rule">
                  <div className="border-b border-rule-faint px-4 py-3">
                    <span className="aw-label">Top keywords</span>
                  </div>
                  <table className="aw-table table-fixed">
                    <thead>
                      <tr>
                        <th>Keyword</th>
                        <th className="w-20">Position</th>
                        <th className="w-20">Volume</th>
                        <th className="w-24">Visits / mo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topKeywords.map((k) => (
                        <tr key={k.keyword}>
                          <td className="truncate text-ink" title={k.url ?? k.keyword}>
                            {k.keyword}
                          </td>
                          <td className="aw-num">{k.rank ? `#${k.rank}` : "–"}</td>
                          <td className="aw-num">{short(k.volume)}</td>
                          <td className="aw-num">{short(k.etv === null || k.etv === undefined ? null : Math.round(k.etv))}</td>
                        </tr>
                      ))}
                      {!topKeywords.length ? (
                        <tr>
                          <td colSpan={4} className="aw-small">
                            –
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                <div className="min-w-0 border border-rule">
                  <div className="border-b border-rule-faint px-4 py-3">
                    <span className="aw-label">Top pages</span>
                  </div>
                  <table className="aw-table table-fixed">
                    <thead>
                      <tr>
                        <th>Page</th>
                        <th className="w-24">Visits / mo</th>
                        <th className="w-24">Keywords</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topPages.map((p) => (
                        <tr key={p.url}>
                          <td className="truncate">
                            <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="block truncate" title={`${p.url}\n${p.top}`}>
                              {path(p.url)}
                            </a>
                          </td>
                          <td className="aw-num">{short(p.traffic)}</td>
                          <td className="aw-num">{short(p.keywords)}</td>
                        </tr>
                      ))}
                      {!topPages.length ? (
                        <tr>
                          <td colSpan={3} className="aw-small">
                            –
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </SidePanel>
  );
}
