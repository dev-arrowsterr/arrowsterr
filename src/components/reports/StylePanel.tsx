"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { preinit } from "react-dom";
import { FONTS, fontsUrl, TEMPLATES, themeOf, type Cards, type Font, type Hero, type ReportTheme } from "@/lib/reportTheme";
import type { ReportStyle } from "@/lib/reportTypes";
import type { RunAuth } from "@/lib/runner";
import type { BrandGuideline } from "@/lib/writerTypes";
import { Dropdown } from "../Pickers";
import { AiIcon } from "../ui";
import { errText, post } from "./reportApi";

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

/** The workspace's report style (report_styles). Every teammate and device gets it; this browser keeps a copy for a fast first paint. */
export function useReportStyle(sb: SupabaseClient, workspaceId: string, canEdit: boolean) {
  const [style, setStyleState] = useState<ReportStyle>(() => readStyle(workspaceId));
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setStyle = (patch: Partial<ReportStyle>, site?: string) => {
    const next = { ...style, ...patch };
    setStyleState(next);
    try {
      localStorage.setItem(STYLE_KEY(workspaceId), JSON.stringify(next));
    } catch {
      // Storage blocked. The workspace copy still saves.
    }
    if (!canEdit) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const { error } = await sb.from("report_styles").upsert({ workspace_id: workspaceId, style: next, ...(site ? { website: site } : {}), updated_at: new Date().toISOString() });
      setError(error ? (/report_styles/.test(error.message) ? "Run supabase/031_report_style.sql in Supabase to save the style for the whole workspace." : error.message) : "");
    }, 700);
  };

  useEffect(() => {
    let live = true;
    sb.from("report_styles")
      .select("style, website")
      .eq("workspace_id", workspaceId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!live || error) return;
        if (!data) {
          // A style made before workspace saving lived in this browser only. Copy it up once.
          const local = readStyle(workspaceId);
          if (canEdit && (local.agency || local.logo || local.footer)) sb.from("report_styles").upsert({ workspace_id: workspaceId, style: local }).then(() => {});
          return;
        }
        const saved = { ...BASE, ...(data.style as ReportStyle) };
        setStyleState({ ...saved, theme: saved.theme ?? { ...TEMPLATES[0], accent: saved.color } });
        setWebsite(data.website ?? "");
        try {
          localStorage.setItem(STYLE_KEY(workspaceId), JSON.stringify(saved));
        } catch {
          // Storage blocked.
        }
      });
    return () => {
      live = false;
    };
  }, [sb, workspaceId, canEdit]);

  return { style, setStyle, website, setWebsite, error };
}

type Brandish = { name: string; domain: string };

