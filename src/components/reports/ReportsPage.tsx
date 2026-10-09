"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { getGuideline, listCalendar, siteForBrand, type CalendarItem } from "@/lib/db";
import { FONTS, fontsUrl, TEMPLATES, themeOf, type Cards, type Font, type Hero, type ReportTheme } from "@/lib/reportTheme";
import type { BrandGuideline } from "@/lib/writerTypes";
import type { Visitor } from "@/lib/journey";
import { answered, brandStats } from "@/lib/metrics";
import { contentRows, winsAndDrops, type TrafficData } from "@/lib/reports";
import { SECTIONS, type ReportSection, type ReportSnapshot, type ReportStyle } from "@/lib/reportTypes";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import type { View } from "@/lib/view";
import { citedPathsOf } from "../research/ContentResults";
import { Seg, Thinking } from "../ui";
import { ReportDoc, reportCss } from "./ReportDoc";

type Data = { traffic: TrafficData | null; visitors: Visitor[] | null; items: CalendarItem[] | null; guideline: BrandGuideline | null; at: string };
type Summary = { headline: string; points: string[]; next: string[] };
const STYLE_KEY = (ws: string) => `arrowsterr.reportstyle.${ws}`;

const BASE: ReportStyle = { agency: "", logo: "", color: TEMPLATES[0].accent, theme: TEMPLATES[0], title: "", footer: "", whiteLabel: false };
function readStyle(ws: string): ReportStyle {
  try {
    const s = { ...BASE, ...JSON.parse(localStorage.getItem(STYLE_KEY(ws)) ?? "{}") } as ReportStyle;
    return { ...s, theme: s.theme ?? { ...TEMPLATES[0], accent: s.color } };
  } catch {
    return BASE;
  }
}

