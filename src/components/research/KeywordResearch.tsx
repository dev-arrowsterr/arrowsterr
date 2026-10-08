"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";
import { addCalendarItems, type Site } from "@/lib/db";
import { stageFromIntent, type Keyword, type Stage } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { Card, Seg, sortRows, SortTh, useSort } from "../ui";
import { Check, Difficulty, downloadCsv, FIELD, fmtCpc, fmtNum, post, SerpTags, Sparkline } from "./shared";

type Mode = "ideas" | "phrase" | "related" | "site" | "ranked";
const MODES: { id: Mode; label: string; hint: string; placeholder: string }[] = [
  { id: "ideas", label: "Ideas", hint: "Keywords on the same subject, worded any way.", placeholder: "crm software" },
  { id: "phrase", label: "Contains phrase", hint: "Keywords that include your words.", placeholder: "crm software" },
  { id: "related", label: "Related", hint: "What Google lists as related searches, two levels deep.", placeholder: "crm software" },
  { id: "site", label: "For a site", hint: "Keywords that fit any website, yours or a competitor's.", placeholder: "competitor.com" },
  { id: "ranked", label: "Ranks for", hint: "Keywords a website ranks for on Google today, with its position.", placeholder: "competitor.com" },
];
const INTENTS = ["commercial", "transactional", "informational", "navigational"];

