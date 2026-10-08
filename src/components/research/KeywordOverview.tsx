"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";
import { addCalendarItems, type Site } from "@/lib/db";
import { MARKETS, stageFromIntent, type KeywordReport, type KwList, type KwSummary } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { BrandLogo } from "../BrandLogo";
import { Sheet } from "../Sheet";
import { Card, favicon, Seg, Thinking } from "../ui";
import { downloadCsv, FIELD, fmtCpc, fmtNum, post, Sparkline } from "./shared";

const ISO: Record<string, string> = {
  "United States": "US", "United Kingdom": "GB", Canada: "CA", Australia: "AU", Germany: "DE", France: "FR", Spain: "ES", Netherlands: "NL",
  India: "IN", Singapore: "SG", Vietnam: "VN", Japan: "JP", Brazil: "BR", Mexico: "MX",
};
const flag = (country: string) => {
  const c = ISO[country];
  return c ? String.fromCodePoint(...[...c].map((ch) => 127397 + ch.charCodeAt(0))) : "🌐";
};
const kdWord = (kd: number) => (kd < 15 ? "Very easy" : kd < 30 ? "Easy" : kd < 50 ? "Possible" : kd < 70 ? "Difficult" : kd < 85 ? "Hard" : "Very hard");
const kdColor = (kd: number) => (kd < 30 ? "var(--aw-pos)" : kd < 50 ? "#F5B70A" : kd < 70 ? "#EA580C" : "var(--aw-neg)");
const kdNote = (kd: number) =>
  kd < 30
    ? "A good chance to rank with a well-written page."
    : kd < 50
      ? "A competitive keyword. You will need well-structured, unique content."
      : kd < 70
        ? "Hard to rank for. You will need strong content and links from other sites."
        : "Very hard. Big sites with many backlinks hold the top spots.";