/** A tiny picture of a template, so people can pick by eye. */
function Thumb({ t, on, onPick }: { t: ReportTheme; on: boolean; onPick: () => void }) {
  const hero = t.hero === "gradient" ? `linear-gradient(135deg, ${t.accent}, ${t.accent2})` : t.heroBg;
  return (
    <button type="button" onClick={onPick} aria-pressed={on} className={`flex flex-col gap-2 rounded-aw border p-2 text-left transition-shadow hover:shadow-aw ${on ? "border-brand ring-2 ring-[var(--aw-brand)]/30" : "border-rule"}`}>
      <span className="flex h-24 flex-col gap-1.5 overflow-hidden p-2" style={{ background: t.paper, borderRadius: Math.min(t.radius, 10) }}>
        <span className="flex h-9 shrink-0 items-end gap-1.5 p-1.5" style={{ background: t.hero === "split" ? t.surface : hero, borderRadius: Math.min(t.radius, 8) / 1.5, border: t.hero === "light" || t.hero === "split" ? `1px solid ${t.line}` : undefined }}>
          <span className="h-1.5 w-10 rounded-full" style={{ background: t.hero === "light" || t.hero === "split" ? t.ink : t.heroText }} />
          {t.hero === "split" ? <span className="ml-auto h-full w-6" style={{ background: t.heroBg }} /> : null}
        </span>
        <span className="grid flex-1 grid-cols-3 gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="flex items-end p-1" style={{ background: t.surface, borderRadius: Math.min(t.radius, 8) / 2, border: t.cards === "outline" ? `1px solid ${t.line}` : undefined }}>
              <span className="h-1 rounded-full" style={{ width: `${40 + i * 20}%`, background: `linear-gradient(90deg, ${t.accent}, ${t.accent2})` }} />
            </span>
          ))}
        </span>
      </span>
      <span className="flex items-center justify-between gap-2 px-1">
        <span className="text-[13px] font-medium text-ink">{t.name}</span>
        <span className="flex gap-0.5">
          {[t.accent, t.accent2, t.heroBg].map((c, i) => (
            <i key={i} className="inline-block h-2.5 w-2.5 rounded-full border border-rule" style={{ background: c }} />
          ))}
        </span>
      </span>
    </button>
  );
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
  const [panel, setPanel] = useState<"templates" | "agent" | "label" | "sections">("templates");
  const [ask, setAsk] = useState("");
  const [why, setWhy] = useState("");
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
      const [traffic, visitors, items, guideline] = await Promise.all([
        call<TrafficData>("/api/traffic", { days }),
        call<{ visitors: Visitor[] }>("/api/visitors", { action: "list", days }).then((v) => v?.visitors ?? null),
        site ? listCalendar(sb, site.id).catch(() => null) : Promise.resolve(null),
        site ? getGuideline(sb, site.id).catch(() => null) : Promise.resolve(null),
      ]);
      if (live) setSaved((x) => ({ ...x, [days]: { traffic, visitors, items, guideline, at: new Date().toISOString() } }));
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

  const theme = themeOf(style);
  const setTheme = (patch: Partial<ReportTheme>) => setStyle({ theme: { ...theme, ...patch }, color: patch.accent ?? theme.accent });

  async function design() {
    setBusy("design");
    setError("");
    setWhy("");
    try {
      const g = data!.guideline;
      const out = await post<{ theme: ReportTheme; why: string }>("/api/reports/style", {
        brand: brand.name,
        domain: brand.domain,
        ask,
        base: theme,
        guideline: g ? { summary: g.summary, voice: g.voice.tone, colors: g.colors, typography: g.typography, ui: g.ui } : null,
      });
      setTheme(out.theme);
      setWhy(out.why);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  function downloadHtml() {
    const el = document.getElementById("report");
    if (!el) return;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${(style.title || "AI Visibility Report").replace(/</g, "")} · ${brand.name}</title><link rel="stylesheet" href="${fontsUrl(theme)}"><style>body{margin:0;background:${theme.paper}}${reportCss(theme)}</style></head><body>${el.outerHTML}</body></html>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = `${brand.name.replace(/\W+/g, "-")}-report.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const toggle = (id: ReportSection) => setSections(sections.includes(id) ? sections.filter((s) => s !== id) : SECTIONS.map((s) => s.id).filter((s) => s === id || sections.includes(s)));

  const field = "aw-input py-2! text-[14px]!";
  const color = (label: string, k: "accent" | "accent2" | "heroBg" | "heroText" | "paper" | "surface" | "ink" | "text") => (
    <label className="flex items-center justify-between gap-2 text-[13px] text-body">
      {label}
      <span className="flex items-center gap-2">
        <span className="aw-num text-[11px] text-muted">{theme[k]}</span>
        <input type="color" value={theme[k]} onChange={(e) => setTheme({ [k]: e.target.value })} className="h-8 w-10 cursor-pointer rounded-aw-sm border border-rule bg-white p-0.5" />
      </span>
    </label>
  );
  const fontPick = (label: string, k: "heading" | "body" | "label") => (
    <label className="flex items-center justify-between gap-2 text-[13px] text-body">
      {label}
      <select value={theme[k]} onChange={(e) => setTheme({ [k]: e.target.value as Font })} className="aw-input w-44! py-1.5! text-[13px]!">
        {FONTS.map((f) => (
          <option key={f}>{f}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-4 self-start print:hidden xl:sticky xl:top-20 xl:max-h-[calc(100vh-100px)] xl:overflow-y-auto xl:pb-4">
        <h1 className="aw-h2">Client report</h1>
        {error ? <p className="aw-error">{error}</p> : null}
        <Seg
          label="Report settings"
          value={panel}
          onChange={setPanel}
          options={[
            { id: "templates", label: "Templates" },
            { id: "agent", label: "✦ Agent" },
            { id: "label", label: "White label" },
            { id: "sections", label: "Sections" },
          ]}
        />

        {panel === "templates" ? (
          <div className="grid grid-cols-2 gap-3">
            {theme.template === "brand" ? <Thumb t={theme} on onPick={() => {}} /> : null}
            {TEMPLATES.map((t) => (
              <Thumb key={t.template} t={t} on={theme.template === t.template} onPick={() => setStyle({ theme: t, color: t.accent })} />
            ))}
          </div>
        ) : panel === "agent" ? (
          <section className="aw-frame flex flex-col gap-3 p-4">
            <span className="flex items-center gap-2 text-[13px]">
              <span className={`aw-status ${data.guideline ? "aw-status--ranked" : "aw-status--pending"}`}>{data.guideline ? "Brand guideline found" : "No brand guideline"}</span>
              {!data.guideline ? <span className="text-muted">Uses {brand.domain}</span> : null}
            </span>
            <textarea value={ask} onChange={(e) => setAsk(e.target.value)} rows={4} placeholder="Dark and premium, like a luxury brand. Big numbers. Keep our blue." aria-label="What the agent should do" className="aw-textarea text-[14px]!" />
            {canEdit ? (
              <button type="button" className="aw-btn aw-btn--accent" onClick={design} disabled={Boolean(busy)}>
                {busy === "design" ? "Designing..." : "✦ Design in our brand style"}
              </button>
            ) : null}
            {why ? <p className="text-[13px] text-body">{why}</p> : null}
          </section>
        ) : panel === "label" ? (
          <section className="aw-frame flex flex-col gap-3 p-4">
            <label className="flex flex-col gap-1 text-[13px] text-body">
              Report title
              <input value={style.title ?? ""} onChange={(e) => setStyle({ title: e.target.value })} placeholder="AI Visibility Report" className={field} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] text-body">
              Agency name
              <input value={style.agency} onChange={(e) => setStyle({ agency: e.target.value })} placeholder="Perceptric" className={field} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] text-body">
              Logo URL
              <input value={style.logo} onChange={(e) => setStyle({ logo: e.target.value.trim() })} placeholder="https://.../logo.png" className={field} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] text-body">
              Footer line
              <input value={style.footer ?? ""} onChange={(e) => setStyle({ footer: e.target.value })} placeholder="hello@agency.com · agency.com" className={field} />
            </label>
            <label className="flex items-center gap-2 text-[14px] text-ink">
              <input type="checkbox" checked={Boolean(style.whiteLabel)} onChange={(e) => setStyle({ whiteLabel: e.target.checked })} className="h-4 w-4 accent-[var(--aw-brand)]" />
              Hide &quot;Made with Arrowsterr&quot;
            </label>
            <span className="aw-label mt-2">Colors</span>
            {color("Accent", "accent")}
            {color("Second accent", "accent2")}
            {color("Cover", "heroBg")}
            {color("Cover text", "heroText")}
            {color("Page", "paper")}
            {color("Cards", "surface")}
            {color("Headings", "ink")}
            {color("Body text", "text")}
            <span className="aw-label mt-2">Type and shape</span>
            {fontPick("Headings", "heading")}
            {fontPick("Body", "body")}
            {fontPick("Labels", "label")}
            <label className="flex items-center justify-between gap-2 text-[13px] text-body">
              Cover
              <select value={theme.hero} onChange={(e) => setTheme({ hero: e.target.value as Hero })} className="aw-input w-44! py-1.5! text-[13px]!">
                <option value="dark">Dark</option>
                <option value="gradient">Gradient</option>
                <option value="light">Light</option>
                <option value="split">Split</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-2 text-[13px] text-body">
              Cards
              <select value={theme.cards} onChange={(e) => setTheme({ cards: e.target.value as Cards })} className="aw-input w-44! py-1.5! text-[13px]!">
                <option value="elevated">Shadow</option>
                <option value="outline">Outline</option>
                <option value="tinted">Tinted</option>
                <option value="flat">Flat</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-2 text-[13px] text-body">
              Corners
              <input type="range" min={0} max={28} value={theme.radius} onChange={(e) => setTheme({ radius: Number(e.target.value) })} className="w-44 accent-[var(--aw-brand)]" />
            </label>
          </section>
        ) : (
          <section className="aw-frame flex flex-col gap-2.5 p-4">
            {SECTIONS.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-[14px] text-ink">
                <input type="checkbox" checked={sections.includes(s.id)} onChange={() => toggle(s.id)} className="h-4 w-4 accent-[var(--aw-brand)]" />
                {s.label}
              </label>
            ))}
          </section>
        )}
      </aside>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {canEdit ? (
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={writeSummary} disabled={Boolean(busy)}>
              {busy === "summary" ? "Writing..." : summary ? "Rewrite AI summary" : "✦ Add AI summary"}
            </button>
          ) : null}
          <span className="ml-auto flex flex-wrap gap-2">
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={downloadHtml}>
              Download HTML
            </button>
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => window.print()}>
              Download PDF
            </button>
            {canEdit ? (
              <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={share} disabled={Boolean(busy)}>
                {busy === "share" ? "Creating link..." : "Share link"}
              </button>
            ) : null}
          </span>
        </div>
        {link ? (
          <p className="aw-callout break-all text-[13px]">
            Link copied:{" "}
            <a href={link} target="_blank" rel="noopener noreferrer">
              {link}
            </a>
          </p>
        ) : null}
        <div className="min-w-0 overflow-hidden rounded-aw-lg border border-rule print:rounded-none print:border-0" style={{ background: theme.paper }}>
          <ReportDoc r={snapshot} />
        </div>
      </div>
    </div>
  );
}
