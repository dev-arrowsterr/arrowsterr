"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import type { Chat } from "@/lib/chats";
import { aiCites, REFRESH_DAYS, SECTIONS, type Research, type ResearchRow, type SectionId } from "@/lib/industry";
import type { NewTarget, TargetKind } from "@/lib/outreach";
import type { RunAuth } from "@/lib/runner";
import { BrandLogo } from "./BrandLogo";
import { AddToList } from "./outreach/AddToList";
import { post } from "./research/shared";
import { SampleRows, ToolIntro } from "./ToolIntro";
import { favicon, sortRows, SortTh, Thinking, Tip, useSort } from "./ui";

/** The outreach target each section adds. Subreddits are joined in the threads, not emailed. */
const KIND_OF: Record<SectionId, TargetKind | null> = { websites: "website", press: "press", reddit: null, social: "social", youtube: "youtube", podcasts: "podcast" };
const COLUMN: Record<SectionId, string> = { websites: "Website", press: "Publication", reddit: "Subreddit", social: "Account", youtube: "Channel", podcasts: "Podcast" };
const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const hostOf = (url: string | null) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
};

/**
 * Audience research (Competitive Analysis › Audience): the websites, YouTube channels, podcasts, press, social accounts and subreddits
 * the brand's audience uses (SparkToro), with how often AI cites each one.
 */
