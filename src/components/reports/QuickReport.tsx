"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { siteForBrand } from "@/lib/db";
import { intelRows, intelSnapshot, SAMPLE_CITED, sampleIntel } from "@/lib/intel";
import { answered, brandStats } from "@/lib/metrics";
import { citedPathsOf, type TrafficData } from "@/lib/reports";
import type { PagePerf } from "@/lib/research";
import type { CompetitorsSnapshot, PromptsSnapshot } from "@/lib/reportTypes";
import type { RunAuth } from "@/lib/runner";
import { peek } from "@/lib/stash";
import type { View } from "@/lib/view";
import { promptsSnapshot } from "../PromptsPage";
import { Thinking } from "../ui";
import { CompetitorsDoc } from "./CompetitorsDoc";
import { IntelDoc } from "./IntelDoc";
import { PromptsDoc } from "./PromptsDoc";
import { errText, post } from "./reportApi";
import { ShareReport } from "./ShareReport";
import { REPORT_COLS, type Library, type SavedReport } from "./types";

/**
 * A saved AI Visibility, Competitors or Content Intelligence report. These are built in the browser from the
 * brand and dates picked in the app, and share as frozen links.
 */
export function QuickReport({ sb, auth, view, lib, report, canEdit, onBack, onSaved }: { sb: SupabaseClient; auth: RunAuth; view: View; lib: Library; report: SavedReport; canEdit: boolean; onBack: () => void; onSaved: (r: SavedReport) => void }) {
  const { brand, current, filter, days } = view;
  const kind = report.kind;
  const [name, setName] = useState(report.name);
  const [promptsSnap, setPromptsSnap] = useState<PromptsSnapshot | null>(null);
  const [traffic, setTraffic] = useState<TrafficData | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [pages, setPages] = useState<PagePerf[] | null>(null);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const here = report.brand_id === brand.id;
  const reportBrand = lib.brands.find((b) => b.id === report.brand_id);

  const viewRef = useRef(view);
  const authRef = useRef(auth);
  useEffect(() => {
    viewRef.current = view;
    authRef.current = auth;
  });

  // The AI Visibility report reads each prompt's full answers.
  useEffect(() => {
    if (kind !== "prompts" || !here) return;
    let live = true;
    promptsSnapshot(sb, viewRef.current, viewRef.current.engines)
      .then((r) => live && setPromptsSnap(r))
      .catch((e) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [kind, here, sb, brand.id, days]);

  // Content Intelligence uses the site and its traffic.
  useEffect(() => {
    if (kind !== "intel" || !here) return;
    let live = true;
    (async () => {
      const site = await siteForBrand(sb, viewRef.current.brand, canEdit).catch(() => null);
      const t = await post<TrafficData>(authRef.current, "/api/traffic", { brandId: viewRef.current.brand.id, days }).catch(() => null);
      if (!live) return;
      setSiteId(site?.id ?? null);
      setTraffic(t);
    })();
    return () => {
      live = false;
    };
  }, [kind, here, sb, canEdit, days]);

  function rename(next: string) {
    setName(next);
    if (!canEdit || !next.trim()) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const { data, error } = await sb.from("reports").update({ name: next.trim(), updated_at: new Date().toISOString(), updated_by: lib.me }).eq("id", report.id).select(REPORT_COLS).single();
      if (error) setError(error.message);
      else onSaved(data as SavedReport);
    }, 800);
  }

  async function loadPages() {
    if (!siteId) return;
    setBusy("pages");
    setError("");
    try {
      setPages((await post<{ pages: PagePerf[] }>(auth, "/api/research/pages", { brandId: brand.id, siteId })).pages);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy("");
    }
  }

  const top = (
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      <button type="button" className="aw-btn aw-btn--ghost aw-btn--sm" onClick={onBack}>
        ← Reports
      </button>
      <span className="w-80">
        <input value={name} onChange={(e) => rename(e.target.value.slice(0, 120))} readOnly={!canEdit} aria-label="Report name" className="aw-input py-1.5! text-[15px]! font-medium" />
      </span>
      <span className="text-[13px] text-body">{reportBrand?.name}</span>
      {here ? (
        <span className="ml-auto flex flex-wrap gap-2">
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => window.print()}>
            Download PDF
          </button>
          <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={() => setSharing(true)}>
            Share
          </button>
        </span>
      ) : null}
    </div>
  );

  if (!here) {
    return (
      <div className="flex flex-col gap-4">
        {top}
        <p className="aw-callout max-w-2xl">Switch to {reportBrand?.name ?? "this report's brand"} in the brand menu to open this report.</p>
      </div>
    );
  }

  const you = { name: brand.name, domain: brand.domain };
  const chats = answered(current, filter);
  const ranked = [...brandStats(chats, you)].sort((a, b) => b.visibility - a.visibility);
  const at = new Date().toISOString();
  const competitorsSnap: CompetitorsSnapshot = {
    kind: "competitors",
    brand: { name: brand.name, domain: brand.domain, logo: brand.logo },
    days,
    at,
    rows: ranked.slice(0, 15).map((s) => ({ name: s.name, domain: s.domain, isYou: s.isYou, visibility: s.visibility, position: s.position, mentions: s.mentions })),
  };
  // Content Intelligence uses the pages that page already loaded. Until then it shows a sample.
  const realPages = pages ?? (siteId ? (peek<PagePerf[] | null>(`pages:${siteId}`) ?? null) : null);
  const intelSnap =
    kind === "intel"
      ? intelSnapshot(
          intelRows({ pages: realPages ?? sampleIntel(brand.domain), traffic: realPages ? traffic : null, cited: !realPages ? SAMPLE_CITED : chats.length ? citedPathsOf(chats, brand.domain) : null, domain: brand.domain }),
          { brand: { name: brand.name, domain: brand.domain, logo: brand.logo }, days, linked: Boolean(realPages && traffic), sample: !realPages },
        )
      : null;
  const data = kind === "prompts" ? promptsSnap : kind === "competitors" ? competitorsSnap : intelSnap;

  return (
    <div className="flex flex-col gap-4">
      {top}
      {error ? <p className="aw-error print:hidden">{error}</p> : null}
      {intelSnap?.sample ? (
        <p className="aw-callout flex flex-wrap items-center gap-3 text-[13px] print:hidden">
          Sample numbers.
          {canEdit && siteId ? (
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={loadPages} disabled={Boolean(busy)}>
              {busy === "pages" ? "Reading every page..." : `Load ${brand.domain}`}
            </button>
          ) : null}
        </p>
      ) : null}
      <div className="aw-read min-h-[80vh] min-w-0 overflow-hidden border border-rule bg-white print:min-h-0 print:border-0">
        {kind === "prompts" ? promptsSnap ? <PromptsDoc r={promptsSnap} /> : <Thinking text="Reading every AI answer..." /> : kind === "competitors" ? <CompetitorsDoc r={competitorsSnap} /> : intelSnap ? <IntelDoc r={intelSnap} /> : null}
      </div>
      {sharing ? <ShareReport sb={sb} auth={auth} reportId={report.id} live={false} limits={lib.limits} canEdit={canEdit} data={data} onClose={() => setSharing(false)} /> : null}
    </div>
  );
}
