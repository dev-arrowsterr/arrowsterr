"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { listCalendar, siteForBrand, type CalendarItem } from "@/lib/db";
import type { Visitor } from "@/lib/journey";
import { answered, brandStats, pageKey } from "@/lib/metrics";
import type { GscReport } from "@/lib/opportunities";
import { contentRows, pathOf, winsAndDrops, type ContentRow, type TrafficData } from "@/lib/reports";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import type { View } from "@/lib/view";
import { Sheet } from "../Sheet";
import { Card, Delta, pct, pos, score, Thinking } from "../ui";

type Data = {
  traffic: TrafficData | null;
  gsc: GscReport | null;
  visitors: Visitor[] | null;
  items: CalendarItem[] | null;
  at: string;
};
type Summary = { headline: string; points: string[]; next: string[]; at: string };
const gscDays = (d: number) => (d <= 7 ? 7 : d <= 30 ? 28 : 90);
const num = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("en-US"));

/** Reports for the website in the top bar: a one-page Summary, and how each published page performs. */
export function ReportsPage({ sb, auth, view, canEdit, mode, onCalendar }: { sb: SupabaseClient; auth: RunAuth; view: View; canEdit: boolean; mode: "summary" | "performance"; onCalendar: () => void }) {
  const { brand, current, previous, filter, days, engines } = view;
  const [saved, setSaved] = useStash<Record<number, Data>>(`report:${brand.id}`, {});
  const [summaries, setSummaries] = useStash<Record<number, Summary>>(`report:${brand.id}:ai`, {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const data = saved[days] ?? null;
  const summary = summaries[days] ?? null;

  // Gather every section's numbers. Each part is optional: a section that is not connected shows as "not connected".
  useEffect(() => {
    let live = true;
    const call = async <T,>(path: string, body: Record<string, unknown>): Promise<T | null> => {
      try {
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` },
          body: JSON.stringify({ ...body, workspaceId: auth.workspaceId, brandId: brand.id }),
        });
        return res.ok ? ((await res.json()) as T) : null;
      } catch {
        return null;
      }
    };
    (async () => {
      const site = await siteForBrand(sb, brand, canEdit).catch(() => null);
      const [traffic, visitors, items, gsc] = await Promise.all([
        call<TrafficData>("/api/traffic", { days }),
        call<{ visitors: Visitor[] }>("/api/visitors", { action: "list", days }).then((v) => v?.visitors ?? null),
        site ? listCalendar(sb, site.id).catch(() => null) : Promise.resolve(null),
        site
          ? call<{ connected: boolean; property: string | null }>("/api/gsc", { siteId: site.id, action: "status" }).then((s) =>
              s?.connected && s.property ? call<GscReport>("/api/gsc", { siteId: site.id, action: "report", days: gscDays(days) }) : null,
            )
          : Promise.resolve(null),
      ]);
      if (live) setSaved((x) => ({ ...x, [days]: { traffic, gsc, visitors, items, at: new Date().toISOString() } }));
    })();
    return () => {
      live = false;
    };
  }, [sb, auth, brand, canEdit, days, setSaved]);

  // AI visibility, from the daily checks already in the app.
  const you = { name: brand.name, domain: brand.domain };
  const chats = answered(current, filter);
  const before = answered(previous, filter);
  const stats = brandStats(chats, you);
  const me = stats.find((s) => s.isYou);
  const was = before.length ? brandStats(before, you).find((s) => s.isYou) : null;
  const rank = me ? [...stats].sort((a, b) => b.visibility - a.visibility).findIndex((s) => s.isYou) + 1 : null;
  const engineRows = engines.map((e) => {
    const now = brandStats(chats.filter((c) => c.engine === e), you).find((s) => s.isYou)?.visibility ?? null;
    const then = before.length ? (brandStats(before.filter((c) => c.engine === e), you).find((s) => s.isYou)?.visibility ?? null) : null;
    return { engine: e, now: chats.some((c) => c.engine === e) ? now : null, before: then };
  });

  if (!data) return <Thinking text="Pulling your report together..." />;
  const t = data.traffic;
  const g = data.gsc;
  const v = data.visitors;
  const since = new Date(Date.parse(data.at) - days * 864e5).toISOString().slice(0, 10);
  const items = data.items ?? [];
  const content = {
    published: items.filter((i) => i.status === "published" && (!i.due_date || i.due_date >= since)).length,
    writing: items.filter((i) => i.status === "writing").length,
    briefs: items.filter((i) => i.status === "brief").length,
    planned: items.filter((i) => i.status === "planned").length,
  };
  const { wins, drops } = winsAndDrops({ engines: engineRows, traffic: t, gsc: g });

  async function writeSummary() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/reports/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` },
        body: JSON.stringify({
          workspaceId: auth.workspaceId,
          brand: brand.name,
          domain: brand.domain,
          days,
          data: {
            aiVisibility: me ? { visibility: Math.round(me.visibility), before: was ? Math.round(was.visibility) : null, sentiment: me.sentiment, position: me.position, rank, brandsCompared: stats.length } : null,
            byModel: engineRows,
            website: t ? { visits: t.totals.visits, visitsBefore: t.totalsPrev.visits, fromAI: t.ai, fromAIBefore: t.aiPrev } : null,
            google: g ? { clicks: g.totals.clicks, clicksBefore: g.totalsPrev.clicks, impressions: g.totals.impressions, position: g.totals.position, positionBefore: g.totalsPrev.position } : null,
            visitors: v ? { total: v.length, hot: v.filter((x) => x.label === "Hot").length, keyActions: v.filter((x) => x.actions.length).length } : null,
            content,
            wins,
            drops,
          },
        }),
      });
      const out = await res.json().catch(() => ({ error: `The server returned ${res.status}.` }));
      if (!res.ok) throw new Error(out.error || `Error ${res.status}`);
      setSummaries((x) => ({ ...x, [days]: out }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const head = (title: string) => (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="aw-h2">{title}</h1>
        <span className="text-[13px] text-muted">
          {brand.name} · {brand.domain} · last {days} days, compared with the {days} days before · updated {new Date(data.at).toLocaleString()}
        </span>
      </div>
      <span className="flex gap-2 print:hidden">
        {mode === "summary" && canEdit ? (
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={writeSummary} disabled={busy}>
            {busy ? "Writing..." : summary ? "Rewrite AI summary" : "Write AI summary"}
          </button>
        ) : null}
        <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={() => window.print()}>
          Download PDF
        </button>
      </span>
    </div>
  );

  const strip = (items: { lab: string; v: React.ReactNode; d?: React.ReactNode }[]) => (
    <div className="aw-stats aw-stats--tight" style={{ ["--cols" as string]: items.length }}>
      {items.map((x) => (
        <div key={x.lab} className="aw-stat">
          <div className="aw-stat__lab">{x.lab}</div>
          <div className="flex items-baseline gap-2">
            <span className="aw-stat__num">{x.v}</span>
            {x.d}
          </div>
        </div>
      ))}
    </div>
  );
  const off = (what: string) => <p className="aw-small px-1">{what} is not connected for this website.</p>;

  if (mode === "performance") {
    const cited = new Map<string, number>();
    for (const c of chats) for (const p of new Set(c.sources.map((s) => pageKey(s.url)))) cited.set(p, (cited.get(p) ?? 0) + 1);
    const citedPaths = new Map<string, number>();
    for (const [k, n] of cited) {
      const host = k.split("/")[0];
      if (host === brand.domain.replace(/^www\./, "") || host.endsWith(`.${brand.domain}`)) citedPaths.set(pathOf(`https://${k}`), chats.length ? (n / chats.length) * 100 : 0);
    }
    const rows = contentRows({ items, gsc: g, citedPaths: chats.length ? citedPaths : null, traffic: t, visitors: v });
    return (
      <div className="flex flex-col gap-5">
        {head("Content performance")}
        {strip([
          { lab: "Published pages", v: rows.length },
          { lab: "Google clicks", v: g ? num(rows.reduce((n, r) => n + (r.clicks ?? 0), 0)) : "–" },
          { lab: "Cited by AI", v: chats.length ? rows.filter((r) => (r.cited ?? 0) > 0).length : "–" },
          { lab: "Visits from AI", v: t ? num(rows.reduce((n, r) => n + (r.aiVisits ?? 0), 0)) : "–" },
          { lab: "Hot visitors landed", v: v ? num(rows.reduce((n, r) => n + (r.hot ?? 0), 0)) : "–" },
        ])}
        {rows.length ? (
          <Card title="Every published page">
            <Sheet<ContentRow>
              label="Content performance"
              rows={rows}
              rowKey={(r) => r.id}
              sort={{ key: "clicks", desc: true }}
              cols={[
                {
                  id: "keyword",
                  label: "Page",
                  type: "text",
                  value: (r) => r.keyword,
                  width: 240,
                  cell: (r) => (
                    <span className="flex flex-col">
                      <span className="text-ink">{r.keyword}</span>
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="max-w-72 truncate text-[12px]">
                        {r.path}
                      </a>
                    </span>
                  ),
                },
                { id: "job", label: "Job", type: "list", value: (r) => (r.action === "update" ? "Updated" : "New"), options: ["New", "Updated"] },
                { id: "published", label: "Published", type: "date", value: (r) => r.published },
                { id: "position", label: "Google position", type: "number", value: (r) => r.position, cell: (r) => (r.position ? `#${r.position}` : <span className="text-muted">{g ? "Not in data" : "–"}</span>) },
                { id: "clicks", label: "Clicks", type: "number", value: (r) => r.clicks },
                { id: "impressions", label: "Impressions", type: "number", value: (r) => r.impressions },
                { id: "cited", label: "Cited in AI answers", type: "number", value: (r) => (r.cited === null ? null : Math.round(r.cited)), cell: (r) => (r.cited === null ? "–" : r.cited ? pct(r.cited) : <span className="text-muted">Not yet</span>) },
                { id: "visits", label: "Visits", type: "number", value: (r) => r.visits },
                { id: "ai", label: "From AI", type: "number", value: (r) => r.aiVisits },
                { id: "landed", label: "Visitors landed", type: "number", value: (r) => r.landed },
                { id: "hot", label: "Hot", type: "number", value: (r) => r.hot },
              ]}
            />
          </Card>
        ) : (
          <div className="aw-callout flex flex-wrap items-center justify-between gap-3">
            No published pages yet. In the Calendar, set a page to Published and add its URL. It shows up here with its Google, AI and visitor numbers.
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm print:hidden" onClick={onCalendar}>
              Open calendar
            </button>
          </div>
        )}
        <p className="aw-small">
          {!g ? "Connect Search Console for Google numbers. " : ""}
          {!t ? "Connect the tracking code in Traffic for visits. " : ""}
          AI citations come from the daily prompt checks in this period.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {head("Summary")}
      {error ? <p className="aw-error">{error}</p> : null}

      {summary ? (
        <section className="aw-frame" style={{ boxShadow: "inset 2px 0 0 var(--aw-brand)" }}>
          <div className="flex flex-col gap-3 p-5">
            <p className="text-[18px] font-medium text-ink">{summary.headline}</p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-[14px] text-body">
              {summary.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <div>
              <span className="aw-label">Next steps</span>
              <ol className="mt-1 flex list-decimal flex-col gap-1 pl-5 text-[14px] text-ink">
                {summary.next.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ol>
            </div>
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="aw-h4">AI visibility</h2>
        {me
          ? strip([
              { lab: "Visibility", v: pct(me.visibility), d: was ? <Delta now={me.visibility} before={was.visibility} /> : null },
              { lab: "Sentiment", v: score(me.sentiment), d: was ? <Delta now={me.sentiment} before={was.sentiment} digits={0} /> : null },
              { lab: "Avg. position", v: pos(me.position), d: was ? <Delta now={me.position} before={was.position} lowerIsBetter /> : null },
              { lab: "Rank among brands", v: rank ? `#${rank} of ${stats.length}` : "–" },
            ])
          : off("AI visibility")}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="aw-h4">Website</h2>
        {t
          ? strip([
              { lab: "Visits", v: num(t.totals.visits), d: <Delta now={t.totals.visits} before={t.totalsPrev.visits} digits={0} /> },
              { lab: "Visits from AI", v: num(t.ai), d: <Delta now={t.ai} before={t.aiPrev} digits={0} /> },
              { lab: "Hot visitors", v: v ? num(v.filter((x) => x.label === "Hot").length) : "–" },
              { lab: "Took a key action", v: v ? num(v.filter((x) => x.actions.length).length) : "–" },
            ])
          : off("Website tracking")}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="aw-h4">Google</h2>
        {g
          ? strip([
              { lab: "Clicks", v: num(g.totals.clicks), d: <Delta now={g.totals.clicks} before={g.totalsPrev.clicks} digits={0} /> },
              { lab: "Impressions", v: num(g.totals.impressions), d: <Delta now={g.totals.impressions} before={g.totalsPrev.impressions} digits={0} /> },
              { lab: "Avg. position", v: g.totals.position.toFixed(1), d: <Delta now={g.totals.position} before={g.totalsPrev.position} lowerIsBetter /> },
            ])
          : off("Search Console")}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="aw-h4">Content</h2>
        {data.items
          ? strip([
              { lab: "Published this period", v: content.published },
              { lab: "Writing", v: content.writing },
              { lab: "Briefs ready", v: content.briefs },
              { lab: "Planned", v: content.planned },
            ])
          : off("The content calendar")}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {[
          { title: "Top wins", list: wins, empty: "No big gains this period." },
          { title: "Top drops", list: drops, empty: "No big drops this period." },
        ].map((box) => (
          <Card key={box.title} title={box.title}>
            <ul className="divide-y divide-rule-faint">
              {box.list.map((c) => (
                <li key={c.text} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="flex flex-col">
                    <span className="text-[14px] text-ink">{c.text}</span>
                    <span className="aw-label">{c.area}</span>
                  </span>
                  <span className={`aw-num text-[15px] ${c.change > 0 ? "text-pos" : "text-neg"}`}>
                    {c.change > 0 ? "↗ +" : "↘ "}
                    {c.change}
                    {c.unit}
                  </span>
                </li>
              ))}
              {!box.list.length ? <li className="aw-small px-5 py-4">{box.empty}</li> : null}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
