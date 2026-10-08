"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";
import { addCalendarItems, type Site } from "@/lib/db";
import { stageFromIntent, type Keyword, type Stage } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { BrandLogo } from "../BrandLogo";
import { Sheet } from "../Sheet";
import { Card, favicon, Seg } from "../ui";
import { Difficulty, downloadCsv, FIELD, fmtCpc, fmtNum, post, SerpTags, Sparkline } from "./shared";

type Mode = "ideas" | "phrase" | "related" | "site" | "ranked" | "competitors";
type Rival = { domain: string; shared: number; keywords: number; traffic: number };
const MODES: { id: Mode; label: string; hint: string; placeholder: string }[] = [
  { id: "ideas", label: "Ideas", hint: "Keywords on the same subject, worded any way.", placeholder: "crm software" },
  { id: "phrase", label: "Contains phrase", hint: "Keywords that include your words.", placeholder: "crm software" },
  { id: "related", label: "Related", hint: "What Google lists as related searches, two levels deep.", placeholder: "crm software" },
  { id: "site", label: "For a site", hint: "Keywords that fit any website, yours or a competitor's.", placeholder: "competitor.com" },
  { id: "ranked", label: "Ranks for", hint: "Keywords a website ranks for on Google today, with its position.", placeholder: "competitor.com" },
  { id: "competitors", label: "Competitors", hint: "Sites that rank for the most of the same keywords. Click one to see its keywords.", placeholder: "yoursite.com" },
];
const BY_DOMAIN: Mode[] = ["site", "ranked", "competitors"];

