"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import type { Chat } from "@/lib/chats";
import type { Site } from "@/lib/db";
import type { BrandStat } from "@/lib/metrics";
import type { Gap, GapRow } from "@/lib/gap";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import { Sheet, type Col } from "../Sheet";
import { Card, favicon, Thinking } from "../ui";
import { BAR_BUTTON, BAR_INPUT, Difficulty, downloadCsv, fmtNum, post } from "./shared";
import { KeywordPanel } from "./KeywordPanel";
import { addToBank } from "./TopicBank";

type Tab = "missing" | "weaker" | "shared" | "only";
const TABS: { id: Tab; label: string; tone: string }[] = [
  { id: "missing", label: "Missing", tone: "text-neg" },
  { id: "weaker", label: "Weaker", tone: "text-ink" },
  { id: "shared", label: "Shared", tone: "text-brand" },
  { id: "only", label: "Only you", tone: "text-pos" },
];
const rank = (n: number | null) => (n === null ? <span className="text-muted">–</span> : <span className="aw-rank">#{n}</span>);

const bare = (d: string | null | undefined) => (d ?? "").toLowerCase().replace(/^www\./, "");

/** Prompts where the rival is named and you are not, with their spot. */
function wins(chats: Chat[], rival: string, you: string) {
  const by = new Map<string, { prompt: string; spots: number[]; answers: number }>();
  for (const c of chats) {
    const them = c.brands.find((b) => b.name.toLowerCase() === rival.toLowerCase());
    const mine = c.brands.some((b) => b.name.toLowerCase() === you.toLowerCase());
    const row = by.get(c.prompt) ?? { prompt: c.prompt, spots: [], answers: 0 };
    row.answers += 1;
    if (them && !mine) row.spots.push(them.position);
    by.set(c.prompt, row);
  }
  return [...by.values()].filter((r) => r.spots.length).sort((a, b) => b.spots.length - a.spots.length);
}

/** Competitive Analysis: rivals from your AI answers and from Google, how they beat you in AI answers, and the keywords they rank for that you don't. */
export function KeywordGap({
  sb,
  auth,
  site,
  canEdit,
  onSite,
  stats,
  chats,
  brand,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  site: Site;
  canEdit: boolean;
  onSite: (s: Site) => void;
  stats: BrandStat[];
  chats: Chat[];
  brand: string;
}) {
  const [open, setOpen] = useState<GapRow | null>(null);
  const you = stats.find((s) => s.isYou);
  const aiRivals = stats.filter((s) => !s.isYou && s.domain && bare(s.domain) !== bare(site.domain)).slice(0, 8);
  const [rivals, setRivals] = useStash<string[] | null>(`rivals:${site.id}`, null);
  const [result, setResult] = useStash<{ gap: Gap; them: string } | null>(`gap:${site.id}`, null);
  const [query, setQuery] = useState(result?.them ?? "");
  const [tab, setTab] = useState<Tab>("missing");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (rivals || !canEdit) return;
    let live = true;
    post<{ rivals: string[] }>(auth, "/api/research/gap", { action: "rivals", siteId: site.id })
      .then((r) => live && setRivals(r.rivals))
      .catch(() => live && setRivals([]));
    return () => {
      live = false;
    };
  }, [auth, site.id, canEdit, rivals, setRivals]);

  async function run(domain: string) {
    if (!domain.trim()) return;
    setQuery(domain);
    setBusy(true);
    setError("");
    setNotice("");
    setPicked(new Set());
    try {
      const r = await post<{ gap: Gap; them: string }>(auth, "/api/research/gap", { siteId: site.id, competitor: domain });
      setResult({ gap: r.gap, them: r.them });
      setTab("missing");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const gap = result?.gap;
  const weaker = (gap?.shared ?? []).filter((r) => r.you !== null && r.them !== null && r.you > r.them);
  const lists: Record<Tab, GapRow[]> = { missing: gap?.missing ?? [], weaker, shared: gap?.shared ?? [], only: gap?.only ?? [] };
  const counts: Record<Tab, number> = { missing: gap?.totals.missing ?? 0, weaker: weaker.length, shared: gap?.totals.shared ?? 0, only: gap?.totals.only ?? 0 };
  const rows = lists[tab];
  const rival = result ? stats.find((s) => !s.isYou && bare(s.domain) === bare(result.them)) : undefined;
  const won = rival ? wins(chats, rival.name, brand) : [];

  const cols: Col<GapRow>[] = [
    { id: "keyword", label: "Keyword", type: "text", value: (r) => r.keyword, width: 280 },
    { id: "volume", label: "Volume", type: "number", value: (r) => r.volume },
    { id: "kd", label: "Difficulty", type: "number", value: (r) => r.kd, cell: (r) => <Difficulty kd={r.kd} /> },
    { id: "intent", label: "Intent", type: "list", value: (r) => r.intent },
    { id: "them", label: result?.them ?? "Them", type: "number", value: (r) => r.them, cell: (r) => rank(r.them) },
    { id: "you", label: site.domain, type: "number", value: (r) => r.you, cell: (r) => rank(r.you) },
    {
      id: "url",
      label: "Their page",
      type: "text",
      value: (r) => r.url,
      cell: (r) =>
        r.url ? (
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="block max-w-64 truncate" title={r.url}>
            {r.url.replace(/^https?:\/\/(www\.)?/, "")}
          </a>
        ) : (
          <span className="text-muted">–</span>
        ),
    },
  ];

  function bank() {
    const list = rows.filter((r) => picked.has(r.keyword));
    const n = addToBank(sb, site, onSite, list.map((r) => ({ keyword: r.keyword, volume: r.volume, kd: r.kd, intent: r.intent })), `keyword gap: ${result?.them}`);
    setPicked(new Set());
    setNotice(n ? `${n} added to the Topic Bank.` : "Already in the Topic Bank.");
  }

  return (
    <div className="flex flex-col gap-5">
      <form
        className="aw-frame flex flex-wrap items-center gap-3 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(query);
        }}
      >
        <span className="flex h-12 items-center gap-2 px-2 text-[15px] font-medium text-ink">
          <img src={favicon(site.domain)} alt="" width={18} height={18} className="rounded-[4px]" />
          {site.domain}
          <span className="text-muted">vs</span>
        </span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="competitor.com" aria-label="Competitor domain" className={BAR_INPUT} />
        <button type="submit" className={BAR_BUTTON} disabled={!canEdit || busy || !query.trim()}>
          Compare
        </button>
        {aiRivals.length ? (
          <div className="flex w-full flex-wrap items-center gap-2 px-1">
            <span className="aw-label w-24 shrink-0">In AI answers</span>
            {aiRivals.map((r) => (
              <button key={r.name} type="button" className={`aw-chip ${bare(result?.them) === bare(r.domain) ? "aw-chip--brand" : ""}`} onClick={() => run(r.domain!)} disabled={!canEdit || busy}>
                <img src={favicon(r.domain!)} alt="" width={14} height={14} className="rounded-[3px]" />
                {r.name}
                <span className="text-muted">{Math.round(r.visibility)}%</span>
              </button>
            ))}
          </div>
        ) : null}
        {rivals?.length ? (
          <div className="flex w-full flex-wrap items-center gap-2 px-1">
            <span className="aw-label w-24 shrink-0">On Google</span>
            {rivals
              .filter((d) => !aiRivals.some((r) => bare(r.domain) === bare(d)))
              .slice(0, 6)
              .map((d) => (
                <button key={d} type="button" className={`aw-chip ${bare(result?.them) === bare(d) ? "aw-chip--brand" : ""}`} onClick={() => run(d)} disabled={!canEdit || busy}>
                  <img src={favicon(d)} alt="" width={14} height={14} className="rounded-[3px]" />
                  {d}
                </button>
              ))}
          </div>
        ) : null}
      </form>

      {error ? <p className="aw-error">{error}</p> : null}
      {notice ? <div className="aw-callout">{notice}</div> : null}
      {busy ? <Thinking text={`Comparing ${site.domain} with ${query}...`} /> : null}

      {!busy && gap ? (
        <>
          {rival ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <section className="aw-frame flex flex-col">
                <div className="aw-frame__head">
                  <h3 className="aw-h4">In AI answers</h3>
                </div>
                <div className="grid grid-cols-2 gap-px bg-rule-faint">
                  {[
                    { lab: "Visibility", a: you ? `${Math.round(you.visibility)}%` : "–", b: `${Math.round(rival.visibility)}%` },
                    { lab: "Position", a: you?.position ? `#${you.position.toFixed(1)}` : "–", b: rival.position ? `#${rival.position.toFixed(1)}` : "–" },
                    { lab: "Sentiment", a: you?.sentiment !== null && you?.sentiment !== undefined ? Math.round(you.sentiment) : "–", b: rival.sentiment !== null ? Math.round(rival.sentiment) : "–" },
                    { lab: "Mentions", a: you?.mentions ?? 0, b: rival.mentions },
                  ].map((x) => (
                    <div key={x.lab} className="flex flex-col gap-1.5 bg-white px-5 py-4">
                      <span className="aw-label">{x.lab}</span>
                      <span className="flex items-baseline gap-3 text-[20px] font-medium text-ink">
                        <span className="text-brand">{x.a}</span>
                        <span className="text-[13px] text-muted">vs</span>
                        <span>{x.b}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="aw-frame flex flex-col">
                <div className="aw-frame__head">
                  <h3 className="aw-h4">Prompts {rival.name} wins</h3>
                  <span className="aw-label">{won.length}</span>
                </div>
                <ul className="max-h-64 divide-y divide-rule-faint overflow-y-auto">
                  {won.slice(0, 12).map((w) => (
                    <li key={w.prompt} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[13px]">
                      <span className="min-w-0 truncate text-ink" title={w.prompt}>
                        {w.prompt}
                      </span>
                      <span className="aw-num shrink-0 text-muted">
                        {w.spots.length} of {w.answers} · #{(w.spots.reduce((n, x) => n + x, 0) / w.spots.length).toFixed(1)}
                      </span>
                    </li>
                  ))}
                  {!won.length ? <li className="px-5 py-3 text-[13px] text-muted">–</li> : null}
                </ul>
              </section>
            </div>
          ) : null}
          <div className="aw-kpis" role="tablist" aria-label="Keyword gap">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`aw-kpi ${tab === t.id ? "is-on" : ""}`}
                onClick={() => {
                  setTab(t.id);
                  setPicked(new Set());
                }}
              >
                <span className="aw-kpi__lab">{t.label}</span>
                <span className={`aw-kpi__num ${t.tone}`}>{fmtNum(counts[t.id])}</span>
              </button>
            ))}
          </div>
          <Card
            title={`${result!.them} · ${TABS.find((t) => t.id === tab)!.label}`}
            action={
              <button
                type="button"
                className="aw-btn aw-btn--secondary aw-btn--sm"
                onClick={() =>
                  downloadCsv(`keyword-gap-${site.domain}-${result!.them}-${tab}.csv`, ["keyword", "volume", "difficulty", "intent", result!.them, site.domain, "their page"], rows.map((r) => [r.keyword, r.volume, r.kd, r.intent, r.them, r.you, r.url]))
                }
              >
                Export CSV
              </button>
            }
          >
            {picked.size && canEdit ? (
              <div className="flex flex-wrap items-center gap-3 border-b border-rule-faint bg-brand-pale px-5 py-2.5">
                <span className="text-[13px] font-medium text-ink">{picked.size} selected</span>
                <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={bank}>
                  Add to Topic Bank
                </button>
              </div>
            ) : null}
            <Sheet<GapRow>
              id={`gap:${site.id}:${tab}`}
              label="Keyword gap"
              rows={rows}
              cols={cols}
              rowKey={(r) => r.keyword}
              onOpen={setOpen}
              sort={{ key: "volume", desc: true }}
              selected={canEdit ? picked : undefined}
              onSelect={canEdit ? setPicked : undefined}
              height="60vh"
            />
          </Card>
        </>
      ) : null}
      {open ? <KeywordPanel sb={sb} auth={auth} site={site} keyword={open.keyword} seed={{ volume: open.volume, kd: open.kd, intent: open.intent }} canEdit={canEdit} onSite={onSite} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