const short = (n: number | null) => (n === null ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K` : String(n));
const INTENT_STYLE: Record<string, string> = {
  commercial: "bg-[#FEF3C7] text-[#92400E]",
  transactional: "bg-[#DCFCE7] text-[#166534]",
  informational: "bg-[#DBEAFE] text-[#1E40AF]",
  navigational: "bg-[#EDE9FE] text-[#5B21B6]",
};
const FEATURE_NAME: Record<string, string> = {
  ai_overview: "AI Overview", people_also_ask: "People also ask", featured_snippet: "Featured snippet", local_pack: "Local pack", video: "Video",
  images: "Images", top_stories: "Top stories", shopping: "Shopping", popular_products: "Products", related_searches: "Related searches",
  knowledge_graph: "Knowledge panel", paid: "Ads", perspectives: "Perspectives", discussions_and_forums: "Forums", carousel: "Carousel", short_videos: "Short videos",
};

function KdRing({ kd }: { kd: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--aw-rule-faint)" strokeWidth="7" />
      <circle cx="28" cy="28" r={r} fill="none" stroke={kdColor(kd)} strokeWidth="7" strokeDasharray={`${(kd / 100) * c} ${c}`} transform="rotate(-90 28 28)" />
    </svg>
  );
}
const KdDot = ({ kd }: { kd: number | null }) =>
  kd === null ? (
    <span className="text-muted">n/a</span>
  ) : (
    <span className="inline-flex items-center gap-1.5">
      <span className="aw-num">{kd}</span>
      <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: kdColor(kd) }} aria-hidden="true" />
    </span>
  );

/** Semrush-style overview of one keyword, plus bulk analysis. Results are shared and cached, so repeat searches are free. */
export function KeywordOverview({ sb, auth, site, canEdit }: { sb: SupabaseClient; auth: RunAuth; site: Site; canEdit: boolean }) {
  const [tab, setTab] = useState<"overview" | "bulk">("overview");
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState(site.profile.country && MARKETS[site.profile.country] ? site.profile.country : "United States");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [report, setReport] = useState<KeywordReport | null>(null);
  const [all, setAll] = useState<{ title: string; list: KwList } | null>(null);
  const [bulkText, setBulkText] = useState("");
  const [bulk, setBulk] = useState<{ rows: KwSummary[]; cost: number } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [more, setMore] = useState(false);
  const [openAio, setOpenAio] = useState(false);

  async function analyze(keyword: string) {
    const kw = keyword.trim();
    if (!kw) return;
    setQuery(kw);
    setBusy(`Analyzing "${kw}"...`);
    setError("");
    setNotice("");
    setAll(null);
    setMore(false);
    try {
      setReport(await post<KeywordReport>(auth, "/api/research/report", { action: "report", keyword: kw, country, device }));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function viewAll(questions: boolean) {
    if (!report) return;
    setBusy(questions ? "Loading every question..." : "Loading every variation...");
    try {
      const list = await post<KwList & { cost: number }>(auth, "/api/research/report", { action: "all", keyword: report.keyword, country, questions });
      setAll({ title: questions ? `Questions for "${report.keyword}"` : `Variations of "${report.keyword}"`, list });
      setPicked(new Set());
      setTimeout(() => document.getElementById("kw-all")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function runBulk() {
    setBusy("Checking your keywords...");
    setError("");
    try {
      setBulk(await post<{ rows: KwSummary[]; cost: number }>(auth, "/api/research/report", { action: "bulk", keywords: bulkText.split(/\n|,/), country }));
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
        rows.map((r) => ({
          site_id: site.id,
          keyword: r.keyword,
          secondary: [],
          stage: stageFromIntent(r.intent),
          theme: null,
          volume: r.volume,
          difficulty: r.kd,
          intent: r.intent,
          cpc: r.cpc,
          source: "keyword research",
        })),
      );
      setNotice(`${n} added to the content calendar.${n < rows.length ? ` ${rows.length - n} were already on it.` : ""}`);
      setPicked(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const kwSheet = (rows: KwSummary[], label: string) => (
    <>
      {picked.size && canEdit ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-rule-faint bg-brand-pale px-5 py-2.5">
          <span className="text-[13px] font-medium text-ink">{picked.size} selected</span>
          <button type="button" className="aw-btn aw-btn--sm" onClick={() => addToCalendar(rows.filter((r) => picked.has(r.keyword)))}>
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
        onOpen={(r) => {
          setTab("overview");
          analyze(r.keyword);
        }}
        cols={[
          { id: "keyword", label: "Keyword", type: "text", value: (r) => r.keyword, width: 240 },
          { id: "volume", label: "Volume", type: "number", value: (r) => r.volume },
          { id: "kd", label: "KD %", type: "number", value: (r) => r.kd, cell: (r) => <KdDot kd={r.kd} /> },
          { id: "intent", label: "Intent", type: "list", value: (r) => r.intent },
          { id: "cpc", label: "CPC", type: "number", value: (r) => r.cpc, cell: (r) => fmtCpc(r.cpc) },
          { id: "comp", label: "Com.", type: "number", value: (r) => (r.competition === null ? null : Math.round(r.competition * 100) / 100) },
          { id: "trend", label: "Trend", type: "number", value: (r) => (r.trend.length > 1 ? r.trend[r.trend.length - 1].volume - r.trend[0].volume : null), cell: (r) => <Sparkline values={r.trend.map((t) => t.volume)} /> },
          { id: "results", label: "Results", type: "number", value: (r) => r.results, cell: (r) => short(r.results) },
          { id: "words", label: "Words", type: "number", value: (r) => r.keyword.split(" ").length },
          { id: "aio", label: "AI Overview", type: "list", value: (r) => (r.serp.includes("ai_overview") ? "Yes" : "No"), options: ["Yes", "No"] },
        ]}
      />
    </>
  );

  const searchBar = (
    <form
      className="aw-frame flex flex-wrap items-center gap-3 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (tab === "overview") analyze(query);
        else runBulk();
      }}
    >
      <Seg
        label="Mode"
        value={tab}
        onChange={setTab}
        options={[
          { id: "overview", label: "Overview" },
          { id: "bulk", label: "Bulk analysis" },
        ]}
      />
      {tab === "overview" ? (
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Enter a keyword, like best seo agencies" aria-label="Keyword" className="aw-input min-w-48 flex-1" />
      ) : (
        <span className="flex-1 text-[13px] text-muted">Paste up to 700 keywords below, one per line.</span>
      )}
      <select aria-label="Country" value={country} onChange={(e) => setCountry(e.target.value)} className={FIELD}>
        {Object.keys(MARKETS).map((c) => (
          <option key={c} value={c}>
            {flag(c)} {c}
          </option>
        ))}
      </select>
      {tab === "overview" ? (
        <select aria-label="Device" value={device} onChange={(e) => setDevice(e.target.value as "desktop" | "mobile")} className={FIELD}>
          <option value="desktop">Desktop</option>
          <option value="mobile">Mobile</option>
        </select>
      ) : null}
      <button type="submit" className="aw-btn aw-btn--accent" disabled={!canEdit || Boolean(busy) || (tab === "overview" ? !query.trim() : !bulkText.trim())}>
        Analyze
      </button>
    </form>
  );

  const o = report?.overview;
  const maxCountry = Math.max(...(report?.byCountry ?? []).map((c) => c.volume ?? 0), 1);
  const maxTrend = Math.max(...(o?.trend ?? []).map((t) => t.volume), 1);
  const s = report?.serp;
  const rows = s ? (more ? s.rows : s.rows.slice(0, 10)) : [];

  const ideaCol = (title: string, list: KwList, questions: boolean) => (
    <div className="flex min-w-0 flex-col">
      <div className="px-5 pt-4">
        <div className="text-[15px] text-ink">{title}</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="aw-num text-[30px] text-brand">{short(list.total)}</span>
          <span className="text-[13px] text-body">
            Top 100 volume: <b className="text-ink">{short(list.volume)}</b>
          </span>
        </div>
      </div>
      <table className="aw-table aw-table--compact mt-2">
        <thead>
          <tr>
            <th>Keywords</th>
            <th className="w-20">Volume</th>
            <th className="w-16">KD %</th>
          </tr>
        </thead>
        <tbody>
          {list.rows.slice(0, 5).map((r) => (
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
      {list.total > 5 ? (
        <div className="px-5 py-3">
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => viewAll(questions)} disabled={!canEdit}>
            {list.total > 1000 ? `View top 1,000 of ${fmtNum(list.total)}` : `View all ${fmtNum(list.total)} keywords`}
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {searchBar}
      {error ? <p className="aw-error">{error}</p> : null}
      {notice ? <div className="aw-callout">{notice}</div> : null}
      {busy ? <Thinking text={busy} /> : null}

      {tab === "bulk" ? (
        <>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={8}
            placeholder={"best seo agency\nseo agency pricing\nhow to choose an seo agency"}
            aria-label="Keywords to analyze"
            className="aw-textarea font-mono text-[13px]"
          />
          {bulk ? (
            <Card
              title={`${bulk.rows.length} keywords`}
              action={
                <span className="flex items-center gap-3">
                  <span className="aw-label">{bulk.cost ? `Cost $${bulk.cost.toFixed(3)}` : "Free (saved results)"}</span>
                  <button
                    type="button"
                    className="aw-btn aw-btn--secondary aw-btn--sm"
                    onClick={() =>
                      downloadCsv("bulk-keywords.csv", ["keyword", "volume", "kd", "intent", "cpc", "competition", "results"], bulk.rows.map((r) => [r.keyword, r.volume, r.kd, r.intent, r.cpc, r.competition, r.results]))
                    }
                  >
                    Export CSV
                  </button>
                </span>
              }
            >
              {kwSheet(bulk.rows, "Bulk analysis")}
            </Card>
          ) : null}
        </>
      ) : report && !busy ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="aw-h3">
                Keyword overview: <span className="text-muted">{report.keyword}</span>
              </h2>
              <span className="text-[13px] text-body">
                {flag(report.country)} {report.country} · {report.device === "mobile" ? "Mobile" : "Desktop"} ·{" "}
                {report.cached ? "Free (saved results)" : `Cost $${report.cost.toFixed(3)}`}
              </span>
            </div>
            {canEdit && o ? (
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => addToCalendar([o])}>
                Add to calendar
              </button>
            ) : null}
          </div>

          {!o ? <div className="aw-callout">Google has no data for this keyword in {report.country}. Try a more common wording or another country.</div> : null}

          {o ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <section className="aw-frame flex flex-col gap-4 p-5">
                <div>
                  <div className="text-[14px] text-body">Volume</div>
                  <div className="aw-num text-[34px] text-ink">
                    {short(o.volume)} <span className="text-[20px]">{flag(report.country)}</span>
                  </div>
                </div>
                <div className="border-t border-rule-faint pt-4">
                  <div className="text-[14px] text-body">Keyword Difficulty</div>
                  {o.kd === null ? (
                    <div className="aw-num text-[28px] text-muted">n/a</div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <span className="aw-num text-[34px] text-ink">{o.kd}%</span>
                        <KdRing kd={o.kd} />
                      </div>
                      <div className="text-[13px] text-ink">{kdWord(o.kd)}</div>
                      <p className="mt-2 text-[13px] text-muted">{kdNote(o.kd)}</p>
                    </>
                  )}
                </div>
              </section>

              <section className="aw-frame flex flex-col gap-3 p-5">
                <div className="text-[14px] text-body">Volume by country</div>
                <ul className="flex flex-col gap-2.5">
                  {report.byCountry.map((c) => (
                    <li key={c.country} className="grid grid-cols-[64px_1fr_52px] items-center gap-3 text-[13px]">
                      <span className="text-brand">
                        {flag(c.country)} {ISO[c.country] ?? c.country}
                      </span>
                      <span className="h-2 bg-rule-faint">
                        <span className="block h-full bg-brand" style={{ width: `${((c.volume ?? 0) / maxCountry) * 100}%`, opacity: c.country === report.country ? 1 : 0.45 }} />
                      </span>
                      <span className="aw-num text-right text-ink">{short(c.volume)}</span>
                    </li>
                  ))}
                </ul>
                <p className="aw-micro mt-auto">Google volume in each market, per month.</p>
              </section>

              <section className="aw-frame flex flex-col gap-4 p-5">
                <div>
                  <div className="text-[14px] text-body">Intent</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[o.intent, ...o.otherIntents].filter(Boolean).map((i) => (
                      <span key={i} className={`px-2.5 py-1 text-[13px] capitalize ${INTENT_STYLE[i!] ?? "bg-surface-2 text-ink"}`}>
                        {i}
                      </span>
                    ))}
                    {!o.intent ? <span className="text-muted">–</span> : null}
                  </div>
                </div>
                <div className="border-t border-rule-faint pt-4">
                  <div className="text-[14px] text-body">Trend</div>
                  <div className="mt-3 flex h-24 items-end gap-1" role="img" aria-label={`Searches by month: ${o.trend.map((t) => `${t.month} ${t.volume}`).join(", ")}`}>
                    {o.trend.map((t) => (
                      <span key={t.month} className="flex-1 bg-brand-mist hover:bg-brand" style={{ height: `${Math.max(4, (t.volume / maxTrend) * 100)}%` }} title={`${t.month}: ${fmtNum(t.volume)}`} />
                    ))}
                  </div>
                  {o.trend.length ? (
                    <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
                      <span>{o.trend[0].month}</span>
                      <span>{o.trend[o.trend.length - 1].month}</span>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="aw-frame flex flex-col gap-4 p-5">
                <div>
                  <div className="text-[14px] text-body">CPC</div>
                  <div className="aw-num text-[34px] text-ink">{fmtCpc(o.cpc)}</div>
                </div>
                <div className="border-t border-rule-faint pt-4">
                  <div className="text-[14px] text-body">Competitive density</div>
                  <div className="aw-num text-[28px] text-ink">{o.competition === null ? "n/a" : o.competition.toFixed(2)}</div>
                </div>
                <div className="grid grid-cols-2 gap-3 border-t border-rule-faint pt-4">
                  <div>
                    <div className="text-[14px] text-body">Ads</div>
                    <div className="aw-num text-[24px] text-brand">{s ? s.ads : "–"}</div>
                  </div>
                  <div>
                    <div className="text-[14px] text-body">Results</div>
                    <div className="aw-num text-[24px] text-ink">{short(s?.results ?? o.results)}</div>
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          <Card title="Keyword ideas">
            <div className="grid divide-y divide-rule-faint lg:grid-cols-3 lg:divide-x lg:divide-y-0">
              {ideaCol("Keyword variations", report.variations, false)}
              {ideaCol("Questions", report.questions, true)}
              <div className="flex min-w-0 flex-col px-5 py-4">
                <div className="text-[15px] text-ink">Keyword strategy</div>
                <p className="mt-1 text-[13px] text-body">Topics around this keyword, grouped by Google&apos;s core keyword.</p>
                <div className="mt-3 text-[15px] font-medium text-ink">● {report.keyword}</div>
                <ul className="ml-1.5 mt-1 flex flex-col border-l border-rule pl-4">
                  {report.clusters.map((c) => (
                    <li key={c.name} className="py-2">
                      <button type="button" className="aw-text-link text-left text-[14px]" onClick={() => analyze(c.name)}>
                        {c.name}
                      </button>
                      <div className="text-[12px] text-muted">
                        {c.count} {c.count === 1 ? "keyword" : "keywords"} · {short(c.volume)} searches
                      </div>
                    </li>
                  ))}
                  {!report.clusters.length ? <li className="aw-small py-2">Not enough related keywords to group.</li> : null}
                </ul>
              </div>
            </div>
          </Card>

          {all ? (
            <div id="kw-all">
              <Card
                title={`${all.title} · ${fmtNum(all.list.rows.length)}`}
                action={
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      className="aw-btn aw-btn--secondary aw-btn--sm"
                      onClick={() =>
                        downloadCsv(`${report.keyword.replace(/\W+/g, "-")}-keywords.csv`, ["keyword", "volume", "kd", "intent", "cpc"], all.list.rows.map((r) => [r.keyword, r.volume, r.kd, r.intent, r.cpc]))
                      }
                    >
                      Export CSV
                    </button>
                    <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setAll(null)}>
                      Close
                    </button>
                  </span>
                }
              >
                {kwSheet(all.list.rows, all.title)}
              </Card>
            </div>
          ) : null}

          <Card title="SERP analysis" action={<span className="aw-label">Google {report.device === "mobile" ? "mobile" : "desktop"} · top 20</span>}>
            {!s ? (
              <p className="aw-small p-5">Could not load Google&apos;s results. Try again in a minute.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-start gap-8 border-b border-rule-faint px-5 py-4">
                  <div>
                    <div className="text-[13px] text-body">Results</div>
                    <div className="aw-num text-[26px] text-ink">{short(s.results)}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-body">SERP features</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {s.features.map((f) => (
                        <span key={f} className={`border px-2 py-0.5 text-[12px] ${f === "ai_overview" ? "border-brand bg-brand-pale text-brand" : "border-rule text-body"}`}>
                          {FEATURE_NAME[f] ?? f.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <table className="aw-table aw-table--compact">
                  <thead>
                    <tr>
                      <th className="w-10">#</th>
                      <th>URL</th>
                      <th className="w-32">Search traffic</th>
                      <th className="w-32">URL keywords</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.aio.shown ? (
                      <>
                        <tr className="cursor-pointer" onClick={() => setOpenAio(!openAio)}>
                          <td className="text-muted">{openAio ? "▾" : "▸"}</td>
                          <td colSpan={3} className="text-ink">
                            ✦ AI Overview ({s.aio.cites.length} {s.aio.cites.length === 1 ? "link" : "links"})
                          </td>
                        </tr>
                        {openAio
                          ? s.aio.cites.map((c) => (
                              <tr key={c.url}>
                                <td />
                                <td colSpan={3}>
                                  <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-2">
                                    <BrandLogo src={favicon(c.domain)} name={c.domain} size={14} />
                                    <span className="truncate">{c.title || c.url}</span>
                                  </a>
                                </td>
                              </tr>
                            ))
                          : null}
                      </>
                    ) : null}
                    {s.local.length ? (
                      <tr>
                        <td className="text-muted">⌖</td>
                        <td colSpan={3} className="text-ink">
                          Local pack ({s.local.length}): <span className="text-body">{s.local.map((l) => l.title).join(" · ")}</span>
                        </td>
                      </tr>
                    ) : null}
                    {rows.map((r) => (
                      <tr key={r.url} className={r.domain === site.domain.replace(/^www\./, "") ? "is-you" : ""}>
                        <td className="aw-num text-muted">{r.rank}</td>
                        <td className="max-w-xl">
                          <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className="block truncate" title={r.url}>
                            {r.url.replace(/^https?:\/\//, "")}
                          </a>
                          <span className="flex flex-wrap items-center gap-2 text-[12px]">
                            <b className="text-ink">{r.domain}</b>
                            {r.aiCited ? <span className="aw-badge">AI cited</span> : null}
                            {r.sitelinks ? <span className="text-muted">Sitelinks</span> : null}
                          </span>
                        </td>
                        <td className="aw-num">{short(r.traffic)}</td>
                        <td className="aw-num">{short(r.keywords)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {s.rows.length > 10 ? (
                  <div className="border-t border-rule-faint px-5 py-3">
                    <button type="button" className="aw-text-link" onClick={() => setMore(!more)}>
                      {more ? "Show top 10" : `Show 11 to ${s.rows.length}`}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </Card>
        </>
      ) : !busy && tab === "overview" ? (
        <div className="aw-callout max-w-2xl">
          Enter a keyword to see its volume, difficulty, intent, CPC, trend, variations, questions, topic clusters and Google&apos;s top 20. Searches are saved and shared for 30
          days, so looking up the same keyword again is free.
        </div>
      ) : null}
    </div>
  );
}
