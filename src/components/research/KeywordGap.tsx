"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useId, useState } from "react";
import { addCalendarItems, type Site } from "@/lib/db";
import { stageFromIntent } from "@/lib/research";
import type { BrandStat } from "@/lib/metrics";
import type { Gap, GapRow } from "@/lib/gap";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import { BrandLogo } from "../BrandLogo";
import { Sheet, type Col } from "../Sheet";
import { CalendarIcon, Card, favicon, RIVAL_COLOR, Thinking, YOU_COLOR } from "../ui";
import { BAR_BUTTON, BAR_INPUT, Difficulty, downloadCsv, fmtNum, KeywordLink, post } from "./shared";

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

/** A readable name from a domain: animalz.co → Animalz, the-hoth.com → The Hoth, acme.co.uk → Acme. */
export function nameFromDomain(d: string) {
  const parts = bare(d).split("/")[0].split(".");
  const base = parts.length > 2 && /^(co|com|org|net|ac|gov|edu)$/.test(parts[parts.length - 2]) ? parts[parts.length - 3] : (parts[parts.length - 2] ?? parts[0]);
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** A brand's logo and name side by side. */
const Brand = ({ name, logo, size = 16 }: { name: string; logo: string; size?: number }) => (
  <span className="inline-flex min-w-0 items-center gap-1.5">
    <BrandLogo src={logo} name={name} size={size} />
    <span className="truncate">{name}</span>
  </span>
);

/** Competitive Analysis: rivals from your AI answers and from Google, and how your keywords overlap with theirs. */
export function KeywordGap({
  sb,
  auth,
  site,
  canEdit,
  stats,
  me,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  site: Site;
  canEdit: boolean;
  stats: BrandStat[];
  /** Your brand's name and logo. */
  me: { name: string; logo?: string | null };
}) {
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
  // Brands by name and logo: the name AI answers use when there is one, else one made from the domain.
  const nameOf = (d: string) => stats.find((s) => s.domain && bare(s.domain) === bare(d))?.name ?? nameFromDomain(d);
  const themName = result ? nameOf(result.them) : "them";
  const themLogo = result ? favicon(bare(result.them)) : "";
  const myLogo = me.logo || favicon(bare(site.domain));
  const labels = LABEL(themName);

  const cols: Col<GapRow>[] = [
    { id: "keyword", label: "Keyword", type: "text", value: (r) => r.keyword, cell: (r) => <KeywordLink keyword={r.keyword} />, width: 220 },
    { id: "volume", label: "Volume", type: "number", value: (r) => r.volume },
    { id: "kd", label: "Difficulty", type: "number", value: (r) => r.kd, cell: (r) => <Difficulty kd={r.kd} /> },
    { id: "intent", label: "Intent", type: "list", value: (r) => r.intent },
    { id: "them", label: themName, head: <Brand name={themName} logo={themLogo} size={14} />, type: "number", value: (r) => r.them, cell: (r) => rank(r.them) },
    { id: "you", label: me.name, head: <Brand name={me.name} logo={myLogo} size={14} />, type: "number", value: (r) => r.you, cell: (r) => rank(r.you) },
    {
      id: "url",
      label: `${themName}'s page`,
      type: "text",
      value: (r) => r.url,
      // The whole address, wrapped onto more lines when it is long.
      cell: (r) =>
        r.url ? (
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="block max-w-sm whitespace-normal break-all" title={r.url}>
            {r.url.replace(/^https?:\/\/(www\.)?/, "")}
          </a>
        ) : (
          <span className="text-muted">–</span>
        ),
    },
  ];

  async function bank() {
    const list = rows.filter((r) => picked.has(r.keyword));
    try {
      const n = await addCalendarItems(
        sb,
        auth.workspaceId,
        list.map((r) => ({ site_id: site.id, keyword: r.keyword, secondary: [], stage: stageFromIntent(r.intent), theme: null, volume: r.volume, difficulty: r.kd, intent: r.intent, cpc: null, source: `keyword gap: ${themName}` })),
      );
      setPicked(new Set());
      setNotice(n ? `${n} added to the Content Plan.` : "Already in the Content Plan.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
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
        <span className="flex h-12 items-center gap-2 px-2 text-[15px] font-medium text-ink" title={site.domain}>
          <Brand name={me.name} logo={myLogo} size={18} />
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
                <BrandLogo src={favicon(bare(r.domain))} name={r.name} size={14} />
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
                <button key={d} type="button" title={d} className={`aw-chip ${bare(result?.them) === bare(d) ? "aw-chip--brand" : ""}`} onClick={() => run(d)} disabled={!canEdit || busy}>
                  <BrandLogo src={favicon(bare(d))} name={nameOf(d)} size={14} />
                  {nameOf(d)}
                </button>
              ))}
          </div>
        ) : null}
      </form>

      {error ? <p className="aw-error">{error}</p> : null}
      {notice ? <div className="aw-callout">{notice}</div> : null}
      {busy ? <Thinking text={`Comparing ${me.name} with ${nameOf(query)}...`} /> : null}

      {!busy && gap ? (
        <>
          <Venn
            them={themName}
            you={me.name}
            themLogo={themLogo}
            youLogo={myLogo}
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
                  downloadCsv(`keyword-gap-${site.domain}-${result!.them}-${tab}.csv`, ["keyword", "volume", "difficulty", "intent", themName, me.name, `${themName} page`], rows.map((r) => [r.keyword, r.volume, r.kd, r.intent, r.them, r.you, r.url]))
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
                  <CalendarIcon />
                  Add to Content Plan
                </button>
              </div>
            ) : null}
            <Sheet<GapRow>
              id={`gap:${site.id}:${tab}`}
              label="Keyword gap"
              rows={rows}
              cols={cols}
              rowKey={(r) => r.keyword}
              sort={{ key: "volume", desc: true }}
              selected={canEdit ? picked : undefined}
              onSelect={canEdit ? setPicked : undefined}
              pageSize={100}
              height="none"
            />
          </Card>
        </>
      ) : null}
    </div>
  );
}

