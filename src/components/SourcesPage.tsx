"use client";

import { Fragment, useState } from "react";
import {
  answered,
  brandStats,
  cleanTitle,
  competitorDomains,
  domainRows,
  pageKey,
  promptRows,
  rankOf,
  typeShares,
  urlGroups,
  urlRows,
  type SourceType,
  type UrlRow,
} from "@/lib/metrics";
import { treemap } from "@/lib/treemap";
import type { RunAuth } from "@/lib/runner";
import type { View } from "@/lib/view";
import { BrandLogo } from "./BrandLogo";
import { Card, Empty, favicon, pct, Seg, sortRows, SortTh, Tip, TIPS, useSort } from "./ui";

export const TYPE_COLORS: Record<SourceType, string> = {
  You: "#0943B0",
  Competitor: "#B3241A",
  UGC: "#2E6BE0",
  Reviews: "#F5B70A",
  Editorial: "#D08A4E",
  Reference: "#28A745",
  Corporate: "#A6AEBB",
};

export function TypeTag({ type }: { type: SourceType }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-white px-2 py-0.5 text-[12px] font-medium text-body">
      <i className="inline-block h-2 w-2 rounded-full" style={{ background: TYPE_COLORS[type] }} />
      {type}
    </span>
  );
}

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

type Group = "owned" | "third" | "reviews";
const GROUPS: { id: Group; label: string; color: string; help: string }[] = [
  { id: "owned", label: "Owned", color: "#0943B0", help: "Your own site." },
  { id: "third", label: "Third-party", color: "#2B3242", help: "News, blogs, forums, reference sites and competitor sites." },
  { id: "reviews", label: "Review sites", color: "#F5B70A", help: "Review and rating sites like G2, Capterra and Trustpilot." },
];
const groupOf = (t: SourceType): Group => (t === "You" ? "owned" : t === "Reviews" ? "reviews" : "third");

