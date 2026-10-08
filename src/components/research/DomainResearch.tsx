"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";
import { addCalendarItems, type Site } from "@/lib/db";
import { MARKETS, stageFromIntent, type DomainReport, type Keyword } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import { BrandLogo } from "../BrandLogo";
import { Sheet } from "../Sheet";
import { SampleLine, SampleRows, SampleStats, ToolIntro } from "../ToolIntro";
import { Card, favicon, Seg, Thinking } from "../ui";
import { flag, KdDot, short } from "./KeywordOverview";
import { downloadCsv, FIELD, post } from "./shared";

/** Any website on Google: how big it is, what it ranks for, its best pages and its competitors. */
export function DomainResearch({ sb, auth, site, canEdit }: { sb: SupabaseClient; auth: RunAuth; site: Site; canEdit: boolean }) {
  const k = (name: string) => `dom:${site.id}:${name}`;
  const [domain, setDomain] = useStash(k("q"), site.domain);
  const [country, setCountry] = useStash(k("country"), site.profile.country && MARKETS[site.profile.country] ? site.profile.country : "United States");
  const [report, setReport] = useStash<DomainReport | null>(k("report"), null);
  const [tab, setTab] = useStash<"keywords" | "pages" | "competitors">(k("tab"), "keywords");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadMore() {
    if (!report) return;
    setBusy("Loading up to 500 keywords...");
    try {
      setReport(await post<DomainReport>(auth, "/api/research/domain", { domain: report.domain, country: report.country, more: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function analyze(d: string) {
    if (!d.trim()) return;
    setDomain(d);
    setBusy(`Reading ${d} on Google...`);
    setError("");
    setNotice("");
    setPicked(new Set());
    try {
      setReport(await post<DomainReport>(auth, "/api/research/domain", { domain: d, country }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const own = report?.domain === site.domain.replace(/^www\./, "");
  async function addToCalendar(rows: Keyword[]) {
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
          source: own ? "domain research" : `competitor: ${report?.domain}`,
          // Your own ranking page gets improved. A competitor's keyword becomes a new page.
          ...(own ? { action: "update" as const, current_url: r.url ?? null, current_rank: r.rank ?? null } : {}),
        })),
      );
      setNotice(`${n} added to the content calendar.${n < rows.length ? ` ${rows.length - n} were already on it.` : ""}`);
      setPicked(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const o = report?.overview;
  const path = (u: string) => {
    try {
      return new URL(u).pathname || "/";
    } catch {
      return u;
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <form
        className="aw-frame flex flex-wrap items-center gap-3 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          analyze(domain);
        }}
      >
        <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Enter a domain, like competitor.com" aria-label="Domain" className="aw-input min-w-56 flex-1" />
        <select aria-label="Country" value={country} onChange={(e) => setCountry(e.target.value)} className={FIELD}>
          {Object.keys(MARKETS).map((c) => (
            <option key={c} value={c}>
              {flag(c)} {c}
            </option>
          ))}
        </select>
        <button type="submit" className="aw-btn aw-btn--accent" disabled={!canEdit || Boolean(busy) || !domain.trim()}>
          Analyze
        </button>
      </form>

      {error ? <p className="aw-error">{error}</p> : null}
      {notice ? <div className="aw-callout">{notice}</div> : null}
      {busy ? <Thinking text={busy} /> : null}

      {!busy && report ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-center gap-3">
              <BrandLogo src={favicon(report.domain)} name={report.domain} size={28} />
              <div className="flex flex-col">
                <h2 className="aw-h3">
                  {report.domain} {own ? <span className="aw-badge align-middle">You</span> : null}
                </h2>
                <span className="text-[13px] text-muted">
                  {flag(report.country)} {report.country} · {report.cached ? "Free, saved results" : `Cost $${report.cost.toFixed(3)}`}
                </span>
              </div>
            </div>
          </div>

          {o ? (
            <div className="aw-stats aw-stats--tight" style={{ ["--cols" as string]: 5 }}>
              {[
                { lab: "Keywords on Google", v: short(o.keywords) },
                { lab: "Est. visits / month", v: short(o.traffic) },
                { lab: "In top 3", v: short(o.top3) },
                { lab: "In top 10", v: short(o.top10) },
                {
                  lab: "New · lost this month",
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
            <div className="aw-callout">Google has little data for {report.domain} in {report.country}. Try another country, or a bigger site.</div>
          )}

          <Card
            title={
              <Seg
                label="Domain views"
                value={tab}
                onChange={(v) => {
                  setTab(v);
                  setPicked(new Set());
                }}
                options={[
                  { id: "keywords", label: `Keywords ${report.keywords.length}` },
                  { id: "pages", label: `Pages ${report.pages.length}` },
                  { id: "competitors", label: `Competitors ${report.competitors.length}` },
                ]}
              />
            }
            action={
              <button
                type="button"
                className="aw-btn aw-btn--secondary aw-btn--sm"
                onClick={() =>
                  tab === "keywords"
                    ? downloadCsv(`${report.domain}-keywords.csv`, ["keyword", "position", "volume", "kd", "traffic", "url"], report.keywords.map((r) => [r.keyword, r.rank, r.volume, r.kd, r.etv, r.url]))
                    : tab === "pages"
                      ? downloadCsv(`${report.domain}-pages.csv`, ["url", "keywords", "traffic", "top keyword"], report.pages.map((p) => [p.url, p.keywords, p.traffic, p.top]))
                      : downloadCsv(`${report.domain}-competitors.csv`, ["domain", "shared keywords", "keywords", "traffic"], report.competitors.map((c) => [c.domain, c.shared, c.keywords, c.traffic]))
                }
              >
                Export CSV
              </button>
            }
          >
            {tab === "keywords" ? (
              <>
                {picked.size && canEdit ? (
                  <div className="flex flex-wrap items-center gap-3 border-b border-rule-faint bg-brand-pale px-5 py-2.5">
                    <span className="text-[13px] font-medium text-ink">{picked.size} selected</span>
                    <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={() => addToCalendar(report.keywords.filter((r) => picked.has(r.keyword)))}>
                      {own ? "Add to calendar as page updates" : "Add to calendar"}
                    </button>
                    <button type="button" className="aw-text-link text-[13px]" onClick={() => setPicked(new Set())}>
                      Clear
                    </button>
                  </div>
                ) : null}
                <Sheet<Keyword>
                  key="kw"
                  label="Keywords"
                  rows={report.keywords}
                  rowKey={(r) => r.keyword}
                  sort={{ key: "traffic", desc: true }}
                  selected={canEdit ? picked : undefined}
                  onSelect={canEdit ? setPicked : undefined}
                  height="60vh"
                  cols={[
                    { id: "keyword", label: "Keyword", type: "text", value: (r) => r.keyword, width: 220 },
                    { id: "rank", label: "Position", type: "number", value: (r) => r.rank },
                    { id: "volume", label: "Volume", type: "number", value: (r) => r.volume },
                    { id: "traffic", label: "Visits / mo", type: "number", value: (r) => (r.etv === null || r.etv === undefined ? null : Math.round(r.etv)) },
                    { id: "kd", label: "KD %", type: "number", value: (r) => r.kd, cell: (r) => <KdDot kd={r.kd} /> },
                    { id: "intent", label: "Intent", type: "list", value: (r) => r.intent },
                    {
                      id: "url",
                      label: "Ranking page",
                      type: "text",
                      value: (r) => (r.url ? path(r.url) : null),
                      cell: (r) =>
                        r.url ? (
                          <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className="block max-w-72 truncate" title={r.url}>
                            {path(r.url)}
                          </a>
                        ) : (
                          <span className="text-muted">–</span>
                        ),
                    },
                  ]}
                />
              </>
            ) : tab === "pages" ? (
              <Sheet
                key="pages"
                label="Pages"
                rows={report.pages}
                rowKey={(p) => p.url}
                sort={{ key: "traffic", desc: true }}
                height="60vh"
                cols={[
                  {
                    id: "url",
                    label: "Page",
                    type: "text",
                    value: (p) => path(p.url),
                    width: 280,
                    cell: (p) => (
                      <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="block max-w-96 truncate" title={p.url}>
                        {path(p.url)}
                      </a>
                    ),
                  },
                  { id: "traffic", label: "Visits / mo", type: "number", value: (p) => p.traffic },
                  { id: "keywords", label: "Keywords", type: "number", value: (p) => p.keywords },
                  { id: "top", label: "Top keyword", type: "text", value: (p) => p.top },
                ]}
              />
            ) : (
              <Sheet
                key="comp"
                label="Competitors"
                rows={report.competitors}
                rowKey={(c) => c.domain}
                sort={{ key: "shared", desc: true }}
                onOpen={(c) => analyze(c.domain)}
                cols={[
                  {
                    id: "domain",
                    label: "Competitor (click to analyze)",
                    type: "text",
                    value: (c) => c.domain,
                    cell: (c) => (
                      <span className="flex items-center gap-2">
                        <BrandLogo src={favicon(c.domain)} name={c.domain} size={16} />
                        {c.domain}
                      </span>
                    ),
                  },
                  { id: "shared", label: "Shared keywords", type: "number", value: (c) => c.shared },
                  { id: "keywords", label: "All keywords", type: "number", value: (c) => c.keywords },
                  { id: "traffic", label: "Visits / mo", type: "number", value: (c) => c.traffic },
                ]}
              />
            )}
          </Card>
          <p className="aw-small">
            Shows the top {report.keywords.length} keywords by search volume. Visits are estimates from Google rankings and search volume.{" "}
            {!report.more && report.keywords.length >= 100 && canEdit ? (
              <button type="button" className="aw-text-link" onClick={loadMore}>
                Load up to 500 (about 4 cents)
              </button>
            ) : null}
          </p>
        </>
      ) : null}

      {!busy && !report ? (
        <ToolIntro
          title="See how any website performs on Google"
          lead="Enter a domain to see how many keywords it ranks for, how much traffic Google sends it, its best pages and its closest competitors. Start with your own site, then size up the competition."
          examples={[site.domain, "hubspot.com", "notion.so"]}
          onExample={canEdit ? (x) => analyze(x) : undefined}
          features={[
            { title: "Organic overview", text: "Total keywords on Google, estimated monthly visits, and how many rank in the top 3 and top 10.", visual: <SampleStats items={[["Keywords", "1.2K"], ["Visits", "3.8K"], ["Top 10", "160"]]} /> },
            { title: "Top keywords", text: "Every keyword the site ranks for, with its position, volume and the visits it brings.", visual: <SampleRows rows={[["seo agency", 900, "#2"], ["geo services", 640, "#4"], ["ai seo", 420, "#7"]]} /> },
            { title: "Best pages", text: "The pages that pull the most traffic, and the keyword that drives each one.", visual: <SampleRows rows={[["/services/seo", 1200, "1.2K"], ["/blog/geo-guide", 700, "700"], ["/pricing", 300, "300"]]} /> },
            { title: "Competitors", text: "Sites that rank for the same keywords. Click one to analyze it next.", visual: <SampleRows rows={[["rival.com", 120], ["agency.io", 90], ["seofirm.co", 60]]} /> },
            { title: "Wins and losses", text: "Keywords the site gained and lost this month, so you can spot momentum fast.", visual: <SampleLine /> },
            { title: "Straight to your plan", text: "Pick keywords and add them to your calendar. Your own pages go in as updates, a competitor's as new pages." },
          ]}
          steps={["Type a domain, like competitor.com.", "Pick a country and click Analyze.", "Review keywords, pages and competitors, then click a competitor to compare."]}
          faqs={[
            { q: "Where does the data come from?", a: "From Google search results and keyword data, refreshed regularly. Visits are estimates based on rankings and search volume." },
            { q: "Can I see more than 100 keywords?", a: "Yes. Click Load up to 500 under the table." },
          ]}
        />
      ) : null}
    </div>
  );
}
