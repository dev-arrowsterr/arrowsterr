"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { addCalendarItems, listKeywordRuns, saveKeywordRunResult, type KeywordRun, type Site } from "@/lib/db";
import { PER_STAGE, STAGES, type Stage } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import { Sheet, type Col } from "../Sheet";
import { SampleRows, SampleStats, ToolIntro } from "../ToolIntro";
import { Card, Thinking } from "../ui";
import { Difficulty, downloadCsv, FIELD, fmtCpc, fmtNum, post, STAGE_LABEL, StageTag } from "./shared";

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

/** Claude plans 120 keywords stage by stage, DataForSEO checks them, and you approve pages into the calendar. */
export function AgenticResearch({ sb, auth, site, canEdit, onOpenCalendar }: { sb: SupabaseClient; auth: RunAuth; site: Site; canEdit: boolean; onOpenCalendar: () => void }) {
  const [runs, setRuns] = useStash<KeywordRun[] | null>(`agentic:${site.id}:runs`, null);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
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
  }, [sb, site.id, setRuns]);

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
    <ToolIntro
      title={`Get a full content plan for ${site.domain} in 5 minutes`}
      lead="The Planner studies your site, your rankings and your competitors, then builds a 120-keyword plan from ready-to-buy searches down to learning searches. Each keyword is checked on Google, grouped into pages, and ready to approve into your calendar."
      action={
        canEdit ? (
          <button type="button" className="aw-btn aw-btn--accent" onClick={start} disabled={starting}>
            {starting ? "Starting..." : "Start planning"}
          </button>
        ) : (
          <p className="aw-small">Ask an editor to start the Planner.</p>
        )
      }
      features={[
        {
          title: "120 keywords across the funnel",
          text: `${PER_STAGE} bottom-of-funnel, ${PER_STAGE} middle and ${PER_STAGE} top-of-funnel keywords, fitted to your business type. Short and simple, 2 to 5 words each.`,
          visual: <SampleRows rows={[["BOFU · ready to buy", 40], ["MOFU · comparing", 40], ["TOFU · learning", 40]]} />,
        },
        { title: "Real search data only", text: "Every keyword is checked on Google. Ideas nobody searches for are swapped out.", visual: <SampleStats items={[["Keywords", "120"], ["Pages", "94"], ["Searches", "48K"]]} /> },
        { title: "Built from your site", text: "Reads your sitemap and what you already rank for, so it skips what you win and fixes what you don't." },
        { title: "Competitor gaps", text: "Finds your closest competitors on Google and the keywords they rank for that you don't.", visual: <SampleRows rows={[["rival.com", 140], ["agency.io", 95], ["seofirm.co", 60]]} /> },
        { title: "Pages to update", text: "Flags your articles that sit below the top 10 and names the keyword each should win." },
        { title: "One page per topic", text: "Keywords that share Google results are grouped into one page, so your own pages never compete." },
      ]}
      steps={[
        "Click Start planning. It runs in the background, so you can leave the page.",
        "Review the plan: sort and filter by stage, theme, volume and difficulty.",
        "Tick the pages you want and click Approve to calendar.",
      ]}
      faqs={[
        { q: "How long does it take?", a: "About 3 to 5 minutes. Progress shows step by step." },
        { q: "What does it cost?", a: "About 50 to 90 cents in data costs, plus one AI answer from your daily limit." },
        { q: "What are BOFU, MOFU and TOFU?", a: "Bottom, middle and top of the funnel: people ready to buy, people comparing options, and people learning about the topic." },
      ]}
    />
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

  async function approve() {
    const list = rows.filter((r) => picked.has(r.key) && !approved.has(r.key));
    setError("");
    try {
      const n = await addCalendarItems(
        sb,
        auth.workspaceId,
        list.map((r) => ({
          site_id: site.id,
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
      setNotice(`${n} ${n === 1 ? "row" : "rows"} added to the content calendar.${n < list.length ? ` ${list.length - n} were already on it.` : ""}`);
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
            Open calendar
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

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="What we found">
          <ul className="flex flex-col gap-2 p-5 text-[14px] text-body">
            <li>
              <span className="aw-label mr-2">Sitemap</span>
              {res.sitemap?.source ? (
                <>
                  {fmtNum(res.sitemap.pages)} pages, {fmtNum(res.sitemap.articles)} articles, from{" "}
                  <a href={res.sitemap.source.startsWith("http") ? res.sitemap.source : `https://${site.domain}`} target="_blank" rel="noopener noreferrer">
                    {res.sitemap.source.replace(/^https?:\/\//, "")}
                  </a>
                </>
              ) : (
                "No sitemap, feed or links found. The site may block bots."
              )}
            </li>
            <li>
              <span className="aw-label mr-2">Ranking</span>
              {fmtNum(res.sitemap?.ranking ?? 0)} of your pages show up on Google. {fmtNum(updateCount)} articles rank below the top 10 or not at all.
            </li>
            <li>
              <span className="aw-label mr-2">Competitors</span>
              {res.competitors?.length
                ? res.competitors.map((c, i) => (
                    <span key={c.domain}>
                      {i ? ", " : ""}
                      <a href={`https://${c.domain}`} target="_blank" rel="noopener noreferrer nofollow">
                        {c.domain}
                      </a>{" "}
                      <span className="text-muted">({fmtNum(c.keywords)} keywords)</span>
                    </span>
                  ))
                : "None found."}
            </li>
            <li>
              <span className="aw-label mr-2">From competitors</span>
              {fmtNum(keywords.filter((k) => k.competitor).length)} of the new keywords are ones your competitors already rank for.
            </li>
          </ul>
        </Card>

        <Card title="Coverage map" action={<span className="aw-label">Rows per theme and stage</span>}>
          <div className="overflow-x-auto">
            <table className="aw-table aw-table--compact">
              <thead>
                <tr>
                  <th>Theme</th>
                  {STAGES.map((x) => (
                    <th key={x.id}>{x.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {themes.map((t) => (
                  <tr key={t}>
                    <td className="text-ink">{t}</td>
                    {STAGES.map((x) => {
                      const n = rows.filter((r) => r.theme === t && r.stage === x.id).length;
                      return (
                        <td key={x.id} className="aw-num">
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
      </div>

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
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={start} disabled={starting}>
                Run again
              </button>
            ) : null}
          </span>
        }
      >
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
        <Sheet
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