/** Owned, third-party and review sites the AI answers cite: the share of each, a map of the biggest, and every site and link. */
export function SourcesPage({ view, auth }: { view: View; auth: RunAuth | null }) {
  const { brand, current, filter, days, topics, engines } = view;
  const [group, setGroup] = useState<Group>("third");
  const [list, setList] = useState<"sites" | "links">("sites");
  const [focus, setFocus] = useState<string | null>(null);
  const [sort, setSort] = useSort("used");
  const [linkSort, setLinkSort] = useSort("used");
  const [open, setOpen] = useState<Set<string>>(new Set());
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
  const groupShare = (g: Group) => shares.filter((x) => groupOf(x.type) === g).reduce((n, x) => n + x.share, 0);
  const inGroup = domains.filter((d) => groupOf(d.type) === group);
  const sites = urlGroups(urls, domains).filter((g) => groupOf(g.type) === group && (!focus || g.domain === focus));
  const links = urls.filter((u) => groupOf(u.type) === group && (!focus || u.domain === focus));
  const boxes = treemap(inGroup.slice(0, 30), (d) => d.chats);
  const notes = new Map((insights?.pages ?? []).map((p) => [pageKey(p.url), p]));
  const pickGroup = (g: Group) => {
    setGroup(g);
    setFocus(null);
  };

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
    <div className="flex flex-col gap-6">
      <h1 className="aw-h2">Sources</h1>

      {/* 1. Share bar */}
      <section className="aw-frame flex flex-col gap-3 p-5">
        <span className="aw-label">
          What AI reads when it answers
          <Tip text="Share of all links in AI answers, by kind of site." />
        </span>
        <div className="flex h-10 w-full gap-0.5 overflow-hidden" role="img" aria-label={GROUPS.map((g) => `${g.label} ${pct(groupShare(g.id))}`).join(", ")}>
          {GROUPS.filter((g) => groupShare(g.id) > 0).map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => pickGroup(g.id)}
              title={`${g.label}: ${pct(groupShare(g.id))}`}
              className={`flex h-full min-w-10 items-center justify-center px-2 text-[13px] font-medium text-white ${group === g.id ? "" : "opacity-80 hover:opacity-100"}`}
              style={{ width: `${groupShare(g.id)}%`, background: g.color, color: g.id === "reviews" ? "#1a1f2b" : "#fff" }}
            >
              {groupShare(g.id) >= 6 ? pct(groupShare(g.id)) : ""}
            </button>
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink">
          {GROUPS.map((g) => (
            <li key={g.id} className="flex items-center gap-2">
              <i className="inline-block h-3 w-3" style={{ background: g.color }} />
              {g.label}
              <b className="aw-num font-medium">{pct(groupShare(g.id))}</b>
              <Tip text={g.help} />
            </li>
          ))}
        </ul>
      </section>

      {/* 2. Tabs */}
      <div className="flex flex-wrap border-b border-rule" role="tablist" aria-label="Kind of site">
        {GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={group === g.id}
            onClick={() => pickGroup(g.id)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-5 py-3 text-[15px] ${group === g.id ? "border-ink font-medium text-ink" : "border-transparent text-body hover:text-ink"}`}
          >
            <i className="inline-block h-2.5 w-2.5" style={{ background: g.color }} />
            {g.label}
            <span className="aw-num text-[12px] text-muted">{domains.filter((d) => groupOf(d.type) === g.id).length}</span>
          </button>
        ))}
      </div>

      {/* 3. Site map */}
      {boxes.length ? (
        <section className="aw-frame">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-faint px-5 py-3">
            <span className="aw-label">
              Site map
              <Tip text="Each box is a site. Bigger boxes are cited in more AI answers. Click one to see its links." />
            </span>
            {focus ? (
              <button type="button" className="aw-text-link text-[13px]" onClick={() => setFocus(null)}>
                Show all sites
              </button>
            ) : null}
          </div>
          <div className="relative m-3 h-[340px]">
            {boxes.map(({ item: d, x, y, w, h }) => {
              const color = TYPE_COLORS[d.type];
              const on = focus === d.domain;
              const big = w > 12 && h > 18;
              return (
                <button
                  key={d.domain}
                  type="button"
                  onClick={() => {
                    setFocus(on ? null : d.domain);
                    setOpen(new Set([d.domain]));
                  }}
                  title={`${d.domain}: cited in ${d.chats} answers (${pct(d.used)})`}
                  className={`absolute flex flex-col items-start justify-between overflow-hidden border-2 border-white p-2 text-left transition-colors ${on ? "outline-2 outline-ink" : ""}`}
                  style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`, background: `${color}${on ? "40" : "1f"}` }}
                >
                  <span className="flex min-w-0 max-w-full items-center gap-1.5">
                    <BrandLogo src={favicon(d.domain)} name={d.domain} size={big ? 22 : 16} />
                    {w > 7 ? <span className={`truncate font-medium text-ink ${big ? "text-[14px]" : "text-[12px]"}`}>{d.domain}</span> : null}
                  </span>
                  {big ? <span className="aw-num text-[13px] text-ink">{pct(d.used)}</span> : null}
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <Empty>No {GROUPS.find((g) => g.id === group)!.label.toLowerCase()} sites cited in this period.</Empty>
      )}

      {/* 4. One list */}
      {boxes.length ? (
        <section className="aw-frame">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-faint px-5 py-3">
            <span className="aw-label">{focus ? `Links on ${focus}` : list === "sites" ? "Every site" : "Most cited links"}</span>
            <Seg
              label="List"
              value={list}
              onChange={setList}
              options={[
                { id: "sites", label: "By site" },
                { id: "links", label: "By link" },
              ]}
            />
          </div>
          {list === "sites" ? (
            <table className="aw-table">
              <thead>
                <tr>
                  <th className="w-10">#</th>
                  <SortTh id="domain" sort={sort} onSort={setSort} text>
                    Site
                  </SortTh>
                  <SortTh id="used" sort={sort} onSort={setSort} className="w-32">
                    Used
                    <Tip text={TIPS.used} />
                  </SortTh>
                  <SortTh id="chats" sort={sort} onSort={setSort} className="w-32">
                    Answers
                    <Tip text={TIPS.answers} />
                  </SortTh>
                  <SortTh id="pages" sort={sort} onSort={setSort} className="w-28">
                    Pages
                    <Tip text={TIPS.pages} />
                  </SortTh>
                  <th className="w-10" aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {sortRows(sites, sort, { domain: (g) => g.domain, used: (g) => g.used, chats: (g) => g.chats, pages: (g) => g.pages.length }).map((g, i) => {
                  const isOpen = open.has(g.domain);
                  return (
                    <Fragment key={g.domain}>
                      <tr className={`cursor-pointer ${g.type === "You" ? "is-you" : ""}`} onClick={() => setOpen(toggle(open, g.domain))} aria-expanded={isOpen}>
                        <td className="aw-num text-muted">{i + 1}</td>
                        <td>
                          <span className="flex items-center gap-2.5">
                            <BrandLogo src={favicon(g.domain)} name={g.domain} size={20} />
                            <span className="font-medium text-ink">{g.domain}</span>
                            {g.type === "Competitor" ? <TypeTag type="Competitor" /> : null}
                          </span>
                        </td>
                        <td className="aw-num">{pct(g.used)}</td>
                        <td className="aw-num">{g.chats}</td>
                        <td className="aw-num">{g.pages.length}</td>
                        <td className="text-muted" aria-hidden="true">
                          {isOpen ? "▴" : "▾"}
                        </td>
                      </tr>
                      {isOpen
                        ? [...g.pages]
                            .sort((x, y) => y.chats - x.chats)
                            .map((u) => <LinkRow key={u.url} u={u} note={notes.get(pageKey(u.url))} indent />)
                        : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="aw-table">
              <thead>
                <tr>
                  <th className="w-10">#</th>
                  <SortTh id="title" sort={linkSort} onSort={setLinkSort} text>
                    Link
                  </SortTh>
                  <SortTh id="used" sort={linkSort} onSort={setLinkSort} className="w-32">
                    Used
                    <Tip text="Share of AI answers that cite this link." />
                  </SortTh>
                  <SortTh id="chats" sort={linkSort} onSort={setLinkSort} className="w-32">
                    Answers
                  </SortTh>
                  <SortTh id="prompts" sort={linkSort} onSort={setLinkSort} className="w-28">
                    Prompts
                    <Tip text="How many of your prompts got an answer citing this link." />
                  </SortTh>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {sortRows(links.slice(0, 300), linkSort, { title: (u) => pageTitle(u.title, u.url), used: (u) => u.used, chats: (u) => u.chats, prompts: (u) => u.prompts.length }).map((u, i) => (
                  <LinkRow key={u.url} u={u} n={i + 1} note={notes.get(pageKey(u.url))} />
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

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
            <span className="text-[14px] text-ink">Reading your sources...</span>
          ) : insights ? (
            <>
              <p className="text-[14px] leading-relaxed text-body">{insights.summary}</p>
              <ol className="grid gap-4 lg:grid-cols-3">
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
              <span className="aw-label">Made {new Date(insights.at).toLocaleString()} · notes on your pages show in the Owned tab</span>
            </>
          ) : (
            <p className="text-[14px] text-body">
              {auth ? "Get a short read of where you stand, what to fix first, and how each of your cited pages is doing. Uses one AI answer." : "Ask an editor to make a summary. It shows here once made in this browser."}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

/** One cited link: title, address, share of answers and prompts. */
function LinkRow({ u, n, note, indent = false }: { u: UrlRow; n?: number; note?: Insights["pages"][number]; indent?: boolean }) {
  return (
    <tr className={indent ? "bg-paper" : ""}>
      <td className="aw-num text-muted">{n ?? ""}</td>
      <td>
        <span className={`flex min-w-0 flex-col gap-0.5 ${indent ? "pl-8" : ""}`}>
          <a href={u.url} target="_blank" rel="noopener noreferrer nofollow" className="max-w-xl truncate text-[14px]" title={u.url}>
            {pageTitle(u.title, u.url)} ↗
          </a>
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
            {!indent ? <BrandLogo src={favicon(u.domain)} name={u.domain} size={12} /> : null}
            <span className="max-w-xl truncate">{u.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
          </span>
          {note ? (
            <span className="flex items-start gap-2 text-[13px] text-body">
              <span className={`aw-status ${VERDICT[note.verdict]}`}>{note.verdict}</span>
              <span className="pt-0.5">{note.note}</span>
            </span>
          ) : null}
        </span>
      </td>
      <td className="aw-num">{pct(u.used)}</td>
      <td className="aw-num">{u.chats}</td>
      <td className="aw-num" title={u.prompts.join("\n")}>
        {u.prompts.length}
      </td>
      <td />
    </tr>
  );
}
