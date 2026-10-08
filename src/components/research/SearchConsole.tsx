"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { addCalendarItems, type NewCalendarItem, type Site } from "@/lib/db";
import { opportunities, type GscPage, type GscPair, type GscQuery, type GscReport, type Opportunity } from "@/lib/opportunities";
import type { RunAuth } from "@/lib/runner";
import { Sheet, type Col } from "../Sheet";
import { TrendChart } from "../TrendChart";
import { Card, Delta, Seg, Thinking } from "../ui";
import { downloadCsv, post } from "./shared";

type Status = { configured: boolean; connected: boolean; property: string | null; email: string | null };
type Tab = "opportunities" | "queries" | "pages" | "pairs";
const pctText = (n: number) => `${(n * 100).toFixed(1)}%`;
const pos = (n: number) => n.toFixed(1);
const short = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "");

/** Google Search Console for one website: real clicks, impressions and positions, and what to fix first. */
export function SearchConsole({ sb, auth, site, canEdit }: { sb: SupabaseClient; auth: RunAuth; site: Site; canEdit: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [report, setReport] = useState<GscReport | null>(null);
  const [props, setProps] = useState<{ siteUrl: string; permissionLevel: string }[] | null>(null);
  const [days, setDays] = useState(28);
  const [tab, setTab] = useState<Tab>("opportunities");
  const [metric, setMetric] = useState<"clicks" | "impressions">("clicks");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const call = useCallback(<T,>(action: string, extra: Record<string, unknown> = {}) => post<T>(auth, "/api/gsc", { siteId: site.id, action, ...extra }), [auth, site.id]);

  const load = useCallback(async () => {
    try {
      const s = await call<Status>("status");
      setStatus(s);
      if (s.connected && !s.property && canEdit) setProps((await call<{ properties: { siteUrl: string; permissionLevel: string }[] }>("properties")).properties);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus({ configured: true, connected: false, property: null, email: null });
    }
  }, [call, canEdit]);

  useEffect(() => {
    // Loading the connection on first render is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const ready = Boolean(status?.connected && status.property);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    call<GscReport>("report", { days })
      .then((r) => live && setReport(r))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [ready, days, call]);

  async function connect() {
    setError("");
    try {
      const { url } = await post<{ url: string }>(auth, "/api/gsc/start", { siteId: site.id });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function pick(property: string) {
    setBusy("Saving...");
    try {
      await call("pick", { property });
      setProps(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  async function disconnect() {
    if (!confirm("Disconnect Search Console from this website?")) return;
    try {
      await call("disconnect");
      setReport(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!status) return <Thinking text="Checking Search Console..." />;

  if (!status.configured)
    return (
      <div className="aw-callout max-w-2xl">
        Search Console is not set up on the server yet. An admin needs to add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> on Render.
      </div>
    );

  if (!status.connected)
    return (
      <section className="aw-frame max-w-3xl">
        <div className="aw-frame__body flex flex-col gap-4">
          {error ? <p className="aw-error">{error}</p> : null}
          <h2 className="aw-h3">Connect Google Search Console</h2>
          <p className="text-[15px] text-body">
            See the real searches that bring people to {site.domain}: clicks, impressions, click rate and position for every query and page. Arrowsterr also finds pages
            close to the top 3, titles that get skipped, pages losing clicks and pages competing with each other. Agentic research uses this data too.
          </p>
          <p className="aw-small">Read only. Arrowsterr can never change anything in your Search Console.</p>
          {canEdit ? (
            <div>
              <button type="button" className="aw-btn aw-btn--accent" onClick={connect}>
                Connect with Google
              </button>
            </div>
          ) : (
            <p className="aw-small">Ask an editor to connect Search Console.</p>
          )}
        </div>
      </section>
    );

  if (!status.property)
    return (
      <section className="aw-frame max-w-3xl">
        <div className="aw-frame__body flex flex-col gap-4">
          {error ? <p className="aw-error">{error}</p> : null}
          <h2 className="aw-h3">Pick the Search Console property for {site.domain}</h2>
          <p className="text-[14px] text-body">
            We could not match {site.domain} on its own. {status.email ? `Signed in as ${status.email}.` : ""}
          </p>
          {busy ? (
            <p className="aw-small">{busy}</p>
          ) : props?.length ? (
            <ul className="flex flex-col gap-2">
              {props.map((p) => (
                <li key={p.siteUrl}>
                  <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => pick(p.siteUrl)}>
                    {p.siteUrl}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="aw-small">This Google account has no Search Console properties. Connect with the account that owns {site.domain} in Search Console.</p>
          )}
          {canEdit ? (
            <div className="flex gap-2">
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={connect}>
                Use another Google account
              </button>
              <button type="button" className="aw-text-link text-[13px]" onClick={disconnect}>
                Disconnect
              </button>
            </div>
          ) : null}
        </div>
      </section>
    );

  const head = (
    <section className="aw-frame flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="aw-live">Connected</span>
      <span className="text-[13px] text-body">
        {status.property}
        {status.email ? ` · ${status.email}` : ""}
      </span>
      <span className="ml-auto flex items-center gap-2">
        <Seg
          label="Period"
          value={String(days)}
          onChange={(v) => {
            setReport(null);
            setDays(Number(v));
          }}
          options={[7, 28, 90, 180].map((d) => ({ id: String(d), label: `${d}d` }))}
        />
        {canEdit ? (
          <button type="button" className="aw-text-link text-[13px]" onClick={disconnect}>
            Disconnect
          </button>
        ) : null}
      </span>
    </section>
  );

  if (!report)
    return (
      <div className="flex flex-col gap-5">
        {head}
        {error ? <p className="aw-error">{error}</p> : <Thinking text="Loading Search Console..." />}
      </div>
    );

  const t = report.totals;
  const tp = report.totalsPrev;
  const had = tp.impressions > 0;
  const ops = opportunities(report);
  const points = report.series.map((d) => ({
    at: d.date,
    label: new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    values: { [metric === "clicks" ? "Clicks" : "Impressions"]: d[metric] },
  }));

  async function addToCalendar(items: NewCalendarItem[]) {
    setError("");
    try {
      const n = await addCalendarItems(sb, auth.workspaceId, items);
      setNotice(`${n} added to the content calendar.${n < items.length ? ` ${items.length - n} were already on it.` : ""}`);
      setPicked(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const asItem = (query: string, page: string | null, position: number, note: string | null): NewCalendarItem => ({
    site_id: site.id,
    keyword: query,
    secondary: [],
    stage: null,
    theme: null,
    volume: null,
    difficulty: null,
    intent: null,
    cpc: null,
    source: "search console",
    action: page ? "update" : "new",
    current_url: page,
    current_rank: Math.round(position),
    notes: note,
  });
  const bestPage = (q: string) => report.pairs.filter((p) => p.query === q).sort((a, b) => b.impressions - a.impressions)[0]?.page ?? null;

  const num = (n: number) => n.toLocaleString("en-US");
  const metricCols = <T extends { clicks: number; impressions: number; ctr: number; position: number }>(): Col<T>[] => [
    { id: "clicks", label: "Clicks", type: "number", value: (r) => r.clicks },
    { id: "impressions", label: "Impressions", type: "number", value: (r) => r.impressions },
    { id: "ctr", label: "CTR %", type: "number", value: (r) => Math.round(r.ctr * 1000) / 10, cell: (r) => pctText(r.ctr) },
    { id: "position", label: "Position", type: "number", value: (r) => Math.round(r.position * 10) / 10, cell: (r) => pos(r.position) },
  ];
  const pageCell = (u: string) => (
    <a href={u} target="_blank" rel="noopener noreferrer" className="block max-w-80 truncate" title={u}>
      {short(u)}
    </a>
  );

  const actionBar = (onAdd: () => void) =>
    picked.size && canEdit ? (
      <div className="flex flex-wrap items-center gap-3 border-b border-rule-faint bg-brand-pale px-5 py-2.5">
        <span className="text-[13px] font-medium text-ink">{picked.size} selected</span>
        <button type="button" className="aw-btn aw-btn--sm" onClick={onAdd}>
          Add to calendar
        </button>
        <button type="button" className="aw-text-link text-[13px]" onClick={() => setPicked(new Set())}>
          Clear
        </button>
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-5">
      {head}
      {error ? <p className="aw-error">{error}</p> : null}
      {notice ? <div className="aw-callout">{notice}</div> : null}

      <div className="aw-stats" style={{ ["--cols" as string]: 4 }}>
        {[
          { lab: "Clicks", v: num(t.clicks), d: had ? <Delta now={t.clicks} before={tp.clicks} digits={0} /> : null },
          { lab: "Impressions", v: num(t.impressions), d: had ? <Delta now={t.impressions} before={tp.impressions} digits={0} /> : null },
          { lab: "Click rate", v: pctText(t.ctr), d: had ? <Delta now={t.ctr * 100} before={tp.ctr * 100} unit=" pts" /> : null },
          { lab: "Avg. position", v: pos(t.position), d: had ? <Delta now={t.position} before={tp.position} lowerIsBetter /> : null },
        ].map((s) => (
          <div key={s.lab} className="aw-stat">
            <div className="aw-stat__lab">{s.lab}</div>
            <div className="flex items-baseline gap-2">
              <span className="aw-stat__num">{s.v}</span>
              {s.d}
            </div>
          </div>
        ))}
      </div>

      <Card
        title={`${metric === "clicks" ? "Clicks" : "Impressions"} by day`}
        action={
          <Seg
            label="Chart"
            value={metric}
            onChange={setMetric}
            options={[
              { id: "clicks", label: "Clicks" },
              { id: "impressions", label: "Impressions" },
            ]}
          />
        }
      >
        <div className="px-3 pt-4 pb-3">
          <TrendChart points={points} lines={[{ name: metric === "clicks" ? "Clicks" : "Impressions", color: "#0943B0", isYou: true }]} metric="count" mode="line" />
        </div>
      </Card>

      <Card
        title={
          <Seg
            label="Table"
            value={tab}
            onChange={(v) => {
              setTab(v);
              setPicked(new Set());
            }}
            options={[
              { id: "opportunities", label: `Opportunities ${ops.length}` },
              { id: "queries", label: `Queries ${report.queries.length}` },
              { id: "pages", label: `Pages ${report.pages.length}` },
              { id: "pairs", label: "Page × query" },
            ]}
          />
        }
        action={
          <button
            type="button"
            className="aw-btn aw-btn--secondary aw-btn--sm"
            onClick={() => {
              const name = `search-console-${tab}-${site.domain}.csv`;
              if (tab === "opportunities") downloadCsv(name, ["type", "query", "page", "clicks", "impressions", "ctr", "position", "extra clicks / mo", "what to do"], ops.map((o) => [o.kind, o.query, o.page, o.clicks, o.impressions, o.ctr, o.position, o.gain, o.note]));
              else if (tab === "queries") downloadCsv(name, ["query", "clicks", "impressions", "ctr", "position"], report.queries.map((q) => [q.query, q.clicks, q.impressions, q.ctr, q.position]));
              else if (tab === "pages") downloadCsv(name, ["page", "clicks", "clicks before", "impressions", "ctr", "position"], report.pages.map((p) => [p.page, p.clicks, p.prevClicks, p.impressions, p.ctr, p.position]));
              else downloadCsv(name, ["page", "query", "clicks", "impressions", "ctr", "position"], report.pairs.map((p) => [p.page, p.query, p.clicks, p.impressions, p.ctr, p.position]));
            }}
          >
            Export CSV
          </button>
        }
      >
        {tab === "opportunities" ? (
          <>
            {actionBar(() => addToCalendar(ops.filter((o) => picked.has(o.id) && o.query).map((o) => asItem(o.query, o.page, o.position, `${o.kind}: ${o.note}`))))}
            <Sheet<Opportunity>
              key="ops"
              label="Opportunities"
              rows={ops}
              rowKey={(o) => o.id}
              sort={{ key: "gain", desc: true }}
              selected={canEdit ? picked : undefined}
              onSelect={canEdit ? setPicked : undefined}
              cols={[
                { id: "kind", label: "Type", type: "list", value: (o) => o.kind, options: ["Close to top 3", "Low click rate", "Losing clicks", "Pages competing"] },
                { id: "query", label: "Query", type: "text", value: (o) => o.query, width: 200 },
                { id: "page", label: "Page", type: "text", value: (o) => short(o.page), cell: (o) => pageCell(o.page) },
                { id: "gain", label: "Extra clicks / mo", type: "number", value: (o) => o.gain },
                ...metricCols<Opportunity>(),
                { id: "note", label: "What to do", type: "text", value: (o) => o.note, cell: (o) => <span className="block max-w-[28rem] whitespace-normal text-[12px]">{o.note}</span> },
              ]}
            />
          </>
        ) : tab === "queries" ? (
          <>
            {actionBar(() => addToCalendar(report.queries.filter((q) => picked.has(q.query)).map((q) => asItem(q.query, bestPage(q.query), q.position, null))))}
            <Sheet<GscQuery>
              key="queries"
              label="Queries"
              rows={report.queries}
              rowKey={(q) => q.query}
              sort={{ key: "clicks", desc: true }}
              selected={canEdit ? picked : undefined}
              onSelect={canEdit ? setPicked : undefined}
              cols={[
                { id: "query", label: "Query", type: "text", value: (q) => q.query, width: 240 },
                { id: "words", label: "Words", type: "number", value: (q) => q.query.split(/\s+/).length },
                ...metricCols<GscQuery>(),
              ]}
            />
          </>
        ) : tab === "pages" ? (
          <Sheet<GscPage>
            key="pages"
            label="Pages"
            rows={report.pages}
            rowKey={(p) => p.page}
            sort={{ key: "clicks", desc: true }}
            cols={[
              { id: "page", label: "Page", type: "text", value: (p) => short(p.page), cell: (p) => pageCell(p.page), width: 260 },
              ...metricCols<GscPage>(),
              { id: "prev", label: "Clicks before", type: "number", value: (p) => p.prevClicks },
              {
                id: "change",
                label: "Change %",
                type: "number",
                value: (p) => (p.prevClicks ? Math.round(((p.clicks - p.prevClicks) / p.prevClicks) * 100) : null),
                cell: (p) => (p.prevClicks ? <Delta now={p.clicks} before={p.prevClicks} digits={0} /> : <span className="text-muted">New</span>),
              },
            ]}
          />
        ) : (
          <Sheet<GscPair>
            key="pairs"
            label="Page and query"
            rows={report.pairs}
            rowKey={(p) => `${p.page}|${p.query}`}
            sort={{ key: "clicks", desc: true }}
            cols={[
              { id: "query", label: "Query", type: "text", value: (p) => p.query, width: 220 },
              { id: "page", label: "Page", type: "text", value: (p) => short(p.page), cell: (p) => pageCell(p.page) },
              ...metricCols<GscPair>(),
            ]}
          />
        )}
      </Card>
      <p className="aw-small">
        Search Console data runs about 2 days behind. Showing the last {days} days through yesterday.
      </p>
    </div>
  );
}