/** Search keywords any time, filter them, and send the good ones to the content calendar. */
export function KeywordResearch({ sb, auth, site, canEdit }: { sb: SupabaseClient; auth: RunAuth; site: Site; canEdit: boolean }) {
  const [mode, setMode] = useState<Mode>("ideas");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Keyword[] | null>(null);
  const [rivals, setRivals] = useState<Rival[] | null>(null);
  const [shownMode, setShownMode] = useState<Mode>("ideas");
  const [cost, setCost] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<Stage | "auto">("auto");
  const m = MODES.find((x) => x.id === mode)!;

  async function run(m: Mode, q: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const out = await post<{ rows?: Keyword[]; competitors?: Rival[]; cost: number }>(auth, "/api/research/keywords", { siteId: site.id, mode: m, query: q });
      setCost(out.cost);
      setShownMode(m);
      setPicked(new Set());
      if (m === "competitors") {
        setRivals(out.competitors ?? []);
        setRows(null);
      } else {
        setRows(out.rows ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  function search(e: React.FormEvent) {
    e.preventDefault();
    run(mode, query.trim() || (BY_DOMAIN.includes(mode) ? site.domain : ""));
  }
  function openRival(domain: string) {
    setMode("ranked");
    setQuery(domain);
    run("ranked", domain);
  }

  async function addToCalendar() {
    const list = (rows ?? []).filter((r) => picked.has(r.keyword));
    setError("");
    try {
      const n = await addCalendarItems(
        sb,
        auth.workspaceId,
        list.map((r) => ({
          site_id: site.id,
          keyword: r.keyword,
          secondary: [],
          stage: stage === "auto" ? stageFromIntent(r.intent) : stage,
          theme: null,
          volume: r.volume,
          difficulty: r.kd,
          intent: r.intent,
          cpc: r.cpc,
          source: "keyword research",
        })),
      );
      setNotice(`${n} added to the content calendar.${n < list.length ? ` ${list.length - n} were already on it.` : ""}`);
      setPicked(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="aw-frame">
        <div className="flex flex-col gap-4 p-5">
          <Seg label="Search type" value={mode} onChange={setMode} options={MODES.map((x) => ({ id: x.id, label: x.label }))} />
          <form onSubmit={search} className="flex flex-wrap items-center gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={BY_DOMAIN.includes(mode) ? site.domain : m.placeholder}
              aria-label="Keyword or domain"
              className="aw-input min-w-0 flex-1"
            />
            <button type="submit" className="aw-btn aw-btn--accent" disabled={busy || !canEdit || (!query.trim() && !BY_DOMAIN.includes(mode))}>
              {busy ? "Searching..." : "Search"}
            </button>
          </form>
          <p className="aw-small">
            {m.hint} Numbers are for {site.profile.country || "United States"}.{!canEdit ? " Ask an editor to run searches." : ""}
          </p>
        </div>
      </section>

      {error ? <p className="aw-error">{error}</p> : null}
      {notice ? <div className="aw-callout">{notice}</div> : null}

      {rivals && shownMode === "competitors" ? (
        <Card title={`${rivals.length} competitors on Google`} action={cost !== null ? <span className="aw-label">Cost ${cost.toFixed(3)}</span> : null}>
          <Sheet
            label="Competitors"
            rows={rivals}
            rowKey={(r) => r.domain}
            sort={{ key: "shared", desc: true }}
            cols={[
              {
                id: "domain",
                label: "Competitor",
                type: "text",
                value: (r) => r.domain,
                cell: (r) => (
                  <span className="flex items-center gap-2">
                    <BrandLogo src={favicon(r.domain)} name={r.domain} size={16} />
                    {r.domain}
                  </span>
                ),
              },
              { id: "shared", label: "Shared keywords", type: "number", value: (r) => r.shared },
              { id: "keywords", label: "All keywords", type: "number", value: (r) => r.keywords },
              { id: "traffic", label: "Est. visits / mo", type: "number", value: (r) => r.traffic },
              {
                id: "go",
                label: "Keywords",
                type: "text",
                value: () => "",
                cell: (r) => (
                  <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => openRival(r.domain)} disabled={!canEdit || busy}>
                    See keywords
                  </button>
                ),
              },
            ]}
          />
        </Card>
      ) : null}

      {rows && shownMode !== "competitors" ? (
        <Card
          title={`${fmtNum(rows.length)} keywords`}
          action={
            <span className="flex items-center gap-3">
              {cost !== null ? <span className="aw-label">Cost ${cost.toFixed(3)}</span> : null}
              <button
                type="button"
                className="aw-btn aw-btn--secondary aw-btn--sm"
                onClick={() =>
                  downloadCsv(
                    `keywords-${query.replace(/\W+/g, "-")}.csv`,
                    ["keyword", "volume", "difficulty", "cpc", "intent", "rank", "url"],
                    rows.map((r) => [r.keyword, r.volume, r.kd, r.cpc, r.intent, r.rank, r.url]),
                  )
                }
              >
                Export CSV
              </button>
            </span>
          }
        >
          {picked.size && canEdit ? (
            <div className="flex flex-wrap items-center gap-3 border-b border-rule-faint bg-brand-pale px-5 py-2.5">
              <span className="text-[13px] font-medium text-ink">{picked.size} selected</span>
              <select aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value as Stage | "auto")} className={FIELD}>
                <option value="auto">Stage from intent</option>
                <option value="bofu">BOFU</option>
                <option value="mofu">MOFU</option>
                <option value="tofu">TOFU</option>
              </select>
              <button type="button" className="aw-btn aw-btn--sm" onClick={addToCalendar}>
                Add to calendar
              </button>
              <button type="button" className="aw-text-link text-[13px]" onClick={() => setPicked(new Set())}>
                Clear
              </button>
            </div>
          ) : null}
          <Sheet
            label="Keywords"
            rows={rows}
            rowKey={(r) => r.keyword}
            sort={{ key: "volume", desc: true }}
            selected={canEdit ? picked : undefined}
            onSelect={canEdit ? setPicked : undefined}
            cols={[
              { id: "keyword", label: "Keyword", type: "text", value: (r) => r.keyword, width: 220 },
              { id: "volume", label: "Volume", type: "number", value: (r) => r.volume },
              { id: "trend", label: "Trend", type: "number", value: (r) => (r.trend.length > 1 ? r.trend[r.trend.length - 1] - r.trend[0] : null), cell: (r) => <Sparkline values={r.trend} /> },
              { id: "kd", label: "Difficulty", type: "number", value: (r) => r.kd, cell: (r) => <Difficulty kd={r.kd} /> },
              { id: "cpc", label: "CPC", type: "number", value: (r) => r.cpc, cell: (r) => fmtCpc(r.cpc) },
              { id: "intent", label: "Intent", type: "list", value: (r) => r.intent },
              { id: "words", label: "Words", type: "number", value: (r) => r.keyword.split(/\s+/).length },
              { id: "aio", label: "AI Overview", type: "list", value: (r) => (r.serp.includes("ai_overview") ? "Yes" : "No"), options: ["Yes", "No"] },
              { id: "serp", label: "On Google", type: "text", value: (r) => r.serp.join(" "), cell: (r) => <SerpTags serp={r.serp} /> },
              ...(shownMode === "ranked"
                ? [
                    {
                      id: "rank",
                      label: "Position",
                      type: "number" as const,
                      value: (r: Keyword) => r.rank,
                      cell: (r: Keyword) =>
                        r.url ? (
                          <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" title={r.url}>
                            #{r.rank}
                          </a>
                        ) : (
                          `#${r.rank ?? "–"}`
                        ),
                    },
                    { id: "url", label: "Ranking page", type: "text" as const, value: (r: Keyword) => r.url?.replace(/^https?:\/\/(www\.)?/, "") ?? null },
                  ]
                : []),
            ]}
          />
        </Card>
      ) : null}
    </div>
  );
}
