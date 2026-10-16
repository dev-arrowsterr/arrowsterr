"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import type { Chat } from "@/lib/chats";
import { aiCites, REFRESH_DAYS, SECTIONS, type Research, type SectionId } from "@/lib/industry";
import type { RunAuth } from "@/lib/runner";
import { BrandLogo } from "./BrandLogo";
import { post } from "./research/shared";
import { favicon, Thinking, Tip } from "./ui";

const COLUMN: Record<SectionId, string> = { websites: "Website", press: "Publication", reddit: "Subreddit", social: "Account", youtube: "Channel", podcasts: "Podcast" };
const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const hostOf = (url: string | null) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
};

/**
 * Industry Research: the websites, press, subreddits, social accounts, YouTube channels and podcasts
 * the brand's audience uses (SparkToro), with how often AI cites each one.
 */
export function IndustryResearch({ sb, brandId, domain, chats, auth }: { sb: SupabaseClient; brandId: string; domain: string; chats: Chat[]; auth: RunAuth | null }) {
  const [data, setData] = useState<Research | null | undefined>(undefined);
  const [tab, setTab] = useState<SectionId>("websites");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(async () => {
    const { data: row, error: err } = await sb.from("industry_research").select("*").eq("brand_id", brandId).maybeSingle();
    if (err) {
      setError(/industry_research/.test(err.message) ? "Run supabase/039_industry_research.sql in Supabase." : err.message);
      setData(null);
      return;
    }
    setData((row as Research | null) ?? null);
    setLoadedAt(Date.now());
  }, [sb, brandId]);

  useEffect(() => {
    // Loading on open is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // While SparkToro builds the report, check back every 15 seconds.
  useEffect(() => {
    if (data?.status !== "running") return;
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [data?.status, load]);

  const start = async () => {
    if (!auth) return;
    setBusy(true);
    setError("");
    try {
      await post(auth, "/api/industry", { brandId });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const nextRefresh = data?.updated_at ? Date.parse(data.updated_at) + REFRESH_DAYS * 864e5 : 0;
  const canRefresh = Boolean(auth) && data?.status !== "running" && (data?.status !== "done" || nextRefresh <= loadedAt);
  const rows = data?.sections?.[tab] ?? [];
  const cites = rows.map((r) => aiCites(tab, r, chats));
  const showCites = cites.some((c) => c !== null);
  const showScore = rows.some((r) => r.score !== null);
  const showReach = rows.some((r) => r.reach !== null);

  return (
    <section className="aw-frame">
      <div className="aw-frame__head flex-wrap justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="aw-h4">Industry Research</h2>
          {data?.audience ? (
            <span className="aw-micro">
              {data.audience}
              {data.updated_at ? ` · updated ${date(data.updated_at)}` : ""}
            </span>
          ) : null}
        </div>
        {auth && data ? (
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={start} disabled={busy || !canRefresh} title={data.status === "done" && !canRefresh ? `Refreshes once every ${REFRESH_DAYS} days` : undefined}>
            {busy ? "Starting…" : "Refresh"}
          </button>
        ) : null}
      </div>

      {error ? <p className="aw-error mx-5 mt-4">{error}</p> : null}

      {data === undefined ? (
        <p className="aw-small px-5 py-4">Loading…</p>
      ) : !data ? (
        <div className="flex flex-col items-start gap-3 px-5 py-5">
          <p className="max-w-2xl text-[14px] text-body">The websites, press, subreddits, social accounts, YouTube channels and podcasts people who visit {domain} use, and which of them AI cites.</p>
          {auth ? (
            <button type="button" className="aw-btn aw-btn--accent" onClick={start} disabled={busy}>
              {busy ? "Starting…" : "Run Industry Research"}
            </button>
          ) : null}
        </div>
      ) : data.status === "running" && !Object.keys(data.sections ?? {}).length ? (
        <div className="p-5">
          <Thinking text="Researching your audience. This takes a few minutes." />
        </div>
      ) : data.status === "failed" && !Object.keys(data.sections ?? {}).length ? (
        <p className="aw-error mx-5 my-4">{data.error ?? "Industry Research didn't finish."}</p>
      ) : (
        <>
          <div className="flex flex-wrap border-b border-rule" role="tablist" aria-label="Audience section">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={tab === s.id}
                onClick={() => setTab(s.id)}
                className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-[14px] ${tab === s.id ? "border-ink font-medium text-ink" : "border-transparent text-body hover:text-ink"}`}
              >
                {s.label}
                <span className="aw-num text-[12px] text-muted">{data.sections?.[s.id]?.length ?? (data.status === "running" ? "…" : 0)}</span>
              </button>
            ))}
          </div>
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="aw-table">
                <thead>
                  <tr>
                    <th className="w-10">#</th>
                    <th>{COLUMN[tab]}</th>
                    {showScore ? (
                      <th className="w-36">
                        Audience
                        <Tip text="How strongly this audience uses it, from SparkToro." />
                      </th>
                    ) : null}
                    {showReach ? <th className="w-32">Reach</th> : null}
                    {showCites ? (
                      <th className="w-32">
                        AI cites
                        <Tip text="AI answers in this period that cite it." />
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const host = hostOf(r.url);
                    const c = cites[i];
                    return (
                      <tr key={r.name}>
                        <td className="aw-num text-muted">{i + 1}</td>
                        <td>
                          <span className="flex min-w-0 items-center gap-2.5">
                            {host ? <BrandLogo src={favicon(host)} name={r.name} size={18} /> : null}
                            {r.url ? (
                              <a href={r.url} target="_blank" rel="noopener noreferrer" className="aw-text-link truncate font-medium">
                                {r.name}
                              </a>
                            ) : (
                              <span className="truncate font-medium text-ink">{r.name}</span>
                            )}
                          </span>
                        </td>
                        {showScore ? <td className="aw-num">{r.score ?? "–"}</td> : null}
                        {showReach ? <td className="aw-num">{r.reach !== null ? compact(r.reach) : "–"}</td> : null}
                        {showCites ? (
                          <td className="aw-num">
                            {c ? (
                              <span className="flex items-center gap-2">
                                {c}
                                <span className="aw-status aw-status--ranked">AI cites</span>
                              </span>
                            ) : (
                              "–"
                            )}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="aw-small px-5 py-4">{data.status === "running" ? "Still loading this section." : "SparkToro found nothing for this section."}</p>
          )}
        </>
      )}
    </section>
  );
}
