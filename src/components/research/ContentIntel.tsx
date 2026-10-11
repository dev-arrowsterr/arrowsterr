"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import type { Chat } from "@/lib/chats";
import { addCalendarItems, listCalendar, type CalendarItem, type Site } from "@/lib/db";
import { pathOf, type TrafficData } from "@/lib/reports";
import type { PagePerf } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import { Sheet, type Col } from "../Sheet";
import { Ga4Connect, type SiteStatus } from "../TrafficPage";
import { Card, pct, Thinking } from "../ui";
import { citedPathsOf } from "./ContentResults";
import { flag, short } from "./KeywordOverview";
import { downloadCsv, post } from "./shared";

/** How a page is doing, from best to worst. */
type Tag = "Top performer" | "Striking distance" | "Steady" | "Underperforming" | "No traction";
const TAGS: Tag[] = ["Top performer", "Striking distance", "Steady", "Underperforming", "No traction"];
const TAG_HELP: Record<Tag, string> = {
  "Top performer": "Among your top fifth for visits, with a keyword in Google's top 3.",
  "Striking distance": "Its best keyword sits at #4 to #20 with real search volume. A content update can push it up.",
  Steady: "Gets visits and holds its spots. Keep it fresh.",
  Underperforming: "Ranks for keywords, but none in the top 10.",
  "No traction": "No visits and no keywords on Google.",
};
// One hue, darker for better pages, since the tags run in order.
const TAG_COLOR: Record<Tag, string> = { "Top performer": "#0943B0", "Striking distance": "#3B6AD0", Steady: "#7E9BDD", Underperforming: "#B9C8EC", "No traction": "#DDE4F5" };
const TAG_CLASS: Record<Tag, string> = { "Top performer": "aw-status--ranked", "Striking distance": "aw-status--warn", Steady: "aw-status--pending", Underperforming: "aw-status--missed", "No traction": "aw-status--pending" };

type Row = {
  path: string;
  url: string;
  seo: PagePerf | null;
  views: number | null; // from Google Analytics or the tracking script
  ai: number | null; // visits from AI assistants
  cited: number | null; // share of AI answers that cite it
  plan: CalendarItem | null;
  tag: Tag;
};

function tagOf(r: Omit<Row, "tag">, topCut: number): Tag {
  const visits = r.views ?? r.seo?.traffic ?? 0;
  const s = r.seo;
  if (visits > 0 && visits >= topCut && (s?.top3 ?? 0) > 0) return "Top performer";
  if (s?.topRank && s.topRank >= 4 && s.topRank <= 20 && (s.topVolume ?? 0) >= 50) return "Striking distance";
  if (visits > 0 && (!s || s.top10 > 0)) return "Steady";
  if (s && s.keywords > 0) return "Underperforming";
  return visits > 0 ? "Steady" : "No traction";
}