export function IndustryResearch({ sb, brandId, domain, chats, auth }: { sb: SupabaseClient; brandId: string; domain: string; chats: Chat[]; auth: RunAuth | null }) {
  const [data, setData] = useState<Research | null | undefined>(undefined);
  const [tab, setTab] = useState<SectionId>("websites");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState(0);
  const [sort, setSort] = useSort("score");
  const [query, setQuery] = useState("");
  const [citedOnly, setCitedOnly] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<NewTarget[] | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const { data: row, error: err } = await sb.from("industry_research").select("*").eq("brand_id", brandId).maybeSingle();
    if (err) {
      setError(/industry_research/.test(err.message) ? "Run supabase/039_industry_research.sql in Supabase." : err.message);
      setData(null);
      return;
    }
    setData((row as Research | null) ?? null);
    setLoadedAt(Date.now());
  }, [sb, brandId]);

  useEffect(() => {
    // Loading on open is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // While SparkToro builds the report, check back every 15 seconds.
  useEffect(() => {
    if (data?.status !== "running") return;
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [data?.status, load]);

  const start = async () => {
    if (!auth) return;
    setBusy(true);
    setError("");
    try {
      await post(auth, "/api/industry", { brandId });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const nextRefresh = data?.updated_at ? Date.parse(data.updated_at) + REFRESH_DAYS * 864e5 : 0;
  const canRefresh = Boolean(auth) && data?.status !== "running" && (data?.status !== "done" || nextRefresh <= loadedAt);
  const rows = data?.sections?.[tab] ?? [];
  const cites = rows.map((r) => aiCites(tab, r, chats));
  const showCites = cites.some((c) => c !== null);
  const kind = KIND_OF[tab];
  const canAdd = Boolean(auth && kind);
  const toTarget = (r: ResearchRow): NewTarget => ({ kind: kind!, name: r.name, url: r.url });
  const q = query.trim().toLowerCase();
  const listed = sortRows(
    rows.map((r, i) => ({ ...r, cites: cites[i] })).filter((r) => (!q || `${r.name} ${r.url ?? ""}`.toLowerCase().includes(q)) && (!citedOnly || !showCites || (r.cites ?? 0) > 0)),
    sort,
    { name: (r) => r.name, score: (r) => r.score, reach: (r) => r.reach, cites: (r) => r.cites },
  );
  const showScore = rows.some((r) => r.score !== null);
  const showReach = rows.some((r) => r.reach !== null);

  const hasRows = Boolean(data && Object.keys(data.sections ?? {}).length);
  const runButton = auth ? (
    <button type="button" className="aw-btn aw-btn--accent" onClick={start} disabled={busy}>
      {busy ? "Starting…" : "Research my audience"}
    </button>
  ) : null;

  if (data === undefined) return <Thinking text="Loading your audience research" />;
  if (!data)
    return (
      <div className="flex flex-col gap-6">
        {error ? <p className="aw-error max-w-2xl">{error}</p> : null}
        <ToolIntro
          title={`Where people who visit ${domain} spend their time`}
          lead="The websites, YouTube channels, podcasts, press, social accounts and subreddits your audience uses, and which of them AI cites. Add the best ones to an outreach list."
          action={runButton ?? <span className="aw-small">An editor can start this research.</span>}
          features={[
            {
              title: "Websites and press",
              text: "The sites and publications your buyers read, with how often ChatGPT, Gemini and Google AI cite each one.",
              visual: (
                <SampleRows
                  rows={[
                    ["techcrunch.com", 42, "AI cites"],
                    ["theverge.com", 31],
                    ["wired.com", 18],
                  ]}
                />
              ),
            },
            {
              title: "Reddit",
              text: "The subreddits your audience visits. Threads there feed AI answers.",
              visual: (
                <SampleRows
                  rows={[
                    ["r/SaaS", 38],
                    ["r/marketing", 24],
                    ["r/startups", 15],
                  ]}
                />
              ),
            },
            { title: "Social accounts and YouTube", text: "The people and channels your audience follows, for partnerships and guest spots." },
            { title: "Podcasts", text: "The shows your audience listens to, for guest pitches." },
          ]}
        />
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      <section className="aw-frame">
        <div className="aw-frame__head flex-wrap justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="aw-label">Audience</span>
            <span className="text-[14px] text-ink">
              {data.audience}
              {data.updated_at ? <span className="text-muted"> · updated {date(data.updated_at)}</span> : null}
            </span>
          </div>
          {auth ? (
            <button
              type="button"
              className="aw-btn aw-btn--secondary aw-btn--sm"
              onClick={start}
              disabled={busy || !canRefresh}
              title={data.status === "done" && !canRefresh ? `Refreshes once every ${REFRESH_DAYS} days` : undefined}
            >
              {busy ? "Starting…" : "Refresh"}
            </button>
          ) : null}
        </div>

        {error ? <p className="aw-error mx-5 mt-4">{error}</p> : null}

        {data.status === "running" && !hasRows ? (
          <div className="p-5">
            <Thinking text="Researching your audience. This takes a few minutes." />
          </div>
        ) : data.status === "failed" && !hasRows ? (
          <p className="aw-error mx-5 my-4">{data.error ?? "The audience research didn't finish."}</p>
        ) : (
          <>
            <div className="flex flex-wrap border-b border-rule" role="tablist" aria-label="Audience section">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === s.id}
                  onClick={() => {
                    setTab(s.id);
                    setPicked(new Set());
                  }}
                  className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-[14px] ${tab === s.id ? "border-ink font-medium text-ink" : "border-transparent text-body hover:text-ink"}`}
                >
                  {s.label}
                  <span className="aw-num text-[12px] text-muted">{data.sections?.[s.id]?.length ?? (data.status === "running" ? "…" : 0)}</span>
                </button>
              ))}
            </div>
            {rows.length ? (
              <div className="flex flex-wrap items-center gap-3 border-b border-rule-faint px-5 py-3">
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${SECTIONS.find((s) => s.id === tab)!.label.toLowerCase()}`} aria-label="Search this section" className="aw-input max-w-sm min-w-40 flex-1 py-1.5! text-[14px]!" />
                {showCites ? (
                  <label className="flex items-center gap-2 text-[14px] text-ink">
                    <input type="checkbox" checked={citedOnly} onChange={(e) => setCitedOnly(e.target.checked)} className="h-4 w-4 accent-[var(--aw-brand)]" />
                    AI cites only
                  </label>
                ) : null}
                <span className="aw-small ml-auto">
                  {listed.length} of {rows.length}
                </span>
              </div>
            ) : null}
            {notice ? <p className="aw-small border-b border-rule-faint bg-brand-pale px-5 py-2.5 text-ink!">{notice}</p> : null}
            {canAdd && picked.size ? (
              <div className="flex flex-wrap items-center gap-3 border-b border-rule-faint bg-brand-pale px-5 py-2.5">
                <span className="text-[14px] font-medium text-ink">{picked.size} selected</span>
                <button type="button" className="aw-btn aw-btn--accent aw-btn--sm" onClick={() => setAdding(rows.filter((r) => picked.has(r.name)).map(toTarget))}>
                  Add to Outreach List
                </button>
                <button type="button" className="aw-text-link text-[14px]" onClick={() => setPicked(new Set())}>
                  Clear
                </button>
              </div>
            ) : null}
            {listed.length ? (
              <div className="overflow-x-auto">
                <table className="aw-table">
                  <thead>
                    <tr>
                      {canAdd ? (
                        <th className="w-10">
                          <input
                            type="checkbox"
                            aria-label="Select every row shown"
                            checked={listed.length > 0 && listed.every((r) => picked.has(r.name))}
                            onChange={(e) => setPicked(e.target.checked ? new Set([...picked, ...listed.map((r) => r.name)]) : new Set([...picked].filter((n) => !listed.some((r) => r.name === n))))}
                            className="h-4 w-4 accent-[var(--aw-brand)]"
                          />
                        </th>
                      ) : null}
                      <th className="w-10">#</th>
                      <SortTh id="name" sort={sort} onSort={setSort} text>
                        {COLUMN[tab]}
                      </SortTh>
                      {showScore ? (
                        <SortTh id="score" sort={sort} onSort={setSort} className="w-36">
                          Audience
                          <Tip text="How strongly this audience uses it, from SparkToro." />
                        </SortTh>
                      ) : null}
                      {showReach ? (
                        <SortTh id="reach" sort={sort} onSort={setSort} className="w-32">
                          Reach
                        </SortTh>
                      ) : null}
                      {showCites ? (
                        <SortTh id="cites" sort={sort} onSort={setSort} className="w-36">
                          AI cites
                          <Tip text="AI answers in this period that cite it." />
                        </SortTh>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {listed.map((r, i) => {
                      const host = hostOf(r.url);
                      const c = r.cites;
                      return (
                        <tr key={r.name} className={picked.has(r.name) ? "bg-brand-pale" : ""}>
                          {canAdd ? (
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Select ${r.name}`}
                                checked={picked.has(r.name)}
                                onChange={() => setPicked(picked.has(r.name) ? new Set([...picked].filter((n) => n !== r.name)) : new Set([...picked, r.name]))}
                                className="h-4 w-4 accent-[var(--aw-brand)]"
                              />
                            </td>
                          ) : null}
                          <td className="aw-num text-muted">{i + 1}</td>
                          <td>
                            <span className="flex min-w-0 items-center gap-2.5">
                              {host ? <BrandLogo src={favicon(host)} name={r.name} size={18} /> : null}
                              {r.url ? (
                                <a href={r.url} target="_blank" rel="noopener noreferrer" className="aw-text-link truncate font-medium">
                                  {r.name}
                                </a>
                              ) : (
                                <span className="truncate font-medium text-ink">{r.name}</span>
                              )}
                            </span>
                          </td>
                          {showScore ? <td className="aw-num">{r.score ?? "–"}</td> : null}
                          {showReach ? <td className="aw-num">{r.reach !== null ? compact(r.reach) : "–"}</td> : null}
                          {showCites ? (
                            <td className="aw-num">
                              {c ? (
                                <span className="flex items-center gap-2">
                                  {c}
                                  <span className="aw-status aw-status--ranked">AI cites</span>
                                </span>
                              ) : (
                                "–"
                              )}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="aw-small px-5 py-4">{rows.length ? "Nothing matches these filters." : data.status === "running" ? "Still loading this section." : "SparkToro found nothing for this section."}</p>
            )}
          </>
        )}
      </section>
      {adding && auth ? (
        <AddToList
          sb={sb}
          auth={auth}
          brandId={brandId}
          items={adding}
          from="industry"
          onClose={() => setAdding(null)}
          onDone={(message) => {
            setAdding(null);
            setPicked(new Set());
            setNotice(message);
          }}
        />
      ) : null}
    </div>
  );
}
