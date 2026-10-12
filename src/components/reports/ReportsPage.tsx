"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { preinit } from "react-dom";
import { getGuideline, listCalendar, siteForBrand, type CalendarItem } from "@/lib/db";
import { intelRows, intelSnapshot, SAMPLE_CITED, sampleIntel } from "@/lib/intel";
import { FONTS, fontsUrl, TEMPLATES, themeOf, type Cards, type Font, type Hero, type ReportTheme } from "@/lib/reportTheme";
import type { BrandGuideline } from "@/lib/writerTypes";
import type { Visitor } from "@/lib/journey";
import { answered, brandStats } from "@/lib/metrics";
import { contentRows, winsAndDrops, type TrafficData } from "@/lib/reports";
import type { PagePerf } from "@/lib/research";
import { SECTIONS, type CompetitorsSnapshot, type IntelSnapshot, type PromptsSnapshot, type ReportSection, type ReportSnapshot, type ReportStyle } from "@/lib/reportTypes";
import type { RunAuth } from "@/lib/runner";
import { peek, useStash } from "@/lib/stash";
import type { View } from "@/lib/view";
import { citedPathsOf } from "../research/ContentResults";
import { promptsSnapshot } from "../PromptsPage";
import { AiIcon, Seg, Thinking } from "../ui";
import { CompetitorsDoc } from "./CompetitorsDoc";
import { IntelDoc } from "./IntelDoc";
import { PromptsDoc } from "./PromptsDoc";
import { ReportDoc, reportCss } from "./ReportDoc";

type Data = { traffic: TrafficData | null; visitors: Visitor[] | null; items: CalendarItem[] | null; guideline: BrandGuideline | null; siteId?: string | null; at: string };
type Summary = { headline: string; points: string[]; next: string[] };
type Kind = "client" | "prompts" | "competitors" | "intel";

/** The reports one click away. The client report is the one you design and white label. */
const KINDS: { id: Kind; title: string; text: string }[] = [
  { id: "client", title: "Client report", text: "Everything in one branded report. Design it, white label it, pick sections." },
  { id: "prompts", title: "AI Visibility", text: "Every prompt, every AI and each full answer." },
  { id: "competitors", title: "Competitors and Quadrant", text: "Who AI names most, and where each brand sits." },
  { id: "intel", title: "Content Intelligence", text: "How every page performs and which to update next." },
];
const STYLE_KEY = (ws: string) => `arrowsterr.reportstyle.${ws}`;
const DATA_KEY = (brand: string) => `report:${brand}`;
const FRESH = 10 * 60_000;

const BASE: ReportStyle = { agency: "", logo: "", color: TEMPLATES[0].accent, theme: TEMPLATES[0], title: "", footer: "", whiteLabel: false };
function readStyle(ws: string): ReportStyle {
  try {
    const s = { ...BASE, ...JSON.parse(localStorage.getItem(STYLE_KEY(ws)) ?? "{}") } as ReportStyle;
    return { ...s, theme: s.theme ?? { ...TEMPLATES[0], accent: s.color } };
  } catch {
    return BASE;
  }
}

