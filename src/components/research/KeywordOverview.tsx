"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useContext, useEffect, useRef, useState } from "react";
import { addCalendarItems, type Site } from "@/lib/db";
import { MARKETS, stageFromIntent, type KeywordReport, type KwList, type KwSummary } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { peek, putStash, useStash } from "@/lib/stash";
import { BrandLogo } from "../BrandLogo";
import { Sheet } from "../Sheet";
import { SampleBars, SampleChips, SampleRing, SampleRows, SampleStats, ToolIntro } from "../ToolIntro";
import { CalendarIcon, Card, favicon, Seg, Thinking } from "../ui";
import { BulkKeywords } from "./Bulk";
import { BAR_BUTTON, BAR_FIELD, BAR_INPUT, AnalyzeSeo, downloadCsv, fmtCpc, post, postLines, Sparkline } from "./shared";

export const ISO: Record<string, string> = {
  "United States": "US", "United Kingdom": "GB", Canada: "CA", Australia: "AU", Germany: "DE", France: "FR", Spain: "ES", Netherlands: "NL",
  India: "IN", Singapore: "SG", Vietnam: "VN", Japan: "JP", Brazil: "BR", Mexico: "MX",
};
export const flag = (country: string) => {
  const c = ISO[country];
  return c ? String.fromCodePoint(...[...c].map((ch) => 127397 + ch.charCodeAt(0))) : "🌐";
};
export const kdWord = (kd: number) => (kd < 15 ? "Very easy" : kd < 30 ? "Easy" : kd < 50 ? "Possible" : kd < 70 ? "Difficult" : kd < 85 ? "Hard" : "Very hard");
export const kdColor = (kd: number) => (kd < 30 ? "var(--aw-pos)" : kd < 50 ? "#F5B70A" : kd < 70 ? "#EA580C" : "var(--aw-neg)");
export const short = (n: number | null | undefined) =>
  n === null || n === undefined ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K` : String(n);

export const KdDot = ({ kd }: { kd: number | null }) =>
  kd === null ? (
    <span className="text-muted">–</span>
  ) : (
    <span className="inline-flex items-center gap-1.5" title={kdWord(kd)}>
      <span className="aw-num">{kd}</span>
      <i className="inline-block h-2.5 w-2.5" style={{ background: kdColor(kd), borderRadius: 999 }} aria-hidden="true" />
    </span>
  );

/** One keyword at a glance: its numbers, ideas around it and who ranks. Paste several to compare them. */
export function KeywordOverview({ sb, auth, site, canEdit }: { sb: SupabaseClient; auth: RunAuth; site: Site; canEdit: boolean }) {
  const toDomain = useContext(AnalyzeSeo);
  const top = useRef<HTMLFormElement | null>(null);
  const k = (name: string) => `kw:${site.id}:${name}`;
  const [query, setQuery] = useStash(k("q"), "");
  const [country, setCountry] = useStash(k("country"), site.profile.country && MARKETS[site.profile.country] ? site.profile.country : "United States");
  const [saved, setReport] = useStash<KeywordReport | null>(k("report"), null);
  // A report still coming in, piece by piece. Only the finished one is remembered.
  const [live, setLive] = useState<KeywordReport | null>(null);
  const [waiting, setWaiting] = useState<string[]>([]);
  const report = live ?? saved;
  const [mode, setMode] = useStash<"single" | "bulk">(k("mode"), "single");
  const [all, setAll] = useStash<{ questions: boolean; list: KwList } | null>(k("all"), null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // A topic sent from Prompts: fill it in and, for editors, run it once.
  useEffect(() => {
    const seed = peek<string | null>(k("seed"));
    if (!seed) return;
    putStash(k("seed"), null);
    if (canEdit && seed !== query) analyze(seed);
    else setQuery(seed);
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The full list fills the screen. Esc closes it.
  useEffect(() => {
    if (!all) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !(e.target as HTMLElement).closest?.("[role=dialog]") && setAll(null);
    window.addEventListener("keydown", esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = overflow;
    };
  }, [all, setAll]);

  /** A keyword that researches itself when clicked. */
  const kwLink = (keyword: string) =>
    canEdit ? (
      <button
        type="button"
        className="aw-text-link text-left"
        title={`Research "${keyword}"`}
        onClick={() => {
          setAll(null);
          analyze(keyword);
        }}
      >
        {keyword}
      </button>
    ) : (
      keyword
    );

  const many = (q: string) => q.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

  async function analyze(input: string) {
    const list = many(input);
    if (!list.length) return;
    // Several keywords go to Bulk analysis, ready to run.
    if (list.length > 1) {
      putStash(`kwb:${site.id}:text`, list.join("\n"));
      setMode("bulk");
      return;
    }
    setQuery(input);
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setError("");
    setNotice("");
    setPicked(new Set());
    try {
      setBusy(`Analyzing "${list[0]}"...`);
      setAll(null);
      const none: KwList = { total: 0, volume: 0, rows: [] };
      let cur: KeywordReport = {
        keyword: list[0].toLowerCase().replace(/\s+/g, " "),
        country,
        device: "desktop",
        overview: null,
        byCountry: [],
        variations: none,
        questions: none,
        clusters: [],
        serp: null,
        cost: 0,
        cached: true,
      };
      let left = ["overview", "ideas", "serp"];
      setWaiting(left);
      // Each piece shows the moment it lands, so the numbers come up before Google's results.
      await postLines(auth, "/api/research/report", { action: "report", keyword: list[0], country, stream: true }, (x) => {
        if (x.part === "error") throw new Error(String(x.error));
        if (x.part === "done") {
          setReport(x.report as KeywordReport);
          setLive(null);
          return;
        }
        const { part, ...rest } = x;
        cur = { ...cur, ...rest };
        left = left.filter((p) => p !== part);
        setLive(cur);
        setWaiting(left);
        setBusy("");
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
      setLive(null);
      setWaiting([]);
    }
  }

  async function viewAll(questions: boolean) {
    if (!report) return;
    setBusy("Loading the full list...");
    try {
      setAll({ questions, list: await post<KwList>(auth, "/api/research/report", { action: "all", keyword: report.keyword, country, questions }) });
      setPicked(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function addToCalendar(rows: KwSummary[]) {
    setError("");
    try {
      const n = await addCalendarItems(
        sb,
        auth.workspaceId,
        rows.map((r) => ({ site_id: site.id, keyword: r.keyword, secondary: [], stage: stageFromIntent(r.intent), theme: null, volume: r.volume, difficulty: r.kd, intent: r.intent, cpc: r.cpc, source: "keyword research" })),
      );
      setNotice(`${n} added to the Content Plan.${n < rows.length ? ` ${rows.length - n} were already in it.` : ""}`);
      setPicked(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }


  const sheet = (rows: KwSummary[], label: string) => (
    <>
      {picked.size && canEdit ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-rule-faint bg-brand-pale px-5 py-2.5">
          <span className="text-[13px] font-medium text-ink">{picked.size} selected</span>
          <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={() => addToCalendar(rows.filter((r) => picked.has(r.keyword)))}>
            <CalendarIcon />
            Add to Content Plan
          </button>
          <button type="button" className="aw-text-link text-[13px]" onClick={() => setPicked(new Set())}>
            Clear
          </button>
        </div>
      ) : null}
      <Sheet
        label={label}
        rows={rows}
        rowKey={(r) => r.keyword}
        sort={{ key: "volume", desc: true }}
        selected={canEdit ? picked : undefined}
        onSelect={canEdit ? setPicked : undefined}
        pageSize={100}
        height="none"
        cols={[
          { id: "keyword", label: "Keyword", type: "text", value: (r) => r.keyword, cell: (r) => kwLink(r.keyword), width: 240 },
          { id: "volume", label: "Volume", type: "number", value: (r) => r.volume },
          { id: "kd", label: "KD %", type: "number", value: (r) => r.kd, cell: (r) => <KdDot kd={r.kd} /> },
          { id: "intent", label: "Intent", type: "list", value: (r) => r.intent },
          { id: "cpc", label: "CPC", type: "number", value: (r) => r.cpc, cell: (r) => fmtCpc(r.cpc) },
          { id: "trend", label: "Trend", type: "number", value: (r) => (r.trend.length > 1 ? r.trend[r.trend.length - 1].volume - r.trend[0].volume : null), cell: (r) => <Sparkline values={r.trend.map((t) => t.volume)} /> },
          { id: "aio", label: "AI Overview", type: "list", value: (r) => (r.serp.includes("ai_overview") ? "Yes" : "No"), options: ["Yes", "No"] },
        ]}
      />
    </>
  );

  /** Variations or questions: the count, the top 5, and a button for the full list. */
  const ideaColumn = (title: string, l: KwList, questions: boolean) => (
    <div className="flex flex-col gap-3 p-5">
      <span className="aw-label">{title}</span>
      <span className="flex items-baseline gap-2">
        <span className="aw-num text-[32px] leading-none text-brand">{short(l.total)}</span>
        <span className="aw-small">{l.total === 1 ? "keyword" : "keywords"}</span>
      </span>
      <table className="aw-table aw-table--compact">
        <thead>
          <tr>
            <th>Keyword</th>
            <th className="w-20 text-right!">Volume</th>
            <th className="w-16">KD</th>
          </tr>
        </thead>
        <tbody>
          {l.rows.slice(0, 5).map((r) => (
            <tr key={r.keyword}>
              <td>{kwLink(r.keyword)}</td>
              <td className="aw-num text-right">{short(r.volume)}</td>
              <td>
                <KdDot kd={r.kd} />
              </td>
            </tr>
          ))}
          {!l.rows.length ? (
            <tr>
              <td colSpan={3} className="aw-small">
                None found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {l.total > 5 && canEdit ? (
        <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm self-start" onClick={() => viewAll(questions)}>
          {l.total > 1000 ? "View top 1,000 keywords" : `View all ${l.total.toLocaleString("en-US")} keywords`}
        </button>
      ) : null}
    </div>
  );

  const o = report?.overview;
  const s = report?.serp;
  const trendChange = o && o.trend.length > 1 && o.trend[0].volume ? Math.round(((o.trend[o.trend.length - 1].volume - o.trend[0].volume) / o.trend[0].volume) * 100) : null;

  const modeBar = (
    <div className="flex">
      <Seg
        label="Mode"
        value={mode}
        onChange={setMode}
        options={[
          { id: "single", label: "Keyword overview" },
          { id: "bulk", label: "Bulk analysis" },
        ]}
      />
    </div>
  );
  if (mode === "bulk")
    return (
      <div className="flex flex-col gap-5">
        {modeBar}
        <BulkKeywords
          sb={sb}
          auth={auth}
          site={site}
          canEdit={canEdit}
          onResearch={(keyword) => {
            setMode("single");
            analyze(keyword);
          }}
        />
      </div>
    );

  return (
    <div className="flex flex-col gap-5">
      {modeBar}
      <form
        ref={top}
        className="aw-frame flex flex-wrap scroll-mt-6 items-center gap-3 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          analyze(query);
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter a keyword, or several separated by commas"
          aria-label="Keyword"
          className={BAR_INPUT}
        />
        <select aria-label="Country" value={country} onChange={(e) => setCountry(e.target.value)} className={BAR_FIELD}>
          {Object.keys(MARKETS).map((c) => (
            <option key={c} value={c}>
              {flag(c)} {c}
            </option>
          ))}
        </select>
        <button type="submit" className={BAR_BUTTON} disabled={!canEdit || Boolean(busy) || waiting.length > 0 || !query.trim()}>
          Analyze
        </button>
      </form>

      {error ? <p className="aw-error">{error}</p> : null}
      {notice ? <div className="aw-callout">{notice}</div> : null}
      {busy ? <Thinking text={busy} /> : null}

      {!busy && report ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="aw-h3">{report.keyword}</h2>
              <span className="text-[13px] text-muted">
                {flag(report.country)} {report.country} · {live ? "Loading..." : report.cached ? "Free, saved results" : `Cost $${report.cost.toFixed(3)}`}
              </span>
            </div>
            {canEdit && o ? (
              <span className="flex flex-wrap gap-2">
                <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => addToCalendar([o])}>
                  <CalendarIcon />
                  Add to calendar
                </button>
              </span>
            ) : null}
          </div>

          {waiting.includes("overview") ? (
            <div className="aw-frame">
              <Pending text="Getting the numbers..." />
            </div>
          ) : o ? (
            <div className="aw-stats aw-stats--tight" style={{ ["--cols" as string]: 5 }}>
              <div className="aw-stat">
                <div className="aw-stat__lab">Volume</div>
                <span className="aw-stat__num">{short(o.volume)}</span>
                {o.source ? <span className="text-[12px] text-muted">{o.source === "ads" ? "From Google Ads" : "Clickstream estimate"}</span> : null}
              </div>
              <div className="aw-stat">
                <div className="aw-stat__lab">Difficulty</div>
                {o.kd === null ? (
                  <span className="aw-stat__num text-muted">–</span>
                ) : (
                  <div className="flex items-baseline gap-2">
                    <span className="aw-stat__num">{o.kd}</span>
                    <span className="text-[13px]" style={{ color: kdColor(o.kd) }}>
                      {kdWord(o.kd)}
                    </span>
                  </div>
                )}
              </div>
              <div className="aw-stat">
                <div className="aw-stat__lab">Intent</div>
                <span className="text-[20px] capitalize text-ink">{o.intent ?? "–"}</span>
              </div>
              <div className="aw-stat">
                <div className="aw-stat__lab">CPC</div>
                <span className="aw-stat__num">{fmtCpc(o.cpc)}</span>
              </div>
              <div className="aw-stat">
                <div className="aw-stat__lab">12-month trend</div>
                <div className="flex items-center gap-2">
                  <Sparkline values={o.trend.map((t) => t.volume)} />
                  {trendChange !== null ? <span className={`text-[13px] ${trendChange >= 0 ? "text-pos" : "text-neg"}`}>{trendChange >= 0 ? `↗ ${trendChange}%` : `↘ ${-trendChange}%`}</span> : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="aw-callout">No search data in {report.country}.</div>
          )}

          <Card title="Keyword ideas">
            {waiting.includes("ideas") ? (
              <Pending text="Finding related keywords..." />
            ) : (
              <div className="grid divide-y divide-rule-faint lg:grid-cols-3 lg:divide-x lg:divide-y-0">
                {ideaColumn("Keyword variations", report.variations, false)}
                {ideaColumn("Questions", report.questions, true)}
                <div className="flex flex-col gap-3 p-5">
                  <span className="aw-label">Topics</span>
                  <span className="aw-small">Groups of keywords one page can cover. Click one to research it.</span>
                  <ul className="flex flex-col gap-2">
                    {report.clusters.map((c) => (
                      <li key={c.name} className="flex items-baseline justify-between gap-3 text-[14px]">
                        <span className="min-w-0">{kwLink(c.name)}</span>
                        <span className="aw-num shrink-0 text-[12px] text-muted">
                          {c.count} kw · {short(c.volume)}
                        </span>
                      </li>
                    ))}
                    {!report.clusters.length ? <li className="aw-small">Not enough related keywords to group.</li> : null}
                  </ul>
                </div>
              </div>
            )}
          </Card>

          <Card title="Top 10 on Google">
            {waiting.includes("serp") ? (
              <Pending text="Reading Google's top 10 and AI Overview..." />
            ) : !s ? (
              <p className="aw-small p-5">Could not load Google&apos;s results. Try again in a minute.</p>
            ) : (
              <table className="aw-table">
                <thead>
                  <tr>
                    <th className="w-12">#</th>
                    <th>URL</th>
                    <th className="w-32 text-right!">Visits / mo</th>
                    <th className="w-32 text-right!">Keywords</th>
                    <th className="w-12" aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {s.aio.shown ? (
                    <tr>
                      <td className="text-muted">✦</td>
                      <td colSpan={4}>
                        <div className="flex flex-wrap items-center gap-2 text-[13px]">
                          <span className="font-medium text-ink">
                            AI Overview ({s.aio.cites.length} {s.aio.cites.length === 1 ? "link" : "links"})
                          </span>
                          {s.aio.cites.slice(0, 8).map((c) => (
                            <a key={c.url} href={c.url} target="_blank" rel="noopener noreferrer nofollow" title={c.url} className="flex items-center gap-1 border border-rule px-1.5 py-0.5 text-[12px]">
                              <BrandLogo src={favicon(c.domain)} name={c.domain} size={12} />
                              {c.domain}
                            </a>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {s.rows.slice(0, 10).map((r) => (
                    <tr key={r.url} className={r.domain === site.domain.replace(/^www\./, "") ? "is-you" : ""}>
                      <td className="aw-num align-top text-muted">{r.rank}</td>
                      <td className="max-w-0">
                        <div className="flex min-w-0 flex-col gap-1">
                          {toDomain ? (
                            <button type="button" className="aw-text-link block truncate text-left" title={`Domain Research for ${r.url}`} onClick={() => toDomain(r.url, "url")}>
                              {r.url}
                            </button>
                          ) : (
                            <span className="block truncate" title={r.url}>
                              {r.url}
                            </span>
                          )}
                          <span className="flex flex-wrap items-center gap-2 text-[13px]">
                            <BrandLogo src={favicon(r.domain)} name={r.domain} size={14} />
                            {toDomain ? (
                              <button type="button" className="font-medium text-ink hover:text-brand hover:underline" title={`Domain Research for ${r.domain}`} onClick={() => toDomain(r.domain, "domain")}>
                                {r.domain}
                              </button>
                            ) : (
                              <span className="font-medium text-ink">{r.domain}</span>
                            )}
                            {r.sitelinks ? <span className="text-muted">Sitelinks</span> : null}
                            {r.aiCited ? <span className="aw-badge">AI cited</span> : null}
                          </span>
                        </div>
                      </td>
                      <td className="aw-num text-right" title="Estimated monthly visits from Google">
                        {short(r.traffic)}
                      </td>
                      <td className="aw-num text-right" title="Keywords this page ranks for">
                        {short(r.keywords)}
                      </td>
                      <td>
                        <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Open ${r.url} in a new tab`} title="Open in a new tab" className="inline-flex p-1 text-muted hover:text-brand">
                          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                          </svg>
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {all ? (
            <div role="region" aria-label="All keywords" className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-white">
              <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-white px-6 py-4">
                <div className="flex flex-col gap-0.5">
                  <h2 className="aw-h3">
                    {all.questions ? "Questions" : "Variations"} for &ldquo;{report.keyword}&rdquo;
                  </h2>
                  <span className="text-[13px] text-muted">
                    {flag(report.country)} {report.country} · {all.list.rows.length.toLocaleString("en-US")} keywords{canEdit ? " · click one to research it" : ""}
                  </span>
                </div>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    className="aw-btn aw-btn--secondary aw-btn--sm"
                    onClick={() => downloadCsv(`${report.keyword.replace(/\W+/g, "-")}.csv`, ["keyword", "volume", "kd", "intent", "cpc"], all.list.rows.map((r) => [r.keyword, r.volume, r.kd, r.intent, r.cpc]))}
                  >
                    Export CSV
                  </button>
                  <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setAll(null)} title="Close (Esc)">
                    Close
                  </button>
                </span>
              </div>
              <div className="px-6 py-4">
                <div className="aw-frame">{sheet(all.list.rows, "All keywords")}</div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {!busy && !report ? (
        <ToolIntro
          title="Know what your market wants before you write a word"
          lead="Every search is a person telling Google what they need. Keyword Research shows how many people ask, how hard it is to win the top spots, what the searcher is ready to do and what advertisers pay to reach them. Use it to place your content bets on the topics that bring buyers, and skip the ones that only bring clicks."
          examples={["crm software", "best seo agencies", "how to start a podcast"]}
          onExample={canEdit ? (x) => analyze(x) : undefined}
          features={[
            { title: "Keyword difficulty", text: "A 0 to 100 score for how hard it is to rank in the top 10. Lower is easier.", visual: <SampleRing /> },
            { title: "Search volume and trend", text: "Average monthly searches and how interest moved over the last 12 months.", visual: <SampleBars /> },
            {
              title: "Search intent",
              text: "Why people search: to learn, to compare, to buy, or to find a brand.",
              visual: <SampleChips items={[["Commercial", "#FEF3C7"], ["Informational", "#DBEAFE"], ["Transactional", "#DCFCE7"]]} />,
            },
            { title: "CPC", text: "What advertisers pay per click in Google Ads. A high CPC usually means buyers are close to buying.", visual: <SampleStats items={[["CPC", "$30.75"], ["Volume", "3.6K"], ["KD", "43"]]} /> },
            {
              title: "Keyword ideas",
              text: "The wider market around one idea: every variation and question people ask, so one keyword grows into a full topic you can own.",
              visual: <SampleRows rows={[["best seo agency", 9900, "9.9K"], ["best local seo agency", 1600, "1.6K"], ["how to choose an seo agency", 70]]} />,
            },
            {
              title: "Google's top 10",
              text: "Who owns the topic today and which pages Google's AI Overview cites. This is the bar your page has to clear.",
              visual: <SampleRows rows={[["clutch.co", 12000, "12K"], ["firstpagesage.com", 9300, "9.3K"], ["expertise.com", 6600, "6.6K"]]} />,
            },
          ]}
          steps={[
            "Type a keyword and pick a country.",
            "Click Analyze.",
            "Check difficulty, volume and intent, then add the best keywords to your editorial calendar.",
            "Open Bulk analysis to check up to 500 keywords at once.",
          ]}
          faqs={[
            { q: "How is Keyword Difficulty calculated?", a: "It looks at the pages in Google's top 10 for the keyword: how strong those sites are and how many links point to them. The stronger they are, the higher the score." },
            { q: "What is a good keyword to target?", a: "One with steady search volume, a difficulty you can realistically beat (under 30 for newer sites), and intent that matches what you sell." },
            { q: "Does every search cost money?", a: "Results are saved and shared for 30 days. If anyone looked up the same keyword recently, it loads free." },
            { q: "Can I check keywords for another country?", a: "Yes. Pick the country next to the search box before you click Analyze." },
          ]}
        />
      ) : null}
    </div>
  );
}

/** A card section still loading. */
function Pending({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-10 text-center" role="status" aria-live="polite">
      <span className="aw-small">{text}</span>
      <span className="aw-think__bar" aria-hidden="true" />
    </div>
  );
}