/** Search keywords any time, filter them, and send the good ones to the content calendar. */
export function KeywordResearch({ sb, auth, site, canEdit }: { sb: SupabaseClient; auth: RunAuth; site: Site; canEdit: boolean }) {
  const [mode, setMode] = useState<Mode>("ideas");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Keyword[] | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [minVol, setMinVol] = useState("");
  const [maxKd, setMaxKd] = useState("");
  const [intent, setIntent] = useState("all");
  const [maxWords, setMaxWords] = useState("all");
  const [aio, setAio] = useState(false);
  const [has, setHas] = useState("");
  const [sort, setSort] = useSort("volume");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<Stage | "auto">("auto");
  const m = MODES.find((x) => x.id === mode)!;

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const out = await post<{ rows: Keyword[]; cost: number }>(auth, "/api/research/keywords", { siteId: site.id, mode, query });
      setRows(out.rows);
      setCost(out.cost);
      setPicked(new Set());
      setSort(mode === "ranked" ? { key: "volume", desc: true } : sort);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const words = (k: string) => k.split(/\s+/).length;
  const shown = sortRows(
    (rows ?? []).filter(
      (r) =>
        (!minVol || (r.volume ?? 0) >= Number(minVol)) &&
        (!maxKd || (r.kd ?? 0) <= Number(maxKd)) &&
        (intent === "all" || r.intent === intent) &&
        (maxWords === "all" || words(r.keyword) <= Number(maxWords)) &&
        (!aio || r.serp.includes("ai_overview")) &&
        (!has.trim() || r.keyword.toLowerCase().includes(has.trim().toLowerCase())),
    ),
    sort,
    { keyword: (r) => r.keyword, volume: (r) => r.volume, kd: (r) => r.kd, cpc: (r) => r.cpc, intent: (r) => r.intent, rank: (r) => (r.rank ? -r.rank : null) },
  );
  const allOn = shown.length > 0 && shown.every((r) => picked.has(r.keyword));
  const someOn = shown.some((r) => picked.has(r.keyword));
  const toggle = (k: string, on: boolean) => setPicked((p) => (on ? new Set([...p, k]) : new Set([...p].filter((x) => x !== k))));

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
              placeholder={mode === "site" || mode === "ranked" ? site.domain : m.placeholder}
              aria-label="Keyword or domain"
              className="aw-input min-w-0 flex-1"
            />
            <button type="submit" className="aw-btn aw-btn--accent" disabled={busy || !canEdit || !query.trim()}>
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

      {rows ? (
        <Card
          title={`${fmtNum(shown.length)} of ${fmtNum(rows.length)} keywords`}
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
                    shown.map((r) => [r.keyword, r.volume, r.kd, r.cpc, r.intent, r.rank, r.url]),
                  )
                }
              >
                Export CSV
              </button>
            </span>
          }
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-rule-faint px-5 py-3">
            <input value={has} onChange={(e) => setHas(e.target.value)} placeholder="Includes words" aria-label="Includes words" className={`${FIELD} w-40`} />
            <input value={minVol} onChange={(e) => setMinVol(e.target.value.replace(/\D/g, ""))} placeholder="Min volume" aria-label="Minimum volume" className={`${FIELD} w-28`} />
            <input value={maxKd} onChange={(e) => setMaxKd(e.target.value.replace(/\D/g, ""))} placeholder="Max difficulty" aria-label="Maximum difficulty" className={`${FIELD} w-32`} />
            <select aria-label="Intent" value={intent} onChange={(e) => setIntent(e.target.value)} className={FIELD}>
              <option value="all">Any intent</option>
              {INTENTS.map((i) => (
                <option key={i} value={i}>
                  {i[0].toUpperCase() + i.slice(1)}
                </option>
              ))}
            </select>
            <select aria-label="Words" value={maxWords} onChange={(e) => setMaxWords(e.target.value)} className={FIELD}>
              <option value="all">Any length</option>
              {[2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  Up to {n} words
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-[13px] text-body">
              <Check checked={aio} onChange={setAio} label="Has AI Overview" />
              Has AI Overview
            </label>
          </div>

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

          <div className="max-h-[70vh] overflow-auto">
            <table className="aw-table aw-table--compact">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="w-8">
                    <Check
                      checked={allOn}
                      some={someOn}
                      label="Select all shown"
                      disabled={!canEdit}
                      onChange={(on) => setPicked(on ? new Set([...picked, ...shown.map((r) => r.keyword)]) : new Set([...picked].filter((k) => !shown.some((r) => r.keyword === k))))}
                    />
                  </th>
                  <SortTh id="keyword" sort={sort} onSort={setSort} text>
                    Keyword
                  </SortTh>
                  <SortTh id="volume" sort={sort} onSort={setSort}>
                    Volume
                  </SortTh>
                  <th>Trend</th>
                  <SortTh id="kd" sort={sort} onSort={setSort}>
                    Difficulty
                  </SortTh>
                  <SortTh id="cpc" sort={sort} onSort={setSort}>
                    CPC
                  </SortTh>
                  <SortTh id="intent" sort={sort} onSort={setSort} text>
                    Intent
                  </SortTh>
                  <th>On Google</th>
                  {mode === "ranked" ? (
                    <SortTh id="rank" sort={sort} onSort={setSort}>
                      Position
                    </SortTh>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 500).map((r) => (
                  <tr key={r.keyword} className={picked.has(r.keyword) ? "bg-brand-pale" : ""}>
                    <td>
                      <Check checked={picked.has(r.keyword)} onChange={(on) => toggle(r.keyword, on)} label={`Select ${r.keyword}`} disabled={!canEdit} />
                    </td>
                    <td className="text-ink">{r.keyword}</td>
                    <td className="aw-num">{fmtNum(r.volume)}</td>
                    <td>
                      <Sparkline values={r.trend} />
                    </td>
                    <td>
                      <Difficulty kd={r.kd} />
                    </td>
                    <td className="aw-num">{fmtCpc(r.cpc)}</td>
                    <td className="text-[13px] capitalize">{r.intent ?? "–"}</td>
                    <td>
                      <SerpTags serp={r.serp} />
                    </td>
                    {mode === "ranked" ? (
                      <td className="aw-num whitespace-nowrap">
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" title={r.url}>
                            #{r.rank}
                          </a>
                        ) : (
                          `#${r.rank ?? "–"}`
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
                {!shown.length ? (
                  <tr>
                    <td colSpan={9} className="aw-small">
                      No keywords match these filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
