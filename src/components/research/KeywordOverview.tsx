"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { addCalendarItems, type Site } from "@/lib/db";
import { MARKETS, stageFromIntent, type KeywordReport, type KwList, type KwSummary } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { peek, putStash, useStash } from "@/lib/stash";
import { BrandLogo } from "../BrandLogo";
import { Sheet } from "../Sheet";
import { SampleBars, SampleChips, SampleRing, SampleRows, SampleStats, ToolIntro } from "../ToolIntro";
import { Card, favicon, Seg, Thinking } from "../ui";
import { downloadCsv, FIELD, fmtCpc, post, Sparkline } from "./shared";

export const ISO: Record<string, string> = {
  "United States": "US", "United Kingdom": "GB", Canada: "CA", Australia: "AU", Germany: "DE", France: "FR", Spain: "ES", Netherlands: "NL",
  India: "IN", Singapore: "SG", Vietnam: "VN", Japan: "JP", Brazil: "BR", Mexico: "MX",
};
export const flag = (country: string) => {
  const c = ISO[country];
  return c ? String.fromCodePoint(...[...c].map((ch) => 127397 + ch.charCodeAt(0))) : "🌐";
};
const kdWord = (kd: number) => (kd < 15 ? "Very easy" : kd < 30 ? "Easy" : kd < 50 ? "Possible" : kd < 70 ? "Difficult" : kd < 85 ? "Hard" : "Very hard");
const kdColor = (kd: number) => (kd < 30 ? "var(--aw-pos)" : kd < 50 ? "#F5B70A" : kd < 70 ? "#EA580C" : "var(--aw-neg)");
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
  const k = (name: string) => `kw:${site.id}:${name}`;
  const [query, setQuery] = useStash(k("q"), "");
  const [country, setCountry] = useStash(k("country"), site.profile.country && MARKETS[site.profile.country] ? site.profile.country : "United States");
  const [report, setReport] = useStash<KeywordReport | null>(k("report"), null);
  const [bulk, setBulk] = useStash<{ rows: KwSummary[]; cost: number } | null>(k("bulk"), null);
  const [ideas, setIdeas] = useStash<"variations" | "questions" | "topics">(k("ideas"), "variations");
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

  const many = (q: string) => q.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

  async function analyze(input: string) {
    const list = many(input);
    if (!list.length) return;
    setQuery(input);
    setError("");
    setNotice("");
    setPicked(new Set());
    try {
      if (list.length > 1) {
        setBusy(`Checking ${list.length} keywords...`);
        setBulk(await post(auth, "/api/research/report", { action: "bulk", keywords: list, country }));
        setReport(null);
      } else {
        setBusy(`Analyzing "${list[0]}"...`);
        setReport(await post<KeywordReport>(auth, "/api/research/report", { action: "report", keyword: list[0], country }));
        setBulk(null);
        setAll(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
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
      setNotice(`${n} added to the content calendar.${n < rows.length ? ` ${rows.length - n} were already on it.` : ""}`);
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
            Add to calendar
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
        onOpen={(r) => analyze(r.keyword)}
        height="60vh"
        cols={[
          { id: "keyword", label: "Keyword", type: "text", value: (r) => r.keyword, width: 240 },
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

  const o = report?.overview;
  const s = report?.serp;
  const trendChange = o && o.trend.length > 1 && o.trend[0].volume ? Math.round(((o.trend[o.trend.length - 1].volume - o.trend[0].volume) / o.trend[0].volume) * 100) : null;
  const list = report ? (ideas === "questions" ? report.questions : report.variations) : null;

  return (
    <div className="flex flex-col gap-5">
      <form
        className="aw-frame flex flex-wrap items-center gap-3 p-3"
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
          className="aw-input min-w-56 flex-1"
        />
        <select aria-label="Country" value={country} onChange={(e) => setCountry(e.target.value)} className={FIELD}>
          {Object.keys(MARKETS).map((c) => (
            <option key={c} value={c}>
              {flag(c)} {c}
            </option>
          ))}
        </select>
        <button type="submit" className="aw-btn aw-btn--accent" disabled={!canEdit || Boolean(busy) || !query.trim()}>
          Analyze
        </button>
      </form>

      {error ? <p className="aw-error">{error}</p> : null}
      {notice ? <div className="aw-callout">{notice}</div> : null}
      {busy ? <Thinking text={busy} /> : null}

      {!busy && bulk ? (
        <Card
          title={`${bulk.rows.length} keywords`}
          action={
            <span className="flex items-center gap-3">
              <span className="aw-label">{bulk.cost ? `Cost $${bulk.cost.toFixed(3)}` : "Free, saved results"}</span>
              <button
                type="button"
                className="aw-btn aw-btn--secondary aw-btn--sm"
                onClick={() => downloadCsv("keywords.csv", ["keyword", "volume", "kd", "intent", "cpc"], bulk.rows.map((r) => [r.keyword, r.volume, r.kd, r.intent, r.cpc]))}
              >
                Export CSV
              </button>
            </span>
          }
        >
          {sheet(bulk.rows, "Keywords")}
        </Card>
      ) : null}

      {!busy && report ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="aw-h3">{report.keyword}</h2>
              <span className="text-[13px] text-muted">
                {flag(report.country)} {report.country} · {report.cached ? "Free, saved results" : `Cost $${report.cost.toFixed(3)}`}
              </span>
            </div>
            {canEdit && o ? (
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => addToCalendar([o])}>
                Add to calendar
              </button>
            ) : null}
          </div>

          {o ? (
            <div className="aw-stats aw-stats--tight" style={{ ["--cols" as string]: 5 }}>
              <div className="aw-stat">
                <div className="aw-stat__lab">Volume</div>
                <span className="aw-stat__num">{short(o.volume)}</span>
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
            <div className="aw-callout">Google has no search data for this keyword in {report.country}. Try simpler wording or another country.</div>
          )}

          <div className="grid gap-5 xl:grid-cols-2">
            <Card
              title={
                <Seg
                  label="Ideas"
                  value={ideas}
                  onChange={setIdeas}
                  options={[
                    { id: "variations", label: `Variations ${short(report.variations.total)}` },
                    { id: "questions", label: `Questions ${short(report.questions.total)}` },
                    { id: "topics", label: "Topics" },
                  ]}
                />
              }
            >
              {ideas === "topics" ? (
                <ul className="divide-y divide-rule-faint">
                  {report.clusters.map((c) => (
                    <li key={c.name} className="flex items-center justify-between gap-3 px-5 py-2.5">
                      <button type="button" className="aw-text-link text-left text-[14px]" onClick={() => analyze(c.name)}>
                        {c.name}
                      </button>
                      <span className="aw-num text-[12px] text-muted">
                        {c.count} keywords · {short(c.volume)}
                      </span>
                    </li>
                  ))}
                  {!report.clusters.length ? <li className="aw-small px-5 py-4">Not enough related keywords to group.</li> : null}
                </ul>
              ) : list ? (
                <>
                  <table className="aw-table aw-table--compact">
                    <thead>
                      <tr>
                        <th>Keyword</th>
                        <th className="w-20">Volume</th>
                        <th className="w-16">KD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.rows.slice(0, 10).map((r) => (
                        <tr key={r.keyword}>
                          <td>
                            <button type="button" className="aw-text-link text-left" onClick={() => analyze(r.keyword)}>
                              {r.keyword}
                            </button>
                          </td>
                          <td className="aw-num">{short(r.volume)}</td>
                          <td>
                            <KdDot kd={r.kd} />
                          </td>
                        </tr>
                      ))}
                      {!list.rows.length ? (
                        <tr>
                          <td colSpan={3} className="aw-small">
                            None found.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                  {list.total > 10 ? (
                    <div className="border-t border-rule-faint px-5 py-3">
                      <button type="button" className="aw-text-link" onClick={() => viewAll(ideas === "questions")} disabled={!canEdit}>
                        See all {list.total > 1000 ? "top 1,000" : list.total} in a sheet
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </Card>

            <Card title="Top 10 on Google">
              {!s ? (
                <p className="aw-small p-5">Could not load Google&apos;s results. Try again in a minute.</p>
              ) : (
                <>
                  {s.aio.shown ? (
                    <div className="flex flex-wrap items-center gap-2 border-b border-rule-faint px-5 py-3 text-[13px]">
                      <span className="text-ink">✦ AI Overview cites</span>
                      {s.aio.cites.slice(0, 6).map((c) => (
                        <a key={c.url} href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1 border border-rule px-1.5 py-0.5 text-[12px]">
                          <BrandLogo src={favicon(c.domain)} name={c.domain} size={12} />
                          {c.domain}
                        </a>
                      ))}
                      {!s.aio.cites.length ? <span className="text-muted">no links</span> : null}
                    </div>
                  ) : null}
                  <ol className="divide-y divide-rule-faint">
                    {s.rows.slice(0, 10).map((r) => (
                      <li key={r.url} className={`flex items-center gap-3 px-5 py-2.5 ${r.domain === site.domain.replace(/^www\./, "") ? "bg-brand-pale" : ""}`}>
                        <span className="aw-num w-5 text-[12px] text-muted">{r.rank}</span>
                        <BrandLogo src={favicon(r.domain)} name={r.domain} size={16} />
                        <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 flex-1 truncate text-[14px]" title={r.url}>
                          {r.domain}
                          <span className="text-muted">{new URL(r.url).pathname.replace(/\/$/, "")}</span>
                        </a>
                        {r.aiCited ? <span className="aw-badge">AI cited</span> : null}
                        <span className="aw-num w-14 text-right text-[12px] text-ink" title="Estimated monthly visits from Google">
                          {short(r.traffic)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </Card>
          </div>

          {all ? (
            <Card
              title={`${all.questions ? "Questions" : "Variations"} for "${report.keyword}"`}
              action={
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    className="aw-btn aw-btn--secondary aw-btn--sm"
                    onClick={() => downloadCsv(`${report.keyword.replace(/\W+/g, "-")}.csv`, ["keyword", "volume", "kd", "intent", "cpc"], all.list.rows.map((r) => [r.keyword, r.volume, r.kd, r.intent, r.cpc]))}
                  >
                    Export CSV
                  </button>
                  <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setAll(null)}>
                    Close
                  </button>
                </span>
              }
            >
              {sheet(all.list.rows, "All keywords")}
            </Card>
          ) : null}
        </>
      ) : null}

      {!busy && !report && !bulk ? (
        <ToolIntro
          title="Check keyword difficulty, volume, intent and trends in seconds"
          lead="Enter any word or phrase to see how hard it is to reach Google's top 10, how many people search for it, what they want, and who ranks today. Use it to pick the keywords worth your time."
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
              text: "Variations, questions and topic groups around your keyword, each with volume and difficulty.",
              visual: <SampleRows rows={[["best seo agency", 9900, "9.9K"], ["best local seo agency", 1600, "1.6K"], ["how to choose an seo agency", 70]]} />,
            },
            {
              title: "Google's top 10",
              text: "Who ranks now, their estimated traffic, and which pages Google's AI Overview cites.",
              visual: <SampleRows rows={[["clutch.co", 12000, "12K"], ["firstpagesage.com", 9300, "9.3K"], ["expertise.com", 6600, "6.6K"]]} />,
            },
          ]}
          steps={[
            "Type a keyword and pick a country.",
            "Click Analyze.",
            "Check difficulty, volume and intent, then add the best keywords to your content calendar.",
            "Paste several keywords, separated by commas, to compare them side by side.",
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
