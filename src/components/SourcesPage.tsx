"use client";

import { useState } from "react";
import {
  answered,
  brandStats,
  cleanTitle,
  competitorDomains,
  domainRows,
  pageKey,
  promptRows,
  rankOf,
  SOURCE_TYPES,
  typeShares,
  urlGroups,
  urlRows,
  type SourceType,
} from "@/lib/metrics";
import type { RunAuth } from "@/lib/runner";
import type { View } from "@/lib/view";
import { BrandLogo } from "./BrandLogo";
import { Donut, Legend } from "./Donut";
import { TYPE_COLORS, TypeTag } from "./OverviewPage";
import { Card, Empty, favicon, pct } from "./ui";

type Sort = "cited" | "az" | "za";
type Insights = {
  summary: string;
  actions: { title: string; why: string; how: string }[];
  pages: { url: string; verdict: "strong" | "okay" | "weak"; note: string }[];
  at: string;
};

const readCache = (key: string): Insights | null => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
};
const pageTitle = (title: string | null, url: string) => {
  if (title) return cleanTitle(title);
  try {
    const u = new URL(url);
    return u.pathname === "/" ? u.hostname.replace(/^www\./, "") : decodeURIComponent(u.pathname.replace(/\/+$/, "").split("/").pop() ?? "").replace(/[-_]+/g, " ");
  } catch {
    return url;
  }
};
const VERDICT: Record<string, string> = { strong: "aw-status--ranked", okay: "aw-status--pending", weak: "aw-status--missed" };

