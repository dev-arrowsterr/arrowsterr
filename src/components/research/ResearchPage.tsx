"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect } from "react";
import { useStash } from "@/lib/stash";
import { siteForBrand, type Site } from "@/lib/db";
import { answered } from "@/lib/metrics";
import type { View } from "@/lib/view";
import type { RunAuth } from "@/lib/runner";
import { Thinking } from "../ui";
import { AgenticResearch } from "./AgenticResearch";
import { ContentCalendar } from "./ContentCalendar";
import { DomainResearch } from "./DomainResearch";
import { KeywordOverview } from "./KeywordOverview";
import { Writer } from "./Writer";

export type Tool = "keywords" | "domain" | "agentic" | "calendar" | "writer";
const TITLES: Record<Tool, string> = {
  keywords: "Keyword research",
  domain: "Domain research",
  agentic: "Content planner",
  calendar: "Content calendar",
  writer: "Writer",
};

/** The Research tools for the website picked in the top bar. */
export function ResearchPage({ sb, auth, view, canEdit, tool, onTool }: { sb: SupabaseClient; auth: RunAuth; view: View; canEdit: boolean; tool: Tool; onTool: (t: Tool) => void }) {
  const brand = view.brand;
  const [site, setSite] = useStash<Site | null | undefined>(`site:${brand.id}`, undefined);
  const [error, setError] = useStash(`site-error:${brand.id}`, "");

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
    <div className="flex flex-col gap-5">
      <h1 className="aw-h2">{TITLES[tool]}</h1>
      {error ? <p className="aw-error">{error}</p> : null}
      {site === undefined ? (
        <Thinking text={`Loading ${brand.domain}...`} />
      ) : !site ? (
        error ? null : <div className="aw-callout max-w-xl">Ask an editor to open Research once for {brand.domain} to set it up.</div>
      ) : tool === "keywords" ? (
        <KeywordOverview sb={sb} auth={auth} site={site} canEdit={canEdit} />
      ) : tool === "domain" ? (
        <DomainResearch sb={sb} auth={auth} site={site} canEdit={canEdit} />
      ) : tool === "writer" ? (
        <Writer sb={sb} auth={auth} site={site} canEdit={canEdit} />
      ) : tool === "agentic" ? (
        <AgenticResearch sb={sb} auth={auth} site={site} canEdit={canEdit} onOpenCalendar={() => onTool("calendar")} />
      ) : (
        <ContentCalendar sb={sb} auth={auth} site={site} canEdit={canEdit} onFind={() => onTool("agentic")} onWrite={() => onTool("writer")} results={{ brandId: brand.id, days: view.days, chats: answered(view.current, view.filter) }} onSite={setSite} />
      )}
    </div>
  );
}
