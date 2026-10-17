"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import type { Brief, Serp } from "@/lib/briefTypes";
import { getBrief, getSerp } from "@/lib/db";
import { BrandLogo } from "../BrandLogo";
import { BriefView } from "../research/BriefView";
import { SerpView } from "../research/SerpView";
import { Empty, favicon, Seg, Thinking } from "../ui";

type Tab = "serp" | "sources" | "brief";
type Research = { keyword: string; serp: Serp | null; serpAt: string | null; brief: Brief | null };

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/** The research behind an article, read-only: Google's top 10, the sources, and the brief. Empty before any research. */
export function ResearchPanel({ sb, itemId, country }: { sb: SupabaseClient; itemId: string | null; country: string }) {
  const [r, setR] = useState<Research | null | undefined>(itemId ? undefined : null);
  const [tab, setTab] = useState<Tab | null>(null);

  useEffect(() => {
    if (!itemId) return;
    let live = true;
    Promise.all([getBrief(sb, itemId).catch(() => null), getSerp(sb, itemId).catch(() => null)]).then(([b, s]) => {
      if (!live) return;
      setR({ keyword: b?.keyword ?? "", serp: s?.serp ?? b?.brief?.serp ?? null, serpAt: s?.serp_at ?? b?.brief?.at ?? null, brief: b?.brief ?? null });
    });
    return () => {
      live = false;
    };
  }, [sb, itemId]);

  if (r === undefined) return <Thinking text="Loading the research..." />;
  // Sources: the pages the brief cites, then the ones Google's AI Overview links to.
  const sources = r ? [...new Set([...(r.brief?.brief.sources ?? []), ...(r.serp?.aiOverview.cites.map((c) => c.url) ?? [])].filter((u) => /^https?:\/\//.test(u)))] : [];
  const tabs = [
    ...(r?.serp?.pages.length ? [{ id: "serp" as const, label: "Top 10" }] : []),
    ...(sources.length ? [{ id: "sources" as const, label: `Sources (${sources.length})` }] : []),
    ...(r?.brief ? [{ id: "brief" as const, label: "Brief" }] : []),
  ];
  if (!r || !tabs.length) return <Empty>No research yet.</Empty>;
  const on = tab && tabs.some((t) => t.id === tab) ? tab : tabs[0].id;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Seg label="Research" value={on} onChange={setTab} options={tabs} />
      {on === "serp" && r.serp ? (
        <SerpView serp={r.serp} at={r.serpAt} country={country} />
      ) : on === "sources" ? (
        <ul className="aw-frame flex flex-col divide-y divide-rule-faint">
          {sources.map((u) => (
            <li key={u} className="flex min-w-0 items-center gap-2 px-4 py-2.5 text-[13px]">
              <BrandLogo src={favicon(host(u))} name={host(u)} size={14} />
              <a href={u} target="_blank" rel="noopener noreferrer" className="truncate text-ink hover:underline" title={u}>
                {host(u)}
                <span className="text-muted">{u.replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "")}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : r.brief ? (
        <BriefView brief={r.brief} keyword={r.keyword} compact />
      ) : null}
    </div>
  );
}
