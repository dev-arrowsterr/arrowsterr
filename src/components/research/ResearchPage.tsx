"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { siteForBrand, type Brand, type Site } from "@/lib/db";
import type { RunAuth } from "@/lib/runner";
import { Seg, Thinking } from "../ui";
import { AgenticResearch } from "./AgenticResearch";
import { ContentCalendar } from "./ContentCalendar";
import { KeywordOverview } from "./KeywordOverview";
import { KeywordResearch } from "./KeywordResearch";
import { SearchConsole } from "./SearchConsole";

export type Tool = "keywords" | "agentic" | "calendar" | "search";
const TITLES: Record<Tool, string> = { keywords: "Keyword research", agentic: "Agentic keyword research", calendar: "Content calendar", search: "Search performance" };

/** The Research tools for the website picked in the top bar. */
export function ResearchPage({ sb, auth, brand, canEdit, tool, onTool }: { sb: SupabaseClient; auth: RunAuth; brand: Brand; canEdit: boolean; tool: Tool; onTool: (t: Tool) => void }) {
  const [site, setSite] = useState<Site | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [kwTab, setKwTab] = useState<"overview" | "explore">("overview");

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
  }, [sb, brand, canEdit]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="aw-h2">{TITLES[tool]}</h1>
        {tool === "keywords" ? (
          <Seg
            label="Keyword tools"
            value={kwTab}
            onChange={setKwTab}
            options={[
              { id: "overview", label: "Keyword overview" },
              { id: "explore", label: "Ideas, domains & competitors" },
            ]}
          />
        ) : null}
      </div>
      {error ? <p className="aw-error">{error}</p> : null}
      {site === undefined ? (
        <Thinking text={`Loading ${brand.domain}...`} />
      ) : !site ? (
        error ? null : <div className="aw-callout max-w-xl">Ask an editor to open Research once for {brand.domain} to set it up.</div>
      ) : tool === "keywords" ? (
        kwTab === "overview" ? <KeywordOverview sb={sb} auth={auth} site={site} canEdit={canEdit} /> : <KeywordResearch sb={sb} auth={auth} site={site} canEdit={canEdit} />
      ) : tool === "search" ? (
        <SearchConsole sb={sb} auth={auth} site={site} canEdit={canEdit} />
      ) : tool === "agentic" ? (
        <AgenticResearch sb={sb} auth={auth} site={site} canEdit={canEdit} onOpenCalendar={() => onTool("calendar")} />
      ) : (
        <ContentCalendar sb={sb} auth={auth} site={site} canEdit={canEdit} onFind={() => onTool("agentic")} />
      )}
    </div>
  );
}
