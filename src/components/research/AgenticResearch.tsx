"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { addCalendarItems, listKeywordRuns, saveKeywordRunResult, type KeywordRun, type Site } from "@/lib/db";
import { slots, STAGES, type Stage } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import { Sheet, type Col } from "../Sheet";
import { Card, Thinking } from "../ui";
import { AiBar } from "./AiBar";
import { Difficulty, downloadCsv, FIELD, fmtCpc, fmtNum, STAGE_LABEL, StageTag } from "./shared";

const STEPS = [
  "Reading the sitemap",
  "Checking what the site already ranks for",
  "Finding competitors and their keywords",
  "Writing BOFU keywords",
  "Writing MOFU keywords",
  "Writing TOFU keywords",
  "Checking existing articles",
  "Reading Google results",
  "Grouping keywords into pages",
];
const stepIndex = (step: string) => {
  const fixed = ["Reading the sitemap", "Checking what the site", "Finding competitors"].findIndex((x) => step.startsWith(x));
  if (fixed >= 0) return fixed;
  if (step.startsWith("Checking") && step.includes("existing articles")) return 6;
  if (step.startsWith("Reading Google")) return 7;
  if (step.startsWith("Grouping")) return 8;
  const s = STAGES.findIndex((x) => step.includes(x.label));
  return s >= 0 ? s + 3 : 0;
};
const STALE = 20 * 60_000;

/** One row of the plan: a new page to write, or an existing page to improve. */
type Row = {
  key: string;
  action: "new" | "update";
  keyword: string;
  others: string[];
  stage: Stage;
  theme: string;
  volume: number | null;
  kd: number | null;
  cpc: number | null;
  intent: string | null;
  serp: string[];
  source: string;
  url: string | null;
  rank: number | null;
  lowData: boolean;
};

const STAGE_RANK: Record<Stage, number> = { bofu: 0, mofu: 1, tofu: 2 };