/** The design agent: restyles the report from a short ask and the brand's guideline. */
export function AgentPanel({ auth, brand, guideline, style, setStyle, canEdit }: { auth: RunAuth; brand: Brandish; guideline: BrandGuideline | null; style: ReportStyle; setStyle: (p: Partial<ReportStyle>) => void; canEdit: boolean }) {
  const [ask, setAsk] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const theme = themeOf(style);

  async function design() {
    setBusy(true);
    setError("");
    setWhy("");
    try {
      const g = guideline;
      const out = await post<{ theme: ReportTheme; why: string }>(auth, "/api/reports/style", {
        brand: brand.name,
        domain: brand.domain,
        ask,
        base: theme,
        guideline: g ? { summary: g.summary, voice: g.voice.tone, colors: g.colors, typography: g.typography, ui: g.ui } : null,
      });
      setStyle({ theme: out.theme, color: out.theme.accent });
      setWhy(out.why);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="aw-frame flex flex-col gap-3 p-4">
      <span className="flex items-center gap-2 text-[13px]">
        <span className={`aw-status ${guideline ? "aw-status--ranked" : "aw-status--pending"}`}>{guideline ? "Brand guideline found" : "No brand guideline"}</span>
        {!guideline ? <span className="text-muted">Uses {brand.domain}</span> : null}
      </span>
      <textarea value={ask} onChange={(e) => setAsk(e.target.value)} rows={4} placeholder="Dark and premium, like a luxury brand. Big numbers. Keep our blue." aria-label="What the agent should do" className="aw-textarea text-[14px]!" />
      {canEdit ? (
        <button type="button" className="aw-btn aw-btn--accent" onClick={design} disabled={busy}>
          <AiIcon />
          {busy ? "Designing..." : "Design in our brand style"}
        </button>
      ) : null}
      {error ? <p className="aw-error">{error}</p> : null}
      {why ? <p className="text-[13px] text-body">{why}</p> : null}
    </section>
  );
}

/** White label: the agency's name, logo, colors, fonts and footer. Hiding "Made with Arrowsterr" is on Agency. */
export function LabelPanel({
  auth,
  style,
  setStyle,
  website,
  setWebsite,
  canEdit,
  whiteLabel,
}: {
  auth: RunAuth;
  style: ReportStyle;
  setStyle: (p: Partial<ReportStyle>, site?: string) => void;
  website: string;
  setWebsite: (w: string) => void;
  canEdit: boolean;
  whiteLabel: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [learned, setLearned] = useState("");
  const [error, setError] = useState("");
  const theme = themeOf(style);
  preinit(fontsUrl(theme), { as: "style", precedence: "default" });
  const setTheme = (patch: Partial<ReportTheme>) => setStyle({ theme: { ...theme, ...patch }, color: patch.accent ?? theme.accent });

  // The white label agent: learns the agency's brand from its website, then shows the report in it.
  async function learnBrand() {
    setBusy(true);
    setError("");
    setLearned("");
    try {
      const out = await post<{ website: string; style: Partial<ReportStyle>; why: string }>(auth, "/api/reports/brand", { website });
      setStyle(out.style, out.website);
      setWebsite(out.website);
      setLearned(out.why || `Learned ${out.style.agency ?? out.website}.`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const field = "aw-input py-2! text-[14px]!";
  const color = (label: string, k: "accent" | "accent2" | "heroBg" | "heroText" | "paper" | "surface" | "ink" | "text") => (
    <label className="flex items-center justify-between gap-2 text-[13px] text-body">
      {label}
      <span className="flex items-center gap-2">
        <span className="aw-num text-[11px] text-muted">{theme[k]}</span>
        <input type="color" value={theme[k]} onChange={(e) => setTheme({ [k]: e.target.value })} disabled={!canEdit} className="h-8 w-10 cursor-pointer rounded-aw-sm border border-rule bg-white p-0.5" />
      </span>
    </label>
  );
  const fontPick = (label: string, k: "heading" | "body" | "label") => (
    <label className="flex items-center justify-between gap-2 text-[13px] text-body">
      {label}
      <Dropdown<Font> label={label} value={theme[k]} onChange={(f) => setTheme({ [k]: f })} disabled={!canEdit} className="aw-dropdown--sm w-44" options={FONTS.map((f) => ({ id: f, label: f }))} />
    </label>
  );

  return (
    <section className="aw-frame flex flex-col gap-3 p-4">
      {canEdit ? (
        <form
          className="flex flex-col gap-2 border border-brand/30 bg-brand-pale p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (website.trim()) learnBrand();
          }}
        >
          <span className="flex items-center gap-1.5 text-[14px] font-medium text-ink">
            <AiIcon />
            Learn your agency brand
          </span>
          <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="youragency.com" aria-label="Your agency's website" className={field} />
          <button type="submit" className="aw-btn aw-btn--accent aw-btn--sm" disabled={busy || !website.trim()}>
            {busy ? "Reading your site..." : "Learn my brand"}
          </button>
          {learned ? <span className="text-[12.5px] text-ink">{learned}</span> : null}
          {error ? <span className="aw-error">{error}</span> : null}
        </form>
      ) : null}
      <label className="flex flex-col gap-1 text-[13px] text-body">
        Report title
        <input value={style.title ?? ""} onChange={(e) => setStyle({ title: e.target.value })} disabled={!canEdit} placeholder="AI Visibility Report" className={field} />
      </label>
      <label className="flex flex-col gap-1 text-[13px] text-body">
        Agency name
        <input value={style.agency} onChange={(e) => setStyle({ agency: e.target.value })} disabled={!canEdit} placeholder="Perceptric" className={field} />
      </label>
      <label className="flex flex-col gap-1 text-[13px] text-body">
        Logo URL
        <input value={style.logo} onChange={(e) => setStyle({ logo: e.target.value.trim() })} disabled={!canEdit} placeholder="https://.../logo.png" className={field} />
      </label>
      <label className="flex flex-col gap-1 text-[13px] text-body">
        Footer line
        <input value={style.footer ?? ""} onChange={(e) => setStyle({ footer: e.target.value })} disabled={!canEdit} placeholder="hello@agency.com · agency.com" className={field} />
      </label>
      <label className={`flex items-center gap-2 text-[14px] ${whiteLabel ? "text-ink" : "text-muted"}`}>
        <input type="checkbox" checked={whiteLabel && Boolean(style.whiteLabel)} disabled={!canEdit || !whiteLabel} onChange={(e) => setStyle({ whiteLabel: e.target.checked })} className="h-4 w-4 accent-[var(--aw-brand)]" />
        Hide &quot;Made with Arrowsterr&quot;
        {!whiteLabel ? <span className="aw-tag ml-auto">Agency</span> : null}
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
        <Dropdown<Hero> label="Cover" value={theme.hero} onChange={(hero) => setTheme({ hero })} disabled={!canEdit} className="aw-dropdown--sm w-44" options={[{ id: "dark", label: "Dark" }, { id: "gradient", label: "Gradient" }, { id: "light", label: "Light" }, { id: "split", label: "Split" }]} />
      </label>
      <label className="flex items-center justify-between gap-2 text-[13px] text-body">
        Cards
        <Dropdown<Cards> label="Cards" value={theme.cards} onChange={(cards) => setTheme({ cards })} disabled={!canEdit} className="aw-dropdown--sm w-44" options={[{ id: "elevated", label: "Shadow" }, { id: "outline", label: "Outline" }, { id: "tinted", label: "Tinted" }, { id: "flat", label: "Flat" }]} />
      </label>
      <label className="flex items-center justify-between gap-2 text-[13px] text-body">
        Corners
        <input type="range" min={0} max={28} value={theme.radius} onChange={(e) => setTheme({ radius: Number(e.target.value) })} disabled={!canEdit} className="w-44 accent-[var(--aw-brand)]" />
      </label>
    </section>
  );
}