/** Every site (or page) the AI answers cite, with its type and how often it shows up. */
export function SourcesPage({ view, mode, auth }: { view: View; mode: "domains" | "urls"; auth: RunAuth | null }) {
  const { brand, current, filter, days, topics, engines } = view;
  const [type, setType] = useState<SourceType | "All">("All");
  const [sort, setSort] = useState<Sort>("cited");
  const [shut, setShut] = useState<Set<string>>(new Set());
  const [more, setMore] = useState<Set<string>>(new Set());
  const cacheKey = `arrowsterr.insights.${brand.id}.${days}`;
  const [insights, setInsights] = useState<Insights | null>(() => readCache(cacheKey));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const chats = answered(current, filter);
  if (!chats.length) return <Empty>No results in the last {days} days yet. They show up after the first check finishes, then update every day.</Empty>;
  const stats = brandStats(chats, { name: brand.name, domain: brand.domain });
  const comp = competitorDomains(stats);
  const domains = domainRows(chats, brand.domain, comp);
  const urls = urlRows(chats, brand.domain, comp);
  const shares = typeShares(domains);
  const rows = mode === "domains" ? domains : urls;
  const counts = new Map(SOURCE_TYPES.map((t) => [t, rows.filter((r) => r.type === t).length]));
  const order = <T extends { domain: string; chats: number }>(list: T[]) =>
    sort === "cited" ? list : [...list].sort((a, b) => (sort === "az" ? a.domain.localeCompare(b.domain) : b.domain.localeCompare(a.domain)));
  const notes = new Map((insights?.pages ?? []).map((p) => [pageKey(p.url), p]));

  async function analyze() {
    if (!auth) return;
    setBusy(true);
    setError("");
    try {
      const me = stats.find((s) => s.isYou)!;
      const missed = promptRows(current, topics, engines, brand.name, filter)
        .filter((r) => r.answers && !r.visibility)
        .slice(0, 8)
        .map((r) => ({ prompt: r.prompt, namedInstead: r.topBrands.slice(0, 4).map((b) => b.name) }));
      const data = {
        days,
        scores: {
          visibility: Math.round(me.visibility),
          sentiment: me.sentiment === null ? null : Math.round(me.sentiment),
          position: me.position === null ? null : Number(me.position.toFixed(1)),
          visibilityRank: rankOf(stats, "visibility"),
          topCompetitors: stats.filter((s) => !s.isYou).slice(0, 5).map((s) => ({ name: s.name, visibility: Math.round(s.visibility) })),
        },
        siteTypes: Object.fromEntries(shares.map((s) => [s.type, Math.round(s.share)])),
        topSites: domains.slice(0, 12).map((d) => ({ domain: d.domain, type: d.type, used: Math.round(d.used) })),
        ownPages: urls.filter((u) => u.type === "You").slice(0, 10).map((u) => ({ title: u.title, url: u.url, used: Math.round(u.used), prompts: u.prompts.length })),
        competitorPages: urls.filter((u) => u.type === "Competitor").slice(0, 8).map((u) => ({ title: u.title, url: u.url, used: Math.round(u.used) })),
        missedPrompts: missed,
      };
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` },
        body: JSON.stringify({ workspaceId: auth.workspaceId, brand: brand.name, domain: brand.domain, data }),
      });
      const out = await res.json().catch(() => ({ error: `The server returned ${res.status}.` }));
      if (!res.ok) throw new Error(out.error || `Error ${res.status}`);
      setInsights(out);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(out));
      } catch {
        // Storage blocked. The summary still shows until the page reloads.
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (set: Set<string>, key: string) => (set.has(key) ? new Set([...set].filter((x) => x !== key)) : new Set([...set, key]));

  return (
    <div className="flex flex-col gap-5">
      <h1 className="aw-h2">{mode === "domains" ? "Domains" : "URLs"}</h1>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {(["All", ...SOURCE_TYPES] as const).map((t) =>
                t === "All" || counts.get(t) ? (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    aria-pressed={type === t}
                    className={`flex items-center gap-1.5 border px-3 py-1.5 text-[13px] ${type === t ? "border-ink bg-ink text-white" : "border-rule bg-white text-body hover:border-ink"}`}
                  >
                    {t !== "All" ? <i className="inline-block h-2 w-2" style={{ background: TYPE_COLORS[t] }} /> : null}
                    {t}
                    <span className={`font-mono text-[11px] ${type === t ? "text-white/70" : "text-muted"}`}>{t === "All" ? rows.length : counts.get(t)}</span>
                  </button>
                ) : null,
              )}
            </div>
            <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="border border-rule bg-white px-3 py-1.5 text-[13px] text-ink">
              <option value="cited">Most cited first</option>
              <option value="az">Site name A to Z</option>
              <option value="za">Site name Z to A</option>
            </select>
          </div>

          {mode === "domains" ? (
            <div className="aw-table-wrap">
              <table className="aw-table aw-table--compact">
                <thead>
                  <tr>
                    <th className="w-8">#</th>
                    <th>Domain</th>
                    <th>Type</th>
                    <th>Used</th>
                    <th>Answers</th>
                    <th>Avg. citations</th>
                  </tr>
                </thead>
                <tbody>
                  {order(domains.filter((d) => type === "All" || d.type === type)).map((d, i) => (
                    <tr key={d.domain} className={d.type === "You" ? "is-you" : ""}>
                      <td className="aw-num text-muted">{i + 1}</td>
                      <td>
                        <a href={`https://${d.domain}`} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-2">
                          <BrandLogo src={favicon(d.domain)} name={d.domain} size={18} />
                          {d.domain}
                        </a>
                      </td>
                      <td>
                        <TypeTag type={d.type} />
                      </td>
                      <td className="aw-num">{pct(d.used)}</td>
                      <td className="aw-num">{d.chats}</td>
                      <td className="aw-num">{d.avgCitations.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {order(urlGroups(urls, domains).filter((g) => type === "All" || g.type === type)).map((g) => {
                const open = !shut.has(g.domain);
                const all = more.has(g.domain);
                return (
                  <section key={g.domain} className="aw-frame" style={g.type === "You" ? { boxShadow: "inset 2px 0 0 var(--aw-brand)" } : undefined}>
                    <button
                      type="button"
                      onClick={() => setShut(toggle(shut, g.domain))}
                      aria-expanded={open}
                      className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left hover:bg-paper"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <BrandLogo src={favicon(g.domain)} name={g.domain} size={22} />
                        <span className="truncate text-[16px] font-medium text-ink">{g.domain}</span>
                        <TypeTag type={g.type} />
                      </span>
                      <span className="flex items-center gap-6">
                        <span className="flex flex-col items-end gap-0.5">
                          <span className="aw-label">Pages</span>
                          <span className="aw-num text-[15px] text-ink">{g.pages.length}</span>
                        </span>
                        <span className="flex flex-col items-end gap-0.5">
                          <span className="aw-label">Used</span>
                          <span className="aw-num text-[15px] text-ink">{pct(g.used)}</span>
                        </span>
                        <span aria-hidden="true" className="text-muted">
                          {open ? "▴" : "▾"}
                        </span>
                      </span>
                    </button>
                    {open ? (
                      <ul className="divide-y divide-rule-faint border-t border-rule">
                        {(all ? g.pages : g.pages.slice(0, 5)).map((u) => {
                          const n = notes.get(pageKey(u.url));
                          return (
                            <li key={u.url} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3">
                              <span className="flex min-w-0 flex-1 flex-col gap-1">
                                <a href={u.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-[14px]" title={u.url}>
                                  {pageTitle(u.title, u.url)}
                                </a>
                                {n ? (
                                  <span className="flex items-start gap-2 text-[13px] text-body">
                                    <span className={`aw-status ${VERDICT[n.verdict]}`}>{n.verdict}</span>
                                    <span className="pt-0.5">{n.note}</span>
                                  </span>
                                ) : null}
                              </span>
                              <span className="flex items-center gap-6">
                                <span className="aw-num w-12 text-right text-[13px] text-ink" title="Share of answers that cite this page">
                                  {pct(u.used)}
                                </span>
                                <span className="aw-num w-20 text-right text-[12px] text-muted" title={u.prompts.join("\n")}>
                                  {u.prompts.length} {u.prompts.length === 1 ? "prompt" : "prompts"}
                                </span>
                              </span>
                            </li>
                          );
                        })}
                        {g.pages.length > 5 ? (
                          <li className="px-5 py-2.5">
                            <button type="button" className="aw-text-link" onClick={() => setMore(toggle(more, g.domain))}>
                              {all ? "Show fewer" : `Show all ${g.pages.length} pages`}
                            </button>
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5 self-start">
          <Card title="Domains by type">
            <div className="flex flex-col items-center gap-5 p-5">
              <Donut
                label="Share of citations by site type"
                slices={shares.map((s) => ({ label: s.type, value: s.share, color: TYPE_COLORS[s.type] }))}
                center={
                  <>
                    <span className="aw-num text-[24px] text-ink">{pct(shares.find((s) => s.type === "You")?.share ?? 0)}</span>
                    <span className="text-[11px] text-muted">your site</span>
                  </>
                }
              />
              <Legend slices={shares.filter((s) => s.share > 0).map((s) => ({ label: s.type, value: s.share, color: TYPE_COLORS[s.type] }))} />
            </div>
          </Card>

          <Card
            title="Executive summary"
            action={
              auth ? (
                <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={analyze} disabled={busy}>
                  {busy ? "Analyzing..." : insights ? "Refresh" : "Analyze"}
                </button>
              ) : null
            }
          >
            <div className="flex flex-col gap-4 p-5">
              {error ? <p className="aw-error">{error}</p> : null}
              {busy ? (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <span className="aw-think__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M12 1.5c.6 4.9 2.9 8.6 10.5 10.5-7.6 1.9-9.9 5.6-10.5 10.5-.6-4.9-2.9-8.6-10.5-10.5C9.1 10.1 11.4 6.4 12 1.5z" />
                    </svg>
                  </span>
                  <span className="text-[14px] text-ink">Reading your sources...</span>
                </div>
              ) : insights ? (
                <>
                  <p className="text-[14px] leading-relaxed text-body">{insights.summary}</p>
                  <ol className="flex flex-col gap-4">
                    {insights.actions.map((a, i) => (
                      <li key={a.title} className="flex gap-3">
                        <span className="aw-num flex h-6 w-6 shrink-0 items-center justify-center border border-rule text-[12px] text-ink">{i + 1}</span>
                        <span className="flex flex-col gap-1">
                          <span className="text-[14px] font-medium text-ink">{a.title}</span>
                          <span className="text-[13px] text-muted">{a.why}</span>
                          <span className="text-[13px] text-body">{a.how}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                  <span className="aw-label">Made {new Date(insights.at).toLocaleString()} · notes on your pages show in URLs</span>
                </>
              ) : (
                <p className="text-[14px] text-body">
                  {auth
                    ? "Get a short read of where you stand, what to fix first, and how each of your cited pages is doing. Uses one AI answer."
                    : "Ask an editor to make a summary. It shows here once made in this browser."}
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