/** A horizontal bar chart with a value at the end of each bar and a tooltip on hover. */
function Bars({ rows, label, onPick }: { rows: { key: string; label: string; value: number; color: string; note?: string }[]; label: string; onPick?: (key: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} className={`relative grid grid-cols-[minmax(0,180px)_1fr] items-center gap-3 text-[13px] ${onPick ? "cursor-pointer" : ""}`} onClick={() => onPick?.(r.key)} onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)}>
          <span className="truncate text-ink" title={r.label}>
            {r.label}
          </span>
          <span className="flex items-center gap-2">
            <span className="h-3 rounded-r-[4px] transition-opacity" style={{ width: r.value ? `${Math.max(1.5, (r.value / max) * 100)}%` : 0, background: r.color, opacity: hover && hover !== r.key ? 0.45 : 1 }} />
            <span className="aw-num shrink-0 text-[12px] text-ink">{short(r.value)}</span>
          </span>
          {hover === r.key && r.note ? <span className="pointer-events-none absolute top-full left-[190px] z-20 mt-1 max-w-72 rounded-[6px] bg-[var(--aw-ink)] px-2.5 py-1.5 text-[12px] text-white shadow-aw">{r.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Content Intelligence: every page on the brand's site, how it performs and what to do next.
 * Google numbers come from SEO data. Visits come from Google Analytics 4 (or the tracking script) when connected.
 * AI citations come from the daily prompt checks.
 */
export function ContentIntel({
  sb,
  auth,
  site,
  canEdit,
  brandId,
  days,
  chats,
  onPlan,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  site: Site;
  canEdit: boolean;
  brandId: string;
  days: number;
  chats: Chat[];
  onPlan: () => void;
}) {
  const [pages, setPages] = useStash<PagePerf[] | null>(`pages:${site.id}`, null);
  const [traffic, setTraffic] = useStash<Record<number, TrafficData | null>>(`intel:${brandId}:traffic`, {});
  const [status, setStatus] = useStash<SiteStatus | null>(`traffic:${brandId}:status`, null);
  const [items, setItems] = useState<CalendarItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tagFilter, setTagFilter] = useState<Tag | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const country = site.profile.country ?? "United States";

  const call = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` },
        body: JSON.stringify({ ...body, workspaceId: auth.workspaceId, brandId }),
      });
      const data = await res.json().catch(() => ({ error: `The server returned ${res.status}.` }));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      return data;
    },
    [auth, brandId],
  );
  const checkStatus = useCallback(() => call("/api/site", { action: "status" }).then(setStatus).catch(() => {}), [call, setStatus]);

  // Google numbers for every page. Editors load them once a visit; they are cached for a week.
  useEffect(() => {
    if (pages || !canEdit) return;
    let live = true;
    // Loading the pages once per visit is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(true);
    post<{ pages: PagePerf[] }>(auth, "/api/research/pages", { siteId: site.id })
      .then((r) => live && setPages(r.pages))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [auth, site.id, canEdit, pages, setPages]);

  // Visits per page, and whether Google Analytics is linked.
  useEffect(() => {
    if (!status) checkStatus();
    if (days in traffic) return;
    let live = true;
    call("/api/traffic", { days })
      .then((t) => live && setTraffic((x) => ({ ...x, [days]: t as TrafficData })))
      .catch(() => live && setTraffic((x) => ({ ...x, [days]: null })));
    return () => {
      live = false;
    };
  }, [call, days, traffic, setTraffic, status, checkStatus]);

  useEffect(() => {
    listCalendar(sb, site.id)
      .then(setItems)
      .catch(() => setItems([]));
  }, [sb, site.id]);

  const t = traffic[days] ?? null;
  const cited = chats.length ? citedPathsOf(chats, site.domain) : null;
  const onPlanMap = new Map<string, CalendarItem>();
  for (const i of items ?? []) for (const u of [i.url, i.current_url]) if (u) onPlanMap.set(pathOf(u), i);

  // One row per page: Google's list first, then pages that only show up in analytics.
  const base = new Map<string, Omit<Row, "tag">>();
  for (const p of pages ?? []) base.set(pathOf(p.url), { path: pathOf(p.url), url: p.url, seo: p, views: null, ai: null, cited: null, plan: null });
  for (const r of t?.breakdowns.pages ?? []) {
    const path = pathOf(r.x);
    if (!base.has(path)) base.set(path, { path, url: `https://${site.domain}${path === "/" ? "" : path}`, seo: null, views: null, ai: null, cited: null, plan: null });
  }
  for (const r of base.values()) {
    r.views = t ? (t.breakdowns.pages ?? []).filter((x) => pathOf(x.x) === r.path).reduce((n, x) => n + x.y, 0) : null;
    r.ai = t ? t.pages.filter((x) => pathOf(x.path) === r.path).reduce((n, x) => n + x.visits, 0) : null;
    r.cited = cited ? (cited.get(r.path) ?? 0) : null;
    r.plan = onPlanMap.get(r.path) ?? null;
  }
  const list = [...base.values()];
  const visitsOf = (r: Omit<Row, "tag">) => r.views ?? r.seo?.traffic ?? 0;
  const sortedVisits = list.map(visitsOf).sort((a, b) => b - a);
  const topCut = sortedVisits[Math.max(0, Math.ceil(sortedVisits.length / 5) - 1)] ?? 0;
  const rows: Row[] = list.map((r) => ({ ...r, tag: tagOf(r, topCut) }));
  const shown = tagFilter ? rows.filter((r) => r.tag === tagFilter) : rows;

  const linked = Boolean(t);
  const fromGa4 = status?.source === "ga4" || Boolean(status?.ga4?.property);
  const visitsLabel = linked ? (fromGa4 ? "Views (GA4)" : "Views") : "Est. visits / mo";
  const totalVisits = rows.reduce((n, r) => n + visitsOf(r), 0);
  const topPages = [...rows].sort((a, b) => visitsOf(b) - visitsOf(a)).slice(0, 10);
  const kwTotals = (pages ?? []).reduce((a, p) => ({ top3: a.top3 + p.top3, top10: a.top10 + p.top10, all: a.all + p.keywords }), { top3: 0, top10: 0, all: 0 });

  async function planUpdate(r: Row) {
    if (!r.seo?.topKeyword) return;
    setError("");
    try {
      await addCalendarItems(sb, auth.workspaceId, [
        {
          site_id: site.id,
          keyword: r.seo.topKeyword,
          secondary: [],
          stage: null,
          theme: "Content updates",
          volume: r.seo.topVolume,
          difficulty: null,
          intent: null,
          cpc: null,
          source: "content intelligence",
          due_date: null,
          notes: `${r.tag}: ranks #${r.seo.topRank ?? "–"} for "${r.seo.topKeyword}". Update this page.`,
          action: "update",
          current_url: r.url,
          current_rank: r.seo.topRank,
        },
      ]);
      setAdded((s) => new Set([...s, r.path]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const cols: Col<Row>[] = [
    {
      id: "page",
      label: "Page",
      type: "text",
      width: 280,
      value: (r) => r.path,
      cell: (r) => (
        <a href={r.url} target="_blank" rel="noopener noreferrer" className="block max-w-80 truncate" title={r.url}>
          {r.path}
        </a>
      ),
    },
    { id: "tag", label: "Performance", type: "list", options: TAGS, value: (r) => r.tag, width: 150, cell: (r) => <span className={`aw-status ${TAG_CLASS[r.tag]}`} title={TAG_HELP[r.tag]}>{r.tag}</span> },
    ...(linked
      ? ([
          { id: "views", label: visitsLabel, type: "number", value: (r) => r.views },
          { id: "ai", label: "From AI", type: "number", value: (r) => r.ai },
        ] as Col<Row>[])
      : []),
    { id: "cited", label: "Cited by AI", type: "number", value: (r) => (r.cited === null ? null : Math.round(r.cited)), cell: (r) => (r.cited === null ? "–" : r.cited ? pct(r.cited) : <span className="text-muted">–</span>) },
    { id: "est", label: "Est. Google visits", type: "number", value: (r) => r.seo?.traffic ?? null, cell: (r) => short(r.seo?.traffic ?? null) },
    { id: "kw", label: "Keywords", type: "number", value: (r) => r.seo?.keywords ?? null },
    { id: "top10", label: "In top 10", type: "number", value: (r) => r.seo?.top10 ?? null },
    { id: "topkw", label: "Best keyword", type: "text", width: 220, value: (r) => r.seo?.topKeyword ?? null },
    { id: "pos", label: "Position", type: "number", value: (r) => r.seo?.topRank ?? null, cell: (r) => (r.seo?.topRank ? <span className="aw-rank">#{r.seo.topRank}</span> : <span className="text-muted">–</span>) },
    { id: "vol", label: "Its volume", type: "number", value: (r) => r.seo?.topVolume ?? null, cell: (r) => short(r.seo?.topVolume ?? null) },
    {
      id: "plan",
      label: "Content Plan",
      type: "list",
      options: ["On the plan", "Not on it"],
      value: (r) => (r.plan || added.has(r.path) ? "On the plan" : "Not on it"),
      width: 160,
      cell: (r) =>
        r.plan || added.has(r.path) ? (
          <span className="aw-status aw-status--ranked">{r.plan?.action === "update" || added.has(r.path) ? "Update planned" : "On the plan"}</span>
        ) : canEdit && r.seo?.topKeyword && (r.tag === "Striking distance" || r.tag === "Underperforming") ? (
          <button type="button" className="aw-chip aw-chip--btn whitespace-nowrap" onClick={() => planUpdate(r)}>
            + Plan an update
          </button>
        ) : (
          <span className="text-muted">–</span>
        ),
    },
  ];

  if (!pages && busy) return <Thinking text={`Reading every page of ${site.domain} on Google...`} />;

  return (
    <div className="flex flex-col gap-5">
      {error ? <p className="aw-error">{error}</p> : null}
      <p className="max-w-3xl text-[15px] text-ink">
        Every page on {site.domain}, tagged by how it performs. Google numbers come from SEO data for {flag(country)} {country}.{" "}
        {linked ? (fromGa4 ? `Views come from Google Analytics 4, last ${days} days.` : `Views come from your tracking script, last ${days} days.`) : "Link Google Analytics 4 to add real views and visits from AI."}
      </p>

      {!fromGa4 && status && canEdit ? <Ga4Connect status={status} canEdit={canEdit} call={call} onDone={() => checkStatus().then(() => setTraffic({}))} /> : null}

      {!pages && !canEdit ? <div className="aw-callout max-w-xl">Ask an editor to open Content Intelligence once to load the pages.</div> : null}

      {rows.length ? (
        <>
          <div className="aw-stats aw-stats--tight" style={{ ["--cols" as string]: 5 }}>
            {[
              { lab: "Pages", v: short(rows.length) },
              { lab: linked ? `${visitsLabel}, ${days} days` : "Est. visits / mo", v: short(totalVisits) },
              { lab: "Top performers", v: short(rows.filter((r) => r.tag === "Top performer").length) },
              { lab: "Striking distance", v: short(rows.filter((r) => r.tag === "Striking distance").length) },
              { lab: "Cited by AI", v: cited ? short(rows.filter((r) => (r.cited ?? 0) > 0).length) : "–" },
            ].map((s) => (
              <div key={s.lab} className="aw-stat">
                <div className="aw-stat__lab">{s.lab}</div>
                <span className="aw-stat__num">{s.v}</span>
              </div>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card title="Pages by performance">
              <div className="flex flex-col gap-3 p-5">
                <Bars
                  label="Pages by performance"
                  onPick={(k) => setTagFilter(k as Tag)}
                  rows={TAGS.map((tg) => ({ key: tg, label: tg, value: rows.filter((r) => r.tag === tg).length, color: TAG_COLOR[tg], note: TAG_HELP[tg] }))}
                />
                <p className="aw-small">Click a bar to see those pages in the table below.</p>
              </div>
            </Card>
            <Card title={`Top 10 pages by ${linked ? "views" : "est. visits"}`}>
              <div className="p-5">
                <Bars label="Top pages" rows={topPages.map((r) => ({ key: r.path, label: r.path, value: visitsOf(r), color: "#0943B0", note: `${r.path} · ${r.tag}${r.seo?.topKeyword ? ` · best keyword "${r.seo.topKeyword}" at #${r.seo.topRank ?? "–"}` : ""}` }))} />
              </div>
            </Card>
            <Card title="Where your keywords rank">
              <div className="flex flex-col gap-4 p-5">
                {kwTotals.all ? (
                  <>
                    <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label={`Top 3: ${kwTotals.top3}, #4 to #10: ${kwTotals.top10 - kwTotals.top3}, below #10: ${kwTotals.all - kwTotals.top10}`}>
                      {[
                        [kwTotals.top3, "#0943B0", "Top 3"],
                        [kwTotals.top10 - kwTotals.top3, "#7E9BDD", "#4 to #10"],
                        [kwTotals.all - kwTotals.top10, "#DDE4F5", "Below #10"],
                      ].map(([v, c, l]) => (Number(v) > 0 ? <span key={String(l)} title={`${l}: ${short(Number(v))}`} style={{ flex: Number(v), background: String(c) }} /> : null))}
                    </div>
                    <ul className="flex flex-col gap-1.5 text-[13px] text-ink">
                      {[
                        ["Top 3", kwTotals.top3, "#0943B0"],
                        ["#4 to #10", kwTotals.top10 - kwTotals.top3, "#7E9BDD"],
                        ["Below #10", kwTotals.all - kwTotals.top10, "#DDE4F5"],
                      ].map(([l, v, c]) => (
                        <li key={String(l)} className="flex items-center gap-2">
                          <i className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: String(c) }} />
                          {l}
                          <span className="aw-num ml-auto">{short(Number(v))}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="aw-small">No keywords on Google yet.</p>
                )}
              </div>
            </Card>
          </div>

          <Card
            title={`${shown.length} pages`}
            action={
              <span className="flex flex-wrap items-center gap-2">
                <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onPlan}>
                  Open Content Plan
                </button>
                <button
                  type="button"
                  className="aw-btn aw-btn--secondary aw-btn--sm"
                  onClick={() =>
                    downloadCsv(
                      `content-intelligence-${site.domain}.csv`,
                      ["page", "performance", visitsLabel, "from ai", "cited by ai %", "est google visits", "keywords", "in top 10", "best keyword", "position", "volume"],
                      rows.map((r) => [r.url, r.tag, r.views, r.ai, r.cited === null ? null : Math.round(r.cited), r.seo?.traffic ?? null, r.seo?.keywords ?? null, r.seo?.top10 ?? null, r.seo?.topKeyword ?? null, r.seo?.topRank ?? null, r.seo?.topVolume ?? null]),
                    )
                  }
                >
                  Export CSV
                </button>
              </span>
            }
          >
            <div className="flex flex-wrap gap-1.5 px-4 pt-3">
              {[null, ...TAGS].map((tg) => (
                <button key={tg ?? "all"} type="button" className={`aw-chip aw-chip--btn ${tagFilter === tg ? "is-on" : ""}`} onClick={() => setTagFilter(tg)} title={tg ? TAG_HELP[tg] : undefined}>
                  {tg ?? "All"} · {tg ? rows.filter((r) => r.tag === tg).length : rows.length}
                </button>
              ))}
            </div>
            <Sheet<Row> id={`intel:${site.id}`} label="Content Intelligence" rows={shown} cols={cols} rowKey={(r) => r.path} sort={{ key: linked ? "views" : "est", desc: true }} height="70vh" />
          </Card>
        </>
      ) : pages ? (
        <div className="aw-callout max-w-xl">Google has no pages for {site.domain} in {country} yet.</div>
      ) : null}
    </div>
  );
}