/** Reports: the branded client report, plus one-click AI Visibility, Competitors and Content Intelligence reports. */
export function ReportsPage({ sb, auth, view, canEdit }: { sb: SupabaseClient; auth: RunAuth; view: View; canEdit: boolean }) {
  const { brand, current, previous, filter, days, engines } = view;
  const [saved, setSaved] = useStash<Record<number, Data>>(DATA_KEY(brand.id), {});
  const [summaries, setSummaries] = useStash<Record<number, Summary>>(`report:${brand.id}:ai`, {});
  const [sections, setSections] = useStash<ReportSection[]>(`report:${brand.id}:sections`, ["ai", "competitors", "traffic", "visitors", "content"]);
  const [style, setStyleState] = useState<ReportStyle>(() => readStyle(auth.workspaceId));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [panel, setPanel] = useState<"agent" | "label" | "sections">("agent");
  const [kind, setKind] = useStash<Kind>(`report:${brand.id}:kind`, "client");
  const [promptsSnap, setPromptsSnap] = useState<PromptsSnapshot | null>(null);
  const [pages, setPages] = useState<PagePerf[] | null>(null);
  const [ask, setAsk] = useState("");
  const [why, setWhy] = useState("");
  // While a new period loads, keep showing the last one instead of dropping to a spinner.
  const data = saved[days] ?? Object.values(saved).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  const stale = !saved[days];
  // The app hands us a new auth object on every render. Read the latest one without refetching.
  const authRef = useRef(auth);
  useEffect(() => {
    authRef.current = auth;
  });
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

  const workspaceId = auth.workspaceId;
  useEffect(() => {
    const have = peek<Record<number, Data>>(DATA_KEY(brand.id))?.[days];
    if (have && Date.now() - Date.parse(have.at) < FRESH) return;
    let live = true;
    const call = async <T,>(path: string, body: Record<string, unknown>): Promise<T | null> => {
      try {
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${await authRef.current.token()}` },
          body: JSON.stringify({ ...body, workspaceId, brandId: brand.id }),
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
      if (live) setSaved((x) => ({ ...x, [days]: { traffic, visitors, items, guideline, siteId: site?.id ?? null, at: new Date().toISOString() } }));
    })();
    return () => {
      live = false;
    };
  }, [sb, workspaceId, brand, canEdit, days, setSaved]);

  // The AI Visibility report reads each prompt's full answers, so it loads when picked.
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });
  useEffect(() => {
    if (kind !== "prompts") return;
    let live = true;
    promptsSnapshot(sb, viewRef.current, viewRef.current.engines)
      .then((r) => live && setPromptsSnap(r))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [kind, sb, brand.id, days]);

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

  const competitorsSnap: CompetitorsSnapshot = {
    kind: "competitors",
    brand: { name: brand.name, domain: brand.domain, logo: brand.logo },
    days,
    at: data.at,
    rows: ranked.slice(0, 15).map((s) => ({ name: s.name, domain: s.domain, isYou: s.isYou, visibility: s.visibility, position: s.position, mentions: s.mentions })),
  };
  // Content Intelligence uses the pages that page already loaded. Until then it shows a sample.
  const realPages = pages ?? (data.siteId ? (peek<PagePerf[] | null>(`pages:${data.siteId}`) ?? null) : null);
  const intelSnap: IntelSnapshot = intelSnapshot(
    intelRows({ pages: realPages ?? sampleIntel(brand.domain), traffic: realPages ? t : null, cited: !realPages ? SAMPLE_CITED : chats.length ? citedPathsOf(chats, brand.domain) : null, domain: brand.domain }),
    { brand: { name: brand.name, domain: brand.domain, logo: brand.logo }, days, linked: Boolean(realPages && t), sample: !realPages },
  );
  const quick = kind === "prompts" ? promptsSnap : kind === "competitors" ? competitorsSnap : kind === "intel" ? intelSnap : null;

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
      const { url } = await post<{ url: string }>("/api/reports/share", { brandId: brand.id, data: kind === "client" ? snapshot : quick });
      setLink(url);
      navigator.clipboard?.writeText(url).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function loadPages() {
    if (!data?.siteId) return;
    setBusy("pages");
    setError("");
    try {
      setPages((await post<{ pages: PagePerf[] }>("/api/research/pages", { brandId: brand.id, siteId: data.siteId })).pages);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const theme = themeOf(style);
  preinit(fontsUrl(theme), { as: "style", precedence: "default" });
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
        <h1 className="aw-h2">Reports</h1>
        {error ? <p className="aw-error">{error}</p> : null}
        <div role="tablist" aria-label="Report" className="flex flex-col gap-2">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="tab"
              aria-selected={kind === k.id}
              onClick={() => setKind(k.id)}
              className={`flex flex-col gap-0.5 rounded-aw border px-3.5 py-2.5 text-left transition-colors ${kind === k.id ? "border-brand bg-brand-pale" : "border-rule bg-white hover:border-[var(--aw-brand)]/40"}`}
            >
              <span className="text-[14px] font-medium text-ink">{k.title}</span>
              <span className="text-[12.5px] text-body">{k.text}</span>
            </button>
          ))}
        </div>

        {kind === "intel" && intelSnap.sample ? (
          <section className="aw-frame flex flex-col gap-3 p-4 text-[13px] text-body">
            <p>This is a sample with example numbers. Load {brand.domain} to fill it with real pages.</p>
            {canEdit && data.siteId ? (
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm self-start" onClick={loadPages} disabled={Boolean(busy)}>
                {busy === "pages" ? "Reading every page..." : "Load real pages"}
              </button>
            ) : null}
          </section>
        ) : null}

        {kind !== "client" ? null : (
          <>
            <Seg
              label="Report settings"
              value={panel}
              onChange={setPanel}
              options={[
                { id: "agent", label: "✦ Agent" },
                { id: "label", label: "White label" },
                { id: "sections", label: "Sections" },
              ]}
            />

            {panel === "agent" ? (
              <section className="aw-frame flex flex-col gap-3 p-4">
                <span className="flex items-center gap-2 text-[13px]">
                  <span className={`aw-status ${data.guideline ? "aw-status--ranked" : "aw-status--pending"}`}>{data.guideline ? "Brand guideline found" : "No brand guideline"}</span>
                  {!data.guideline ? <span className="text-muted">Uses {brand.domain}</span> : null}
                </span>
                <textarea value={ask} onChange={(e) => setAsk(e.target.value)} rows={4} placeholder="Dark and premium, like a luxury brand. Big numbers. Keep our blue." aria-label="What the agent should do" className="aw-textarea text-[14px]!" />
                {canEdit ? (
                  <button type="button" className="aw-btn aw-btn--accent" onClick={design} disabled={Boolean(busy)}>
                    <AiIcon />
                    {busy === "design" ? "Designing..." : "Design in our brand style"}
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
          </>
        )}
      </aside>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {canEdit && kind === "client" ? (
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={writeSummary} disabled={Boolean(busy) || stale}>
              <AiIcon />
              {busy === "summary" ? "Writing..." : summary ? "Rewrite AI summary" : "Add AI summary"}
            </button>
          ) : null}
          <span className="ml-auto flex flex-wrap gap-2">
            {kind === "client" ? (
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={downloadHtml}>
                Download HTML
              </button>
            ) : null}
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => window.print()}>
              Download PDF
            </button>
            {canEdit ? (
              <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={share} disabled={Boolean(busy) || stale || (kind !== "client" && !quick)}>
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
        {kind === "client" ? (
          <div aria-busy={stale} className={`min-h-[80vh] min-w-0 overflow-hidden rounded-aw-lg border border-rule transition-opacity print:min-h-0 print:rounded-none print:border-0 ${stale ? "opacity-60" : ""}`} style={{ background: theme.paper }}>
            <ReportDoc r={snapshot} />
          </div>
        ) : (
          <div className="min-h-[80vh] min-w-0 overflow-hidden rounded-aw-lg border border-rule bg-white print:min-h-0 print:rounded-none print:border-0">
            {kind === "prompts" ? promptsSnap ? <PromptsDoc r={promptsSnap} /> : <Thinking text="Reading every AI answer..." /> : kind === "competitors" ? <CompetitorsDoc r={competitorsSnap} /> : <IntelDoc r={intelSnap} />}
          </div>
        )}
      </div>
    </div>
  );
}