/** You vs one competitor as two circles. Each region is a button that filters the table below. */
export function Venn({ them, you, themLogo, youLogo, counts, tab, onTab }: { them: string; you: string; themLogo: string; youLogo: string; counts: Record<Tab, number>; tab: Tab; onTab: (t: Tab) => void }) {
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
  // A brand's logo inside its circle, centered on x.
  const logo = (x: number, y: number, src: string, name: string) => (
    <foreignObject x={x - 14} y={y - 14} width="28" height="28" pointerEvents="none">
      <div className="flex h-7 w-7 items-center justify-center">
        <BrandLogo src={src} name={name} size={26} />
      </div>
    </foreignObject>
  );
  return (
    <section className="aw-frame flex flex-col">
      <div className="aw-frame__head justify-between">
        <h3 className="aw-h4">Keyword overlap</h3>
        <span className="flex items-center gap-4 text-[13px] text-body">
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: RIVAL_COLOR }} aria-hidden="true" />
            <Brand name={them} logo={themLogo} />
          </span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: YOU_COLOR }} aria-hidden="true" />
            <Brand name={you} logo={youLogo} />
          </span>
        </span>
      </div>
      <div className="flex flex-col items-center gap-2 px-4 py-5">
        <button type="button" onClick={() => onTab("shared")} aria-pressed={tab === "shared"} className={`aw-chip ${tab === "shared" ? "aw-chip--brand" : ""}`}>
          Shared Keywords <span className="aw-num">{fmtNum(counts.shared)}</span>
        </button>
        <svg viewBox="0 0 760 380" className="w-full max-w-[820px]" role="group" aria-label={`Keywords ${them} and ${you} rank for`}>
          <defs>
            <clipPath id={`${id}t`}>
              <circle cx="290" cy="190" r="180" />
            </clipPath>
            <clipPath id={`${id}y`}>
              <circle cx="470" cy="190" r="180" />
            </clipPath>
          </defs>
          <circle cx="290" cy="190" r="180" {...fill(RIVAL_COLOR, "missing")} {...region("missing")} />
          <circle cx="470" cy="190" r="180" {...fill(YOU_COLOR, "only")} {...region("only")} />
          <g clipPath={`url(#${id}t)`}>
            <g clipPath={`url(#${id}y)`}>
              <rect x="0" y="0" width="760" height="190" fill="#fff" />
              <rect x="0" y="190" width="760" height="190" fill="#fff" />
              <rect x="0" y="0" width="760" height="190" {...fill(RIVAL_COLOR, "weaker")} {...region("weaker")} />
              <rect x="0" y="190" width="760" height="190" {...fill(YOU_COLOR, "lead")} {...region("lead")} />
              <line x1="0" y1="190" x2="760" y2="190" stroke="var(--aw-rule)" pointerEvents="none" />
            </g>
          </g>
          <circle cx="290" cy="190" r="180" fill="none" stroke={RIVAL_COLOR} strokeWidth={tab === "missing" ? 2.5 : 1.5} pointerEvents="none" />
          <circle cx="470" cy="190" r="180" fill="none" stroke={YOU_COLOR} strokeWidth={tab === "only" ? 2.5 : 1.5} pointerEvents="none" />
          {logo(195, 128, themLogo, them)}
          {logo(565, 138, youLogo, you)}
          {text(195, 168, ["Owned by", them.length > 22 ? `${them.slice(0, 21)}…` : them], counts.missing, RIVAL_COLOR, 34)}
          {text(565, 178, [L.only], counts.only, YOU_COLOR, 34)}
          {text(380, 116, [L.weaker], counts.weaker, RIVAL_COLOR, 22)}
          {text(380, 236, [L.lead], counts.lead, YOU_COLOR, 22)}
        </svg>
      </div>
    </section>
  );
}
