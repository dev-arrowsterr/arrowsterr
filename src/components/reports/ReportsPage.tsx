"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { listCalendar, siteForBrand, type CalendarItem } from "@/lib/db";
import type { Visitor } from "@/lib/journey";
import { answered, brandStats } from "@/lib/metrics";
import { contentRows, winsAndDrops, type TrafficData } from "@/lib/reports";
import { SECTIONS, type ReportSection, type ReportSnapshot, type ReportStyle } from "@/lib/reportTypes";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import type { View } from "@/lib/view";
import { citedPathsOf } from "../research/ContentResults";
import { Thinking } from "../ui";
import { ReportDoc } from "./ReportDoc";

type Data = { traffic: TrafficData | null; visitors: Visitor[] | null; items: CalendarItem[] | null; at: string };
type Summary = { headline: string; points: string[]; next: string[] };
const STYLE_KEY = (ws: string) => `arrowsterr.reportstyle.${ws}`;

function readStyle(ws: string): ReportStyle {
  try {
    return { agency: "", logo: "", color: "#0943B0", ...JSON.parse(localStorage.getItem(STYLE_KEY(ws)) ?? "{}") };
  } catch {
    return { agency: "", logo: "", color: "#0943B0" };
  }
}

/** Build a client report: pick sections, add your agency's logo and color, then download a PDF or share a link. */
export function ReportsPage({ sb, auth, view, canEdit }: { sb: SupabaseClient; auth: RunAuth; view: View; canEdit: boolean }) {
  const { brand, current, previous, filter, days, engines } = view;
  const [saved, setSaved] = useStash<Record<number, Data>>(`report:${brand.id}`, {});
  const [summaries, setSummaries] = useStash<Record<number, Summary>>(`report:${brand.id}:ai`, {});
  const [sections, setSections] = useStash<ReportSection[]>(`report:${brand.id}:sections`, ["ai", "competitors", "traffic", "visitors", "content"]);
  const [style, setStyleState] = useState<ReportStyle>(() => readStyle(auth.workspaceId));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const data = saved[days] ?? null;
  const summary = summaries[days] ?? null;

  const setStyle = (patch: Partial<ReportStyle>) => {
    const next = { ...style, ...patch };
    setStyleState(next);
    try {
      localStorage.setItem(STYLE_KEY(auth.workspaceId), JSON.stringify(next));
    } catch {
      // Storage blocked. The style lasts until the page reloads.
    }
  };

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
      const [traffic, visitors, items] = await Promise.all([
        call<TrafficData>("/api/traffic", { days }),
        call<{ visitors: Visitor[] }>("/api/visitors", { action: "list", days }).then((v) => v?.visitors ?? null),
        site ? listCalendar(sb, site.id).catch(() => null) : Promise.resolve(null),
      ]);
      if (live) setSaved((x) => ({ ...x, [days]: { traffic, visitors, items, at: new Date().toISOString() } }));
    })();
    return () => {
      live = false;
    };
  }, [sb, auth, brand, canEdit, days, setSaved]);

  if (!data) return <Thinking text="Pulling your report together..." />;

  // Everything the report shows, frozen into one object.
  const you = { name: brand.name, domain: brand.domain };
  const chats = answered(current, filter);
  const before = answered(previous, filter);
  const stats = brandStats(chats, you);
  const me = stats.find((s) => s.isYou);
  const was = before.length ? brandStats(before, you).find((s) => s.isYou) : null;
  const ranked = [...stats].sort((a, b) => b.visibility - a.visibility);
  const byModel = engines
    .map((e) => ({
      engine: e,
      now: chats.some((c) => c.engine === e) ? (brandStats(chats.filter((c) => c.engine === e), you).find((s) => s.isYou)?.visibility ?? 0) : null,
      before: before.some((c) => c.engine === e) ? (brandStats(before.filter((c) => c.engine === e), you).find((s) => s.isYou)?.visibility ?? 0) : null,
    }))
    .filter((m) => m.now !== null);
  const t = data.traffic;
  const v = data.visitors;
  const items = data.items ?? [];
  const since = new Date(Date.parse(data.at) - days * 864e5).toISOString().slice(0, 10);
  const { wins, drops } = winsAndDrops({ engines: byModel, traffic: t });

  const snapshot: ReportSnapshot = {
    brand: { name: brand.name, domain: brand.domain, logo: brand.logo },
    style,
    days,
    at: data.at,
    sections,
    summary,
    ai: me
      ? {
          visibility: me.visibility,
          visibilityBefore: was ? was.visibility : null,
          sentiment: me.sentiment,
          position: me.position,
          rank: ranked.findIndex((s) => s.isYou) + 1,
          brands: stats.length,
          answers: chats.length,
          byModel,
        }
      : null,
    competitors: chats.length ? ranked.slice(0, 10).map((s) => ({ name: s.name, domain: s.domain ?? null, visibility: s.visibility, sentiment: s.sentiment, position: s.position, isYou: s.isYou })) : null,
    traffic: t ? { visits: t.totals.visits, visitsBefore: t.totalsPrev.visits, ai: t.ai, aiBefore: t.aiPrev, byEngine: t.byEngine } : null,
    visitors: v
      ? {
          total: v.length,
          hot: v.filter((x) => x.label === "Hot").length,
          actions: v.filter((x) => x.actions.length).length,
          top: [...v]
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map((x) => ({ name: x.name, emoji: x.emoji, score: x.score, label: x.label, source: x.source })),
        }
      : null,
    content: data.items
      ? {
          published: items.filter((i) => i.status === "published" && (!i.due_date || i.due_date >= since)).length,
          writing: items.filter((i) => i.status === "writing").length,
          briefs: items.filter((i) => i.status === "brief").length,
          planned: items.filter((i) => i.status === "planned").length,
          pages: contentRows({ items, citedPaths: chats.length ? citedPathsOf(chats, brand.domain) : null, traffic: t, visitors: v }),
        }
      : null,
    wins,
    drops,
  };

  async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` },
      body: JSON.stringify({ ...body, workspaceId: auth.workspaceId }),
    });
    const out = await res.json().catch(() => ({ error: `The server returned ${res.status}.` }));
    if (!res.ok) throw new Error(out.error || `Error ${res.status}`);
    return out as T;
  }

  async function writeSummary() {
    setBusy("summary");
    setError("");
    try {
      const { headline, points, next } = await post<Summary>("/api/reports/summary", {
        brand: brand.name,
        domain: brand.domain,
        days,
        data: { ...snapshot, style: undefined, brand: undefined, content: snapshot.content ? { ...snapshot.content, pages: snapshot.content.pages.slice(0, 10) } : null },
      });
      setSummaries((x) => ({ ...x, [days]: { headline, points, next } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function share() {
    setBusy("share");
    setError("");
    try {
      const { url } = await post<{ url: string }>("/api/reports/share", { brandId: brand.id, data: snapshot });
      setLink(url);
      navigator.clipboard?.writeText(url).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const toggle = (id: ReportSection) => setSections(sections.includes(id) ? sections.filter((s) => s !== id) : SECTIONS.map((s) => s.id).filter((s) => s === id || sections.includes(s)));

  return (
    <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-5 self-start print:hidden xl:sticky xl:top-20">
        <div>
          <h1 className="aw-h2">Client report</h1>
          <p className="mt-1 text-[13px] text-body">Pick what to include, add your branding, then download a PDF or share a link. The period follows the top bar.</p>
        </div>
        {error ? <p className="aw-error">{error}</p> : null}

        <section className="aw-frame flex flex-col gap-2 p-4">
          <span className="aw-label">Sections</span>
          {SECTIONS.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-[14px] text-ink">
              <input type="checkbox" checked={sections.includes(s.id)} onChange={() => toggle(s.id)} className="h-4 w-4 accent-[var(--aw-brand)]" />
              {s.label}
            </label>
          ))}
        </section>

        <section className="aw-frame flex flex-col gap-3 p-4">
          <span className="aw-label">Your branding</span>
          <label className="flex flex-col gap-1 text-[13px] text-body">
            Agency name
            <input value={style.agency} onChange={(e) => setStyle({ agency: e.target.value })} placeholder="Perceptric" className="aw-input py-1.5! text-[14px]!" />
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-body">
            Logo URL
            <input value={style.logo} onChange={(e) => setStyle({ logo: e.target.value.trim() })} placeholder="https://.../logo.png" className="aw-input py-1.5! text-[14px]!" />
          </label>
          <label className="flex items-center justify-between gap-2 text-[13px] text-body">
            Accent color
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(style.color) ? style.color : "#0943b0"} onChange={(e) => setStyle({ color: e.target.value })} className="h-8 w-14 cursor-pointer border border-rule" />
          </label>
        </section>

        <section className="flex flex-col gap-2">
          {canEdit ? (
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={writeSummary} disabled={Boolean(busy)}>
              {busy === "summary" ? "Writing..." : summary ? "Rewrite AI summary" : "Add AI summary"}
            </button>
          ) : null}
          <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={() => window.print()}>
            Download PDF
          </button>
          {canEdit ? (
            <button type="button" className="aw-btn aw-btn--accent aw-btn--sm" onClick={share} disabled={Boolean(busy)}>
              {busy === "share" ? "Creating link..." : "Create share link"}
            </button>
          ) : null}
          {link ? (
            <p className="break-all text-[12px] text-body">
              Link copied. Anyone with it can view this report:{" "}
              <a href={link} target="_blank" rel="noopener noreferrer">
                {link}
              </a>
            </p>
          ) : null}
          <p className="aw-small">A shared link is a frozen copy. Make a new one each month.</p>
        </section>
      </aside>

      <div className="min-w-0 border border-rule bg-surface-2 py-6 print:border-0 print:bg-white print:py-0">
        <ReportDoc r={snapshot} />
      </div>
    </div>
  );
}
