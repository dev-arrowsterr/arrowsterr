"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useId, useState } from "react";
import type { Site } from "@/lib/db";
import type { BrandStat } from "@/lib/metrics";
import type { Gap, GapRow } from "@/lib/gap";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import { Sheet, type Col } from "../Sheet";
import { BookmarkIcon, Card, favicon, RIVAL_COLOR, Thinking, YOU_COLOR } from "../ui";
import { BAR_BUTTON, BAR_INPUT, Difficulty, downloadCsv, fmtNum, post } from "./shared";
import { KeywordPanel } from "./KeywordPanel";
import { addToBank } from "./TopicBank";

type Tab = "missing" | "shared" | "weaker" | "lead" | "only";
const LABEL = (them: string): Record<Tab, string> => ({
  missing: `Owned by ${them}`,
  shared: "Shared Keywords",
  weaker: "Opportunity",
  lead: "You lead",
  only: "Owned by you",
});
const rank = (n: number | null) => (n === null ? <span className="text-muted">–</span> : <span className="aw-rank">#{n}</span>);

const bare = (d: string | null | undefined) => (d ?? "").toLowerCase().replace(/^www\./, "");

/** Competitive Analysis: rivals from your AI answers and from Google, and how your keywords overlap with theirs. */
export function KeywordGap({
  sb,
  auth,
  site,
  canEdit,
  onSite,
  stats,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  site: Site;
  canEdit: boolean;
  onSite: (s: Site) => void;
  stats: BrandStat[];
}) {
  const [open, setOpen] = useState<GapRow | null>(null);
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
  // Shared keywords split by who ranks higher: an opportunity when they beat you, a lead when you beat them.
  const weaker = (gap?.shared ?? []).filter((r) => r.you !== null && r.them !== null && r.you > r.them);
  const lead = (gap?.shared ?? []).filter((r) => !weaker.includes(r));
  const lists: Record<Tab, GapRow[]> = { missing: gap?.missing ?? [], shared: gap?.shared ?? [], weaker, lead, only: gap?.only ?? [] };
  const counts: Record<Tab, number> = { missing: gap?.totals.missing ?? 0, shared: gap?.totals.shared ?? 0, weaker: weaker.length, lead: lead.length, only: gap?.totals.only ?? 0 };
  const rows = lists[tab];
  const labels = LABEL(result?.them ?? "them");

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
          <Venn
            them={result!.them}
            you={site.domain}
            counts={counts}
            tab={tab}
            onTab={(t) => {
              setTab(t);
              setPicked(new Set());
            }}
          />
          <Card
            title={labels[tab]}
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
                  <BookmarkIcon />
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

/** You vs one competitor as two circles. Each region is a button that filters the table below. */
export function Venn({ them, you, counts, tab, onTab }: { them: string; you: string; counts: Record<Tab, number>; tab: Tab; onTab: (t: Tab) => void }) {
  const id = useId().replace(/:/g, "");
  const L = LABEL(them);
  const on = (t: Tab) => tab === t || (tab === "shared" && (t === "weaker" || t === "lead"));
  const region = (t: Tab) => ({
    role: "button",
    tabIndex: 0,
    "aria-label": `${L[t]}: ${counts[t]} keywords`,
    "aria-pressed": tab === t,
    className: "cursor-pointer outline-none transition-opacity hover:opacity-80 focus-visible:opacity-80",
    onClick: () => onTab(t),
    onKeyDown: (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onTab(t)),
  });
  const fill = (color: string, t: Tab) => ({ fill: color, fillOpacity: on(t) ? 0.28 : 0.1 });
  const text = (x: number, y: number, lines: string[], n: number, color: string, size = 30) => (
    <g pointerEvents="none" textAnchor="middle">
      {lines.map((l, i) => (
        <text key={i} x={x} y={y + i * 16} fontSize="13" fill="var(--aw-body)">
          {l}
        </text>
      ))}
      <text x={x} y={y + (lines.length - 1) * 16 + size + 4} fontSize={size} fontWeight="500" fill={color}>
        {fmtNum(n)}
      </text>
    </g>
  );
  return (
    <section className="aw-frame flex flex-col">
      <div className="aw-frame__head justify-between">
        <h3 className="aw-h4">Keyword overlap</h3>
        <span className="flex items-center gap-4 text-[13px] text-body">
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: RIVAL_COLOR }} aria-hidden="true" />
            {them}
          </span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: YOU_COLOR }} aria-hidden="true" />
            {you}
          </span>
        </span>
      </div>
      <div className="flex flex-col items-center gap-2 px-4 py-5">
        <button type="button" onClick={() => onTab("shared")} aria-pressed={tab === "shared"} className={`aw-chip ${tab === "shared" ? "aw-chip--brand" : ""}`}>
          Shared Keywords <span className="aw-num">{fmtNum(counts.shared)}</span>
        </button>
        <svg viewBox="0 0 640 290" className="w-full max-w-[680px]" role="group" aria-label={`Keywords ${them} and ${you} rank for`}>
          <defs>
            <clipPath id={`${id}t`}>
              <circle cx="245" cy="145" r="135" />
            </clipPath>
            <clipPath id={`${id}y`}>
              <circle cx="395" cy="145" r="135" />
            </clipPath>
          </defs>
          <circle cx="245" cy="145" r="135" {...fill(RIVAL_COLOR, "missing")} {...region("missing")} />
          <circle cx="395" cy="145" r="135" {...fill(YOU_COLOR, "only")} {...region("only")} />
          <g clipPath={`url(#${id}t)`}>
            <g clipPath={`url(#${id}y)`}>
              <rect x="0" y="0" width="640" height="145" fill="#fff" />
              <rect x="0" y="145" width="640" height="145" fill="#fff" />
              <rect x="0" y="0" width="640" height="145" {...fill(RIVAL_COLOR, "weaker")} {...region("weaker")} />
              <rect x="0" y="145" width="640" height="145" {...fill(YOU_COLOR, "lead")} {...region("lead")} />
              <line x1="0" y1="145" x2="640" y2="145" stroke="var(--aw-rule)" pointerEvents="none" />
            </g>
          </g>
          <circle cx="245" cy="145" r="135" fill="none" stroke={RIVAL_COLOR} strokeWidth={tab === "missing" ? 2.5 : 1.5} pointerEvents="none" />
          <circle cx="395" cy="145" r="135" fill="none" stroke={YOU_COLOR} strokeWidth={tab === "only" ? 2.5 : 1.5} pointerEvents="none" />
          {text(178, 122, ["Owned by", them.length > 22 ? `${them.slice(0, 21)}…` : them], counts.missing, RIVAL_COLOR)}
          {text(462, 130, [L.only], counts.only, YOU_COLOR)}
          {text(320, 92, [L.weaker], counts.weaker, RIVAL_COLOR, 20)}
          {text(320, 182, [L.lead], counts.lead, YOU_COLOR, 20)}
        </svg>
      </div>
    </section>
  );
}
