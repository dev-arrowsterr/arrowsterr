"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { addCalendarItems, listKeywordRuns, saveKeywordRunResult, type KeywordRun, type Site } from "@/lib/db";
import { PER_STAGE, STAGES, type AgentGroup, type AgentKeyword, type Stage } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { Card, Seg, sortRows, SortTh, Thinking, useSort } from "../ui";
import { Check, Difficulty, downloadCsv, FIELD, fmtNum, post, SerpTags, StageTag } from "./shared";

const STEPS = [
  "Checking what the site already ranks for",
  "Writing BOFU keywords",
  "Writing MOFU keywords",
  "Writing TOFU keywords",
  "Reading Google results",
  "Grouping keywords into pages",
];
const stepIndex = (step: string) => {
  if (step.startsWith("Reading Google")) return 4;
  if (step.startsWith("Grouping")) return 5;
  const s = STAGES.findIndex((x) => step.includes(x.label));
  return s >= 0 ? s + 1 : 0;
};
const STALE = 20 * 60_000;

type Page = AgentGroup & { main: AgentKeyword; others: AgentKeyword[] };

/** Claude plans 120 keywords stage by stage, DataForSEO checks them, and you approve pages into the calendar. */
export function AgenticResearch({ sb, auth, site, canEdit, onOpenCalendar }: { sb: SupabaseClient; auth: RunAuth; site: Site; canEdit: boolean; onOpenCalendar: () => void }) {
  const [runs, setRuns] = useState<KeywordRun[] | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stage, setStage] = useState<Stage | "all">("all");
  const [theme, setTheme] = useState("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sort, setSort] = useSort("volume");
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setRuns(await listKeywordRuns(sb, site.id));
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRuns([]);
    }
  }, [sb, site.id]);

  useEffect(() => {
    // Loading from Supabase on first render is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const run = runs?.find((r) => r.id === runId) ?? runs?.[0] ?? null;
  const stale = run?.status === "running" && now - new Date(run.created_at).getTime() > STALE;
  const running = run?.status === "running" && !stale;

  // While a run is working, check on it every 4 seconds.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [running, load]);

  async function start() {
    setStarting(true);
    setError("");
    setNotice("");
    try {
      const { id } = await post<{ id: string }>(auth, "/api/research/agentic", { siteId: site.id });
      setRunId(id);
      setPicked(new Set());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  if (!runs) return <Thinking text="Loading research..." />;

  const intro = (
    <section className="aw-frame">
      <div className="aw-frame__body flex flex-col gap-4">
        <h2 className="aw-h3">Plan 120 keywords for {site.domain}</h2>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[14px] text-body">
          <li>Checks what {site.domain} already ranks for, so you skip keywords you already win.</li>
          <li>
            Writes {PER_STAGE} BOFU keywords, then {PER_STAGE} MOFU, then {PER_STAGE} TOFU, fitted to a {site.profile.businessType ?? "general"} business. Each one is 2 to 5
            words.
          </li>
          <li>Checks every keyword on Google and swaps out ones nobody searches for.</li>
          <li>Groups keywords that share Google results, so each page targets one group and no two pages compete.</li>
          <li>You tick the pages you want and approve them into the content calendar.</li>
        </ol>
        <p className="aw-small">Takes about 3 to 5 minutes. Costs about $0.30 to $0.60 in DataForSEO plus one AI answer from your daily limit.</p>
        {canEdit ? (
          <div>
            <button type="button" className="aw-btn aw-btn--accent" onClick={start} disabled={starting}>
              {starting ? "Starting..." : "Start research"}
            </button>
          </div>
        ) : (
          <p className="aw-small">Ask an editor to start research.</p>
        )}
      </div>
    </section>
  );

  const history =
    runs.length > 1 ? (
      <select aria-label="Past research" value={run?.id ?? ""} onChange={(e) => setRunId(e.target.value)} className={FIELD}>
        {runs.map((r) => (
          <option key={r.id} value={r.id}>
            {new Date(r.created_at).toLocaleString()} · {r.status === "done" ? `${r.result.keywords?.length ?? 0} keywords` : r.status}
          </option>
        ))}
      </select>
    ) : null;

  if (!run) return error ? <p className="aw-error">{error}</p> : intro;

  if (running) {
    const at = stepIndex(run.step);
    return (
      <section className="aw-frame">
        <div className="aw-frame__body flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <span className="aw-think__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 1.5c.6 4.9 2.9 8.6 10.5 10.5-7.6 1.9-9.9 5.6-10.5 10.5-.6-4.9-2.9-8.6-10.5-10.5C9.1 10.1 11.4 6.4 12 1.5z" />
              </svg>
            </span>
            <span className="aw-h4" role="status" aria-live="polite">
              {run.step || "Starting"}...
            </span>
          </div>
          <ol className="flex flex-col gap-2">
            {STEPS.map((s, i) => (
              <li key={s} className={`flex items-center gap-3 text-[14px] ${i < at ? "text-ink" : i === at ? "font-medium text-brand" : "text-muted"}`}>
                <span className="w-5 text-center" aria-hidden="true">
                  {i < at ? "✓" : i === at ? "●" : "○"}
                </span>
                {s}
                <span className="sr-only">{i < at ? "done" : i === at ? "in progress" : "waiting"}</span>
              </li>
            ))}
          </ol>
          <p className="aw-small">You can leave this page. The research keeps going and shows here when it is done.</p>
        </div>
      </section>
    );
  }

  if (run.status !== "done" || stale) {
    return (
      <div className="flex flex-col gap-5">
        <div className="aw-error flex flex-wrap items-center justify-between gap-3">
          <span>{stale ? "This research stopped before it finished." : `Research failed: ${run.error ?? "unknown error"}`}</span>
          {history}
        </div>
        {intro}
      </div>
    );
  }

  const res = run.result;
  const keywords = res.keywords ?? [];
  const approved = new Set(res.approved ?? []);
  const themes = res.themes ?? [];
  const pages: Page[] = (res.groups ?? []).map((g) => {
    const ks = keywords.filter((k) => k.group === g.id);
    const main = ks.find((k) => k.keyword === g.primary) ?? ks[0];
    return { ...g, main, others: ks.filter((k) => k !== main) };
  });
  const shown = sortRows(
    pages.filter((p) => (stage === "all" || p.stage === stage) && (theme === "all" || p.theme === theme)),
    sort,
    { keyword: (p) => p.primary, stage: (p) => STAGES.findIndex((s) => s.id === p.stage), theme: (p) => p.theme, volume: (p) => p.volume, kd: (p) => p.main?.kd ?? null },
  );
  const open = shown.filter((p) => !approved.has(p.primary));
  const allOn = open.length > 0 && open.every((p) => picked.has(p.primary));
  const someOn = open.some((p) => picked.has(p.primary));
  const toggle = (k: string, on: boolean) => setPicked((s) => (on ? new Set([...s, k]) : new Set([...s].filter((x) => x !== k))));

  async function approve() {
    const list = pages.filter((p) => picked.has(p.primary) && !approved.has(p.primary));
    setError("");
    try {
      const n = await addCalendarItems(
        sb,
        auth.workspaceId,
        list.map((p) => ({
          site_id: site.id,
          keyword: p.primary,
          secondary: p.others.map((k) => k.keyword),
          stage: p.stage,
          theme: p.theme,
          volume: p.volume,
          difficulty: p.main?.kd ?? null,
          intent: p.main?.intent ?? null,
          cpc: p.main?.cpc ?? null,
          source: "agentic research",
        })),
      );
      const next = { ...res, approved: [...approved, ...list.map((p) => p.primary)] };
      await saveKeywordRunResult(sb, run!.id, next);
      setRuns(runs!.map((r) => (r.id === run!.id ? { ...r, result: next } : r)));
      setPicked(new Set());
      setNotice(`${n} ${n === 1 ? "page" : "pages"} added to the content calendar.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? <p className="aw-error">{error}</p> : null}
      {notice ? (
        <div className="aw-callout flex flex-wrap items-center justify-between gap-3">
          {notice}
          <button type="button" className="aw-text-link" onClick={onOpenCalendar}>
            Open calendar
          </button>
        </div>
      ) : null}

      <div className="aw-stats" style={{ ["--cols" as string]: 4 }}>
        {[
          { lab: "Keywords", v: fmtNum(keywords.length) },
          { lab: "Pages to write", v: fmtNum(pages.length) },
          { lab: "Monthly searches", v: fmtNum(keywords.reduce((n, k) => n + (k.volume ?? 0), 0)) },
          { lab: "Approved", v: `${approved.size} / ${pages.length}` },
        ].map((s) => (
          <div key={s.lab} className="aw-stat">
            <div className="aw-stat__lab">{s.lab}</div>
            <span className="aw-stat__num">{s.v}</span>
          </div>
        ))}
      </div>

      <Card title="Coverage map" action={<span className="aw-label">Pages per theme and stage</span>}>
        <div className="overflow-x-auto">
          <table className="aw-table aw-table--compact">
            <thead>
              <tr>
                <th>Theme</th>
                {STAGES.map((s) => (
                  <th key={s.id}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {themes.map((t) => (
                <tr key={t}>
                  <td className="text-ink">
                    <button type="button" className="aw-text-link text-left" onClick={() => setTheme(theme === t ? "all" : t)}>
                      {t}
                    </button>
                  </td>
                  {STAGES.map((s) => {
                    const n = pages.filter((p) => p.theme === t && p.stage === s.id).length;
                    return (
                      <td key={s.id} className="aw-num">
                        {n ? n : <span className="text-neg">0 · gap</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Review and approve"
        action={
          <span className="flex flex-wrap items-center gap-2">
            {history}
            <button
              type="button"
              className="aw-btn aw-btn--secondary aw-btn--sm"
              onClick={() =>
                downloadCsv(
                  `keyword-plan-${site.domain}.csv`,
                  ["page keyword", "also covers", "stage", "theme", "volume", "difficulty", "intent"],
                  pages.map((p) => [p.primary, p.others.map((k) => k.keyword).join("; "), p.stage, p.theme, p.volume, p.main?.kd, p.main?.intent]),
                )
              }
            >
              Export CSV
            </button>
            {canEdit ? (
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={start} disabled={starting}>
                Run again
              </button>
            ) : null}
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-rule-faint px-5 py-3">
          <Seg
            label="Stage"
            value={stage}
            onChange={setStage}
            options={[{ id: "all" as const, label: "All" }, ...STAGES.map((s) => ({ id: s.id, label: `${s.label} ${pages.filter((p) => p.stage === s.id).length}` }))]}
          />
          <select aria-label="Theme" value={theme} onChange={(e) => setTheme(e.target.value)} className={FIELD}>
            <option value="all">All themes</option>
            {themes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          {res.cost ? <span className="aw-label ml-auto">DataForSEO cost ${res.cost.toFixed(2)}</span> : null}
        </div>
        {picked.size && canEdit ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-rule-faint bg-brand-pale px-5 py-2.5">
            <span className="text-[13px] font-medium text-ink">{picked.size} selected</span>
            <button type="button" className="aw-btn aw-btn--accent aw-btn--sm" onClick={approve}>
              Approve to calendar
            </button>
            <button type="button" className="aw-text-link text-[13px]" onClick={() => setPicked(new Set())}>
              Clear
            </button>
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="aw-table aw-table--compact">
            <thead>
              <tr>
                <th className="w-8">
                  <Check
                    checked={allOn}
                    some={someOn}
                    disabled={!canEdit || !open.length}
                    label="Select all shown"
                    onChange={(on) => setPicked(on ? new Set([...picked, ...open.map((p) => p.primary)]) : new Set([...picked].filter((k) => !open.some((p) => p.primary === k))))}
                  />
                </th>
                <SortTh id="keyword" sort={sort} onSort={setSort} text>
                  Page keyword
                </SortTh>
                <SortTh id="stage" sort={sort} onSort={setSort} text>
                  Stage
                </SortTh>
                <SortTh id="theme" sort={sort} onSort={setSort} text>
                  Theme
                </SortTh>
                <SortTh id="volume" sort={sort} onSort={setSort}>
                  Volume
                </SortTh>
                <SortTh id="kd" sort={sort} onSort={setSort}>
                  Difficulty
                </SortTh>
                <th>On Google</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const done = approved.has(p.primary);
                return (
                  <tr key={p.id} className={picked.has(p.primary) ? "bg-brand-pale" : ""}>
                    <td>
                      <Check checked={done || picked.has(p.primary)} disabled={done || !canEdit} onChange={(on) => toggle(p.primary, on)} label={`Select ${p.primary}`} />
                    </td>
                    <td className="max-w-md">
                      <span className="flex flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-2 text-ink">
                          {p.primary}
                          {done ? <span className="aw-status aw-status--ranked">In calendar</span> : null}
                          {p.main?.lowData ? (
                            <span className="aw-status aw-status--pending" title="Google shows little or no search data for this keyword">
                              Low data
                            </span>
                          ) : null}
                        </span>
                        {p.others.length ? (
                          <span className="text-[12px] text-muted" title="These keywords share Google results with the main one, so one page covers them all">
                            Also covers: {p.others.map((k) => k.keyword).join(" · ")}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td>
                      <StageTag stage={p.stage} />
                    </td>
                    <td className="max-w-48 truncate text-[13px]">{p.theme}</td>
                    <td className="aw-num">{fmtNum(p.volume)}</td>
                    <td>
                      <Difficulty kd={p.main?.kd ?? null} />
                    </td>
                    <td>
                      <SerpTags serp={p.main?.serp ?? []} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
