"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { addSite, deleteSite, listSites, saveSite, type Brand, type Profile, type Site } from "@/lib/db";
import { BUSINESS_TYPES, COUNTRIES } from "@/lib/onboarding";
import type { RunAuth } from "@/lib/runner";
import { BrandLogo } from "../BrandLogo";
import { favicon, Thinking } from "../ui";
import { AgenticResearch } from "./AgenticResearch";
import { ContentCalendar } from "./ContentCalendar";
import { KeywordResearch } from "./KeywordResearch";
import { SearchConsole } from "./SearchConsole";
import { FIELD, post } from "./shared";

export type Tool = "keywords" | "agentic" | "calendar" | "search";
const TITLES: Record<Tool, string> = { keywords: "Keyword research", agentic: "Agentic keyword research", calendar: "Content calendar", search: "Search performance" };
/** A website to open first, set when Google sends someone back after connecting Search Console. */
export const PENDING_SITE = "arrowsterr.site.pending";
const siteKey = (ws: string) => `arrowsterr.site.${ws}`;

/** The Research section: pick a website, then use one of the tools on it. */
export function ResearchPage({
  sb,
  auth,
  brands,
  activeBrandId,
  canEdit,
  tool,
  onTool,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  brands: Brand[];
  activeBrandId: string | null;
  canEdit: boolean;
  tool: Tool;
  onTool: (t: Tool) => void;
}) {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [siteId, setSiteId] = useState<string | null>(() => {
    try {
      const pending = localStorage.getItem(PENDING_SITE);
      if (pending) {
        localStorage.removeItem(PENDING_SITE);
        localStorage.setItem(siteKey(auth.workspaceId), pending);
        return pending;
      }
      return localStorage.getItem(siteKey(auth.workspaceId));
    } catch {
      return null;
    }
  });
  const [adding, setAdding] = useState(false);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setSites(await listSites(sb, auth.workspaceId, brands, canEdit));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(/sites/.test(message) ? `${message}. Run supabase/006_research.sql in Supabase → SQL Editor.` : message);
      setSites([]);
    }
  }, [sb, auth.workspaceId, brands, canEdit]);

  useEffect(() => {
    // Loading from Supabase on first render is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const site = sites?.find((s) => s.id === siteId) ?? sites?.find((s) => s.brand_id === activeBrandId) ?? sites?.[0] ?? null;
  const pick = (id: string) => {
    setSiteId(id);
    try {
      localStorage.setItem(siteKey(auth.workspaceId), id);
    } catch {
      // Storage blocked. The choice lasts until the page reloads.
    }
  };

  async function add() {
    setBusy("Learning about the website...");
    setError("");
    try {
      const read = await post<{ domain: string; name: string; profile: Profile }>(auth, "/api/onboard", { website: domain });
      const s = await addSite(sb, { workspace_id: auth.workspaceId, domain: read.domain, name: read.name, profile: read.profile });
      setSites([...(sites ?? []), s]);
      pick(s.id);
      setAdding(false);
      setDomain("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function change(patch: Partial<Profile>) {
    if (!site) return;
    const next = { ...site, profile: { ...site.profile, ...patch } };
    setSites(sites!.map((s) => (s.id === site.id ? next : s)));
    try {
      await saveSite(sb, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove() {
    if (!site || !confirm(`Remove ${site.domain} from Research? Its keyword runs and calendar go with it.`)) return;
    try {
      await deleteSite(sb, site.id);
      setSites(sites!.filter((s) => s.id !== site.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (busy) return <Thinking text={busy} />;
  if (!sites) return <Thinking text="Loading your websites..." />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="aw-h2">{TITLES[tool]}</h1>
      </div>
      {error ? <p className="aw-error">{error}</p> : null}

      <section className="aw-frame flex flex-wrap items-center gap-3 px-4 py-3">
        {site ? <BrandLogo src={favicon(site.domain)} name={site.domain} size={20} /> : null}
        <label className="flex items-center gap-2">
          <span className="aw-label">Website</span>
          <select aria-label="Website" value={site?.id ?? ""} onChange={(e) => pick(e.target.value)} className={`${FIELD} max-w-64`}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.domain}
              </option>
            ))}
            {!sites.length ? <option value="">No websites yet</option> : null}
          </select>
        </label>
        {site ? (
          <>
            <label className="flex items-center gap-2">
              <span className="aw-label">Type</span>
              <select
                aria-label="Business type"
                value={site.profile.businessType ?? "other"}
                disabled={!canEdit}
                onChange={(e) => change({ businessType: e.target.value as Profile["businessType"] })}
                className={FIELD}
              >
                {BUSINESS_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="aw-label">Market</span>
              <select aria-label="Market" value={site.profile.country ?? "United States"} disabled={!canEdit} onChange={(e) => change({ country: e.target.value })} className={FIELD}>
                {COUNTRIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        {canEdit ? (
          <span className="ml-auto flex items-center gap-2">
            {adding ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  add();
                }}
              >
                <input autoFocus value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme.com" aria-label="Website to add" className={`${FIELD} w-44`} />
                <button type="submit" className="aw-btn aw-btn--sm" disabled={!domain.trim()}>
                  Add
                </button>
                <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setAdding(true)}>
                  + Add website
                </button>
                {site && !site.brand_id ? (
                  <button type="button" className="aw-text-link text-[13px]" onClick={remove}>
                    Remove
                  </button>
                ) : null}
              </>
            )}
          </span>
        ) : null}
      </section>

      {!site ? (
        <div className="aw-callout max-w-xl">Add a website to start your research.</div>
      ) : tool === "keywords" ? (
        <KeywordResearch key={site.id} sb={sb} auth={auth} site={site} canEdit={canEdit} />
      ) : tool === "search" ? (
        <SearchConsole key={site.id} sb={sb} auth={auth} site={site} canEdit={canEdit} />
      ) : tool === "agentic" ? (
        <AgenticResearch key={site.id} sb={sb} auth={auth} site={site} canEdit={canEdit} onOpenCalendar={() => onTool("calendar")} />
      ) : (
        <ContentCalendar key={site.id} sb={sb} auth={auth} site={site} canEdit={canEdit} onFind={() => onTool("agentic")} />
      )}
    </div>
  );
}