/** The content plan: Claude plans keywords stage by stage, DataForSEO checks them, and you approve pages into the calendar. */
export function AgenticResearch({
  sb,
  auth,
  site,
  canEdit,
  onOpenCalendar,
  onNew,
  onApproved,
  latest,
  refresh,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  site: Site;
  canEdit: boolean;
  onOpenCalendar: () => void;
  onNew: () => void;
  onApproved: () => void;
  latest: string | null; // the last due date already on the calendar
  refresh: number; // bumps when a new plan starts
}) {
  const [runs, setRuns] = useStash<KeywordRun[] | null>(`agentic:${site.id}:runs`, null);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setRuns(await listKeywordRuns(sb, site.id));
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRuns([]);
    }
  }, [sb, site.id, setRuns]);

  useEffect(() => {
    // Loading from Supabase on first render, and again when a new plan starts, is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    setRunId(null);
  }, [load, refresh]);

  const run = runs?.find((r) => r.id === runId) ?? runs?.[0] ?? null;
  const stale = run?.status === "running" && now - new Date(run.created_at).getTime() > STALE;
  const running = run?.status === "running" && !stale;

  // While a run is working, check on it every 4 seconds.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [running, load]);

  if (!runs) return <Thinking text="Loading your plan..." />;

  const intro = (
    <section className="aw-frame flex flex-col items-start gap-4 p-8">
      <h2 className="aw-h3">Content plan for {site.domain}</h2>
      {canEdit ? (
        <button type="button" className="aw-btn aw-btn--accent" onClick={onNew}>
          Generate content plan
        </button>
      ) : null}
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
  const rows: Row[] = [
    ...(res.groups ?? []).map((g): Row => {
      const ks = keywords.filter((k) => k.group === g.id);
      const main = ks.find((k) => k.keyword === g.primary) ?? ks[0];
      return {
        key: g.primary,
        action: "new",
        keyword: g.primary,
        others: ks.filter((k) => k !== main).map((k) => k.keyword),
        stage: g.stage,
        theme: g.theme,
        volume: g.volume,
        kd: main?.kd ?? null,
        cpc: main?.cpc ?? null,
        intent: main?.intent ?? null,
        serp: main?.serp ?? [],
        source: ks.find((k) => k.competitor)?.competitor ? `Competitor: ${ks.find((k) => k.competitor)!.competitor}` : "AI idea",
        url: null,
        rank: null,
        lowData: Boolean(main?.lowData),
      };
    }),
    ...(res.updates ?? []).map(
      (u): Row => ({
        key: `update:${u.page}`,
        action: "update",
        keyword: u.keyword,
        others: [],
        stage: u.stage,
        theme: u.theme,
        volume: u.volume,
        kd: u.kd,
        cpc: u.cpc,
        intent: u.intent,
        serp: u.serp,
        source: "Your sitemap",
        url: u.page,
        rank: u.rank ?? null,
        lowData: false,
      }),
    ),
  ];
  const pageCount = rows.filter((r) => r.action === "new").length;
  const updateCount = rows.length - pageCount;
  const totalVolume = rows.reduce((n, r) => n + (r.volume ?? 0), 0);
  const byTheme = themes
    .map((t) => ({ t, v: rows.filter((r) => r.theme === t).reduce((n, r) => n + (r.volume ?? 0), 0) }))
    .sort((a, b) => b.v - a.v);
  const quick = rows
    .filter((r) => r.action === "new" && r.stage === "bofu" && (r.volume ?? 0) > 0 && (r.kd ?? 100) <= 30)
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, 3);
  const fromRivals = keywords.filter((k) => k.competitor).length;
  const summary = [
    `${fmtNum(pageCount)} new pages to write and ${fmtNum(updateCount)} pages to update, worth about ${fmtNum(totalVolume)} searches a month.`,
    byTheme.length ? `Biggest themes: ${byTheme.slice(0, 3).map((x) => `${x.t} (${fmtNum(x.v)})`).join(", ")}.` : "",
    quick.length ? `Start with these easy ready-to-buy pages: ${quick.map((r) => `"${r.keyword}"`).join(", ")}.` : "",
    updateCount ? `${fmtNum(updateCount)} of your articles sit below the top 10. Updating them is often faster than writing new ones.` : "",
    fromRivals ? `${fmtNum(fromRivals)} keywords are ones your competitors${res.competitors?.length ? ` like ${res.competitors.slice(0, 2).map((c) => c.domain).join(" and ")}` : ""} already rank for.` : "",
    `${approved.size} of ${rows.length} rows are on your calendar.`,
  ].filter(Boolean);

  async function approve(keys: Set<string> = picked) {
    const list = rows
      .filter((r) => keys.has(r.key) && !approved.has(r.key))
      .sort((a, b) => STAGE_RANK[a.stage] - STAGE_RANK[b.stage] || (b.volume ?? 0) - (a.volume ?? 0));
    // Spread approved pages over the calendar at the pace picked in the questionnaire, after what is already planned.
    const brief = res.brief;
    const from = (() => {
      const want = brief?.start ? new Date(`${brief.start}T00:00:00`) : new Date();
      if (!latest) return want;
      const after = new Date(`${latest}T00:00:00`);
      after.setDate(after.getDate() + 1);
      return after > want ? after : want;
    })();
    const dates = brief?.perWeek ? slots(from, brief.perWeek, list.length) : [];
    setError("");
    try {
      const n = await addCalendarItems(
        sb,
        auth.workspaceId,
        list.map((r, n) => ({
          site_id: site.id,
          due_date: dates[n] ?? null,
          keyword: r.keyword,
          secondary: r.others,
          stage: r.stage,
          theme: r.theme,
          volume: r.volume,
          difficulty: r.kd,
          intent: r.intent,
          cpc: r.cpc,
          source: r.source === "AI idea" ? "agentic research" : r.source.toLowerCase(),
          action: r.action,
          current_url: r.url,
          current_rank: r.rank,
        })),
      );
      const next = { ...res, approved: [...approved, ...list.map((r) => r.key)] };
      await saveKeywordRunResult(sb, run!.id, next);
      setRuns(runs!.map((x) => (x.id === run!.id ? { ...x, result: next } : x)));
      setPicked(new Set());
      setNotice(`${n} added to the calendar${dates.length ? `, ${brief!.perWeek} a week from ${new Date(`${dates[0]}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}.${n < list.length ? ` ${list.length - n} were already on it.` : ""}`);
      onApproved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const cols: Col<Row>[] = [
    {
      id: "keyword",
      label: "Keyword",
      type: "text",
      value: (r) => r.keyword,
      width: 220,
      cell: (r) => (
        <span className="flex items-center gap-2 text-ink">
          {r.keyword}
          {r.lowData ? (
            <span className="aw-status aw-status--pending" title="Google shows little or no search data for this keyword">
              Low data
            </span>
          ) : null}
        </span>
      ),
    },
    { id: "action", label: "Job", type: "list", value: (r) => (r.action === "update" ? "Update page" : "New page"), options: ["New page", "Update page"] },
    { id: "stage", label: "Stage", type: "list", value: (r) => STAGE_LABEL[r.stage], options: ["BOFU", "MOFU", "TOFU"], cell: (r) => <StageTag stage={r.stage} /> },
    { id: "theme", label: "Theme", type: "list", value: (r) => r.theme, options: themes },
    { id: "volume", label: "Volume", type: "number", value: (r) => r.volume },
    { id: "kd", label: "Difficulty", type: "number", value: (r) => r.kd, cell: (r) => <Difficulty kd={r.kd} /> },
    { id: "cpc", label: "CPC", type: "number", value: (r) => r.cpc, cell: (r) => fmtCpc(r.cpc) },
    { id: "intent", label: "Intent", type: "list", value: (r) => r.intent },
    { id: "aio", label: "AI Overview", type: "list", value: (r) => (r.serp.includes("ai_overview") ? "Yes" : "No"), options: ["Yes", "No"] },
    { id: "source", label: "Source", type: "list", value: (r) => r.source },
    {
      id: "url",
      label: "Existing page",
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
    { id: "rank", label: "Now ranks", type: "number", value: (r) => r.rank, cell: (r) => (r.rank ? `#${r.rank}` : r.action === "update" ? "Not in top 100" : <span className="text-muted">–</span>) },
    { id: "also", label: "Also covers", type: "text", value: (r) => r.others.join(", "), cell: (r) => <span className="block max-w-72 truncate" title={r.others.join("\n")}>{r.others.join(" · ") || "–"}</span> },
    {
      id: "cal",
      label: "Calendar",
      type: "list",
      value: (r) => (approved.has(r.key) ? "Added" : "Not yet"),
      options: ["Added", "Not yet"],
      cell: (r) => (approved.has(r.key) ? <span className="aw-status aw-status--ranked">Added</span> : <span className="text-muted">Not yet</span>),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {error ? <p className="aw-error">{error}</p> : null}
      {notice ? (
        <div className="aw-callout flex flex-wrap items-center justify-between gap-3">
          {notice}
          <button type="button" className="aw-text-link" onClick={onOpenCalendar}>
            View calendar
          </button>
        </div>
      ) : null}

      <div className="aw-stats" style={{ ["--cols" as string]: 4 }}>
        {[
          { lab: "New keywords", v: fmtNum(keywords.length) },
          { lab: "New pages to write", v: fmtNum(pageCount) },
          { lab: "Pages to update", v: fmtNum(updateCount) },
          { lab: "Added to calendar", v: `${approved.size} / ${rows.length}` },
        ].map((x) => (
          <div key={x.lab} className="aw-stat">
            <div className="aw-stat__lab">{x.lab}</div>
            <span className="aw-stat__num">{x.v}</span>
          </div>
        ))}
      </div>

      <Card title="Plan summary">
        <div>
          <ul className="flex list-disc flex-col gap-2 bg-white py-4 pr-5 pl-9 text-[14px] text-body">
            {summary.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </Card>

      {canEdit ? (
        <AiBar
          kind="plan"
          auth={auth}
          domain={site.domain}
          rows={rows.map((r) => ({ id: r.key, keyword: r.keyword, job: r.action, stage: r.stage, theme: r.theme, volume: r.volume, kd: r.kd, cpc: r.cpc, intent: r.intent, rank: r.rank, added: approved.has(r.key) }))}
          tips={[
            "Approve every BOFU page with volume over 50",
            "Approve the 10 easiest pages that have search volume",
            "Select the pages to update that rank 11 to 30",
            "Approve the biggest page in each theme",
          ]}
          label={(id) => rows.find((r) => r.key === id)?.keyword ?? id}
          onApply={async (ops) => {
            const toApprove = new Set(ops.flatMap((o) => (o.op === "approve" ? o.ids : [])));
            const toSelect = ops.flatMap((o) => (o.op === "select" ? o.ids : []));
            if (toSelect.length) setPicked(new Set([...picked, ...toSelect]));
            if (toApprove.size) await approve(toApprove);
          }}
        />
      ) : null}

      <Card
        title="Keyword plan"
        action={
          <span className="flex flex-wrap items-center gap-2">
            {res.cost ? <span className="aw-label">DataForSEO ${res.cost.toFixed(2)}</span> : null}
            {history}
            <button
              type="button"
              className="aw-btn aw-btn--secondary aw-btn--sm"
              onClick={() =>
                downloadCsv(
                  `keyword-plan-${site.domain}.csv`,
                  ["keyword", "job", "stage", "theme", "volume", "difficulty", "cpc", "intent", "source", "existing page", "now ranks", "also covers"],
                  rows.map((r) => [r.keyword, r.action, r.stage, r.theme, r.volume, r.kd, r.cpc, r.intent, r.source, r.url, r.rank, r.others.join("; ")]),
                )
              }
            >
              Export CSV
            </button>
            {canEdit ? (
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onNew}>
                New plan
              </button>
            ) : null}
            {canEdit && approved.size < rows.length ? (
              <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={() => approve(new Set(rows.filter((r) => !approved.has(r.key)).map((r) => r.key)))}>
                Approve all
              </button>
            ) : null}
          </span>
        }
      >
        {picked.size && canEdit ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-rule-faint bg-brand-pale px-5 py-2.5">
            <span className="text-[13px] font-medium text-ink">{picked.size} selected</span>
            <button type="button" className="aw-btn aw-btn--accent aw-btn--sm" onClick={() => approve()}>
              Approve to calendar
            </button>
            <button type="button" className="aw-text-link text-[13px]" onClick={() => setPicked(new Set())}>
              Clear
            </button>
          </div>
        ) : null}
        <Sheet
          id={`plan:${site.id}`}
          label="Keyword plan"
          rows={rows}
          cols={cols}
          rowKey={(r) => r.key}
          sort={{ key: "volume", desc: true }}
          selected={canEdit ? picked : undefined}
          onSelect={canEdit ? setPicked : undefined}
          canSelect={(r) => !approved.has(r.key)}
        />
      </Card>
    </div>
  );
}
