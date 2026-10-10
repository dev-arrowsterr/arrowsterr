"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useContext, useEffect, useState } from "react";
import { addCalendarItems, type Site } from "@/lib/db";
import { MARKETS, stageFromIntent, type KeywordReport, type KwSummary } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import { BookmarkIcon, CalendarIcon, ChartIcon, favicon, SidePanel, Thinking } from "../ui";
import { flag, kdColor, kdWord, short } from "./KeywordOverview";
import { AnalyzeSeo, fmtCpc, post, SerpTags, Sparkline, StageTag } from "./shared";
import { addToBank } from "./TopicBank";

/** Everything about one keyword in a side panel: numbers, trend, Google's results and ideas, with buttons to plan it. */
export function KeywordPanel({
  sb,
  auth,
  site,
  keyword,
  seed,
  canEdit,
  onSite,
  onClose,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  site: Site;
  keyword: string;
  seed?: Partial<KwSummary> | null;
  canEdit: boolean;
  onSite?: (s: Site) => void;
  onClose: () => void;
}) {
  const country = site.profile.country && MARKETS[site.profile.country] ? site.profile.country : "United States";
  const [report, setReport] = useStash<KeywordReport | null>(`kwpanel:${country}:${keyword}`, null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string[]>([]);
  const analyze = useContext(AnalyzeSeo);

  useEffect(() => {
    if (report) return;
    let live = true;
    post<KeywordReport>(auth, "/api/research/report", { action: "report", keyword, country })
      .then((r) => live && setReport(r))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [auth, keyword, country, report, setReport]);

  const o: Partial<KwSummary> = { ...(seed ?? {}), ...(report?.overview ?? {}) };
  const inBank = (site.profile.bank ?? []).some((b) => b.keyword === keyword.toLowerCase());
  const trend = o.trend ?? [];
  const change = trend.length > 1 && trend[0].volume ? Math.round(((trend[trend.length - 1].volume - trend[0].volume) / trend[0].volume) * 100) : null;
  const stage = stageFromIntent(o.intent ?? null);

  async function toCalendar() {
    setError("");
    try {
      const n = await addCalendarItems(sb, auth.workspaceId, [
        { site_id: site.id, keyword, secondary: [], stage, theme: null, volume: o.volume ?? null, difficulty: o.kd ?? null, intent: o.intent ?? null, cpc: o.cpc ?? null, source: "keyword research" },
      ]);
      setDone((d) => [...d, n ? "On the Editorial Calendar" : "Already on the Editorial Calendar"]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function toBank() {
    if (!onSite) return;
    addToBank(sb, site, onSite, [{ keyword, volume: o.volume ?? null, kd: o.kd ?? null, intent: o.intent ?? null, cpc: o.cpc ?? null }], "keyword research");
    setDone((d) => [...d, "In the Topic Bank"]);
  }

  const stat = (lab: string, v: React.ReactNode, sub?: React.ReactNode) => (
    <div className="aw-kpi">
      <span className="aw-kpi__lab">{lab}</span>
      <span className="aw-kpi__num text-ink">{v}</span>
      {sub}
    </div>
  );

  return (
    <SidePanel narrow kicker={`${flag(country)} ${country}`} title={keyword} onClose={onClose}>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={toCalendar}>
            <CalendarIcon />
            Add to Editorial Calendar
          </button>
          {onSite ? (
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={toBank} disabled={inBank}>
              <BookmarkIcon />
              {inBank ? "In the Topic Bank" : "Add to Topic Bank"}
            </button>
          ) : null}
          {done.map((d) => (
            <span key={d} className="aw-status aw-status--ranked">
              {d}
            </span>
          ))}
        </div>
      ) : null}
      {error ? <p className="aw-error">{error}</p> : null}

      <div className="aw-kpis" style={{ ["--cols" as string]: 4 }}>
        {stat("Volume", short(o.volume ?? null), <span className="text-[12px] text-muted">a month{o.source === "clickstream" ? " · clickstream estimate" : o.source === "ads" ? " · Google Ads" : ""}</span>)}
        {stat(
          "Difficulty",
          o.kd === null || o.kd === undefined ? "–" : o.kd,
          o.kd === null || o.kd === undefined ? null : (
            <span className="text-[12px] font-medium" style={{ color: kdColor(o.kd) }}>
              {kdWord(o.kd)}
            </span>
          ),
        )}
        {stat("Intent", <span className="capitalize">{o.intent ?? "–"}</span>, <StageTag stage={stage} />)}
        {stat("CPC", fmtCpc(o.cpc ?? null), o.competition !== null && o.competition !== undefined ? <span className="text-[12px] text-muted">Competition {Math.round(o.competition * 100)}%</span> : null)}
      </div>

      {trend.length ? (
        <section className="aw-frame flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="aw-label">12-month trend</span>
            {change !== null ? <span className={`text-[13px] font-medium ${change >= 0 ? "text-pos" : "text-neg"}`}>{change >= 0 ? `↗ ${change}%` : `↘ ${-change}%`}</span> : null}
          </div>
          <Sparkline values={trend.map((t) => t.volume)} />
        </section>
      ) : null}

      {!report && !error ? <Thinking text="Loading Google results..." /> : null}

      {report?.serp ? (
        <section className="aw-frame flex flex-col">
          <div className="aw-frame__head">
            <h3 className="aw-h4">Top 10 on Google</h3>
            {report.serp.aio.shown ? <span className="aw-status aw-status--pending">AI Overview</span> : null}
          </div>
          {report.serp.features.length ? (
            <div className="border-b border-rule-faint px-5 py-3">
              <SerpTags serp={report.serp.features} />
            </div>
          ) : null}
          <ol className="divide-y divide-rule-faint">
            {report.serp.rows.slice(0, 10).map((r) => (
              <li key={r.url} className="flex items-center gap-3 px-5 py-2.5">
                <span className="aw-num w-5 text-[12px] text-muted">{r.rank}</span>
                <img src={favicon(r.domain)} alt="" width={16} height={16} className="rounded-[4px]" />
                <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 flex-1 truncate text-[13px]" title={r.url}>
                  {r.domain}
                  <span className="text-muted">{r.url.replace(/^https?:\/\/[^/]+/, "")}</span>
                </a>
                {r.aiCited ? <span className="aw-chip text-[11px]!">AI cited</span> : null}
                <span className="aw-num w-12 text-right text-[12px] text-ink">{short(r.traffic)}</span>
                {analyze ? (
                  <button
                    type="button"
                    className="aw-btn aw-btn--secondary aw-btn--sm shrink-0 px-2.5! py-1! text-[12px]!"
                    onClick={() => {
                      onClose();
                      analyze(r.url, "url");
                    }}
                    title={`Open ${r.url} in Domain Research`}
                  >
                    <ChartIcon />
                    Analyze SEO
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {report ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { title: "Variations", rows: report.variations.rows },
            { title: "Questions", rows: report.questions.rows },
          ].map((b) => (
            <section key={b.title} className="aw-frame flex flex-col">
              <div className="aw-frame__head">
                <h3 className="aw-h4">{b.title}</h3>
              </div>
              <ul className="divide-y divide-rule-faint">
                {b.rows.slice(0, 6).map((r) => (
                  <li key={r.keyword} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
                    <span className="min-w-0 truncate text-ink" title={r.keyword}>
                      {r.keyword}
                    </span>
                    <span className="aw-num shrink-0 text-muted">{short(r.volume)}</span>
                  </li>
                ))}
                {!b.rows.length ? <li className="px-4 py-3 text-[13px] text-muted">–</li> : null}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </SidePanel>
  );
}
