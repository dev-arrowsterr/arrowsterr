"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect } from "react";
import { putStash, useStash } from "@/lib/stash";
import { siteForBrand, type Site } from "@/lib/db";
import { answered, brandStats } from "@/lib/metrics";
import type { View } from "@/lib/view";
import type { RunAuth } from "@/lib/runner";
import { IndustryResearch } from "../IndustryResearch";
import { Seg, Thinking } from "../ui";
import { ContentCalendar, type Refresh } from "./ContentCalendar";
import { DomainResearch, type SeoStart } from "./DomainResearch";
import { KeywordGap } from "./KeywordGap";
import { KeywordOverview } from "./KeywordOverview";
import { AnalyzeSeo, ResearchKeyword } from "./shared";
import { ContentIntel } from "./ContentIntel";
import type { WriterAccess } from "./ContentPiece";

export type Tool = "keywords" | "domain" | "gap" | "calendar" | "intel";
const TITLES: Record<Tool, string> = {
  keywords: "Keyword Research",
  domain: "Domain Research",
  gap: "Competitive Analysis",
  calendar: "Content Plan",
  intel: "Content Intelligence",
};

/** The Research tools for the website picked in the top bar. */
export function ResearchPage({
  sb,
  auth,
  view,
  canEdit,
  tool,
  onTool,
  seoStart,
  onSeoStarted,
  onSeo,
  refresh,
  writer,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  view: View;
  canEdit: boolean;
  tool: Tool;
  onTool: (t: Tool) => void;
  seoStart?: SeoStart | null;
  onSeoStarted?: () => void;
  onSeo?: (target: string, scope: SeoStart["scope"]) => void;
  refresh?: Refresh;
  writer?: WriterAccess;
}) {
  const brand = view.brand;
  const [site, setSite] = useStash<Site | null | undefined>(`site:${brand.id}`, undefined);
  const [error, setError] = useStash(`site-error:${brand.id}`, "");
  // Competitive Analysis has two views. Outreach can open it on Audience.
  const [gapTab, setGapTab] = useStash<"keywords" | "audience">("gap-tab", "keywords");

  useEffect(() => {
    let live = true;
    siteForBrand(sb, brand, canEdit)
      .then((s) => live && setSite(s))
      .catch((e) => {
        if (!live) return;
        const message = e instanceof Error ? e.message : String(e);
        setError(/sites/.test(message) ? `${message}. Run supabase/006_research.sql in Supabase → SQL Editor.` : message);
        setSite(null);
      });
    return () => {
      live = false;
    };
  }, [sb, brand, canEdit, setSite, setError]);

  return (
    <AnalyzeSeo.Provider value={onSeo ?? null}>
    <ResearchKeyword.Provider
      value={
        site && canEdit
          ? (keyword) => {
              putStash(`kw:${site.id}:seed`, keyword);
              onTool("keywords");
            }
          : null
      }
    >
    <div className="flex flex-col gap-5">
      {/* The Content Plan draws its own header, with the view switch beside the title. */}
      {tool === "calendar" ? null : <h1 className="aw-h2">{TITLES[tool]}</h1>}
      {error ? <p className="aw-error">{error}</p> : null}
      {site === undefined ? (
        <Thinking text={`Loading ${brand.domain}...`} />
      ) : !site ? (
        error ? null : <div className="aw-callout max-w-xl">Ask an editor to open Research once for {brand.domain} to set it up.</div>
      ) : tool === "keywords" ? (
        <KeywordOverview sb={sb} auth={auth} site={site} canEdit={canEdit} />
      ) : tool === "domain" ? (
        <DomainResearch sb={sb} auth={auth} site={site} canEdit={canEdit} start={seoStart} onStarted={onSeoStarted} />
      ) : tool === "gap" ? (
        <div className="flex flex-col gap-5">
          <div className="self-start">
            <Seg
              label="Competitive Analysis view"
              value={gapTab}
              onChange={setGapTab}
              options={[
                { id: "keywords", label: "Keyword gap" },
                { id: "audience", label: "Audience" },
              ]}
            />
          </div>
          {gapTab === "audience" ? (
            <IndustryResearch key={brand.id} sb={sb} brandId={brand.id} domain={brand.domain} chats={answered(view.current, view.filter)} auth={canEdit ? auth : null} />
          ) : (
            <KeywordGap
              sb={sb}
              auth={auth}
              site={site}
              canEdit={canEdit}
              stats={brandStats(answered(view.current, view.filter), { name: brand.name, domain: brand.domain })}
              me={{ name: brand.name, logo: brand.logo }}
            />
          )}
        </div>
      ) : tool === "intel" ? (
        <ContentIntel sb={sb} auth={auth} site={site} canEdit={canEdit} brandId={brand.id} days={view.days} chats={answered(view.current, view.filter)} onPlan={() => onTool("calendar")} />
      ) : (
        <ContentCalendar sb={sb} auth={auth} site={site} canEdit={canEdit} refresh={refresh} writer={writer} onImport={() => onTool("keywords")} results={{ brandId: brand.id, brandName: brand.name, days: view.days, chats: answered(view.current, view.filter) }} onSite={setSite} />
      )}
    </div>
    </ResearchKeyword.Provider>
    </AnalyzeSeo.Provider>
  );
}
