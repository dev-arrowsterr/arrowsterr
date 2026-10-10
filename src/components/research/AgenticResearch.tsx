"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { listKeywordRuns, saveKeywordRunResult, type BankRow, type KeywordRun, type Site } from "@/lib/db";
import { STAGES, type AgentResult } from "@/lib/research";
import { useStash } from "@/lib/stash";

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

/** A finished plan as Topic Bank rows: new pages to write and existing pages to improve. Rows already on the calendar are left out. */
export function planRows(res: AgentResult): Omit<BankRow, "id" | "added">[] {
  const keywords = res.keywords ?? [];
  const approved = new Set(res.approved ?? []);
  const fresh = (res.groups ?? [])
    .filter((g) => !approved.has(g.primary))
    .map((g) => {
      const ks = keywords.filter((k) => k.group === g.id);
      const main = ks.find((k) => k.keyword === g.primary) ?? ks[0];
      const rival = ks.find((k) => k.competitor)?.competitor;
      return {
        keyword: g.primary,
        stage: g.stage,
        volume: g.volume,
        kd: main?.kd ?? null,
        intent: main?.intent ?? null,
        notes: null,
        source: rival ? `content plan: ${rival}` : "content plan",
        action: "new" as const,
        theme: g.theme,
        cpc: main?.cpc ?? null,
        url: null,
        rank: null,
        others: ks.filter((k) => k !== main).map((k) => k.keyword),
      };
    });
  const updates = (res.updates ?? [])
    .filter((u) => !approved.has(`update:${u.page}`))
    .map((u) => ({
      keyword: u.keyword,
      stage: u.stage,
      volume: u.volume,
      kd: u.kd,
      intent: u.intent,
      notes: null,
      source: "content plan: your sitemap",
      action: "update" as const,
      theme: u.theme,
      cpc: u.cpc,
      url: u.page,
      rank: u.rank ?? null,
      others: [],
    }));
  return [...fresh, ...updates];
}

/** A content plan in progress. When it finishes, its rows go into the Topic Bank through onRows. */
export function PlanProgress({ sb, site, refresh, onRows }: { sb: SupabaseClient; site: Site; refresh: number; onRows: (rows: Omit<BankRow, "id" | "added">[]) => void }) {
  const [runs, setRuns] = useStash<KeywordRun[] | null>(`agentic:${site.id}:runs`, null);
  const [error, setError] = useState("");
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
  }, [load, refresh]);

  const run = runs?.[0] ?? null;
  const stale = run?.status === "running" && now - new Date(run.created_at).getTime() > STALE;
  const running = run?.status === "running" && !stale;

  // While a plan is working, check on it every 4 seconds.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [running, load]);

  // Finished plans that are not in the Topic Bank yet go there, once.
  useEffect(() => {
    const todo = (runs ?? []).filter((r) => r.status === "done" && !r.result.banked);
    if (!todo.length) return;
    for (const r of todo) onRows(planRows(r.result));
    setRuns((runs ?? []).map((r) => (todo.includes(r) ? { ...r, result: { ...r.result, banked: true } } : r)));
    for (const r of todo) saveKeywordRunResult(sb, r.id, { ...r.result, banked: true }).catch(() => {});
  }, [runs, onRows, setRuns, sb]);

  if (error) return <p className="aw-error">{error}</p>;
  if (run && (run.status === "failed" || stale)) return <p className="aw-error">{stale ? "The last content plan stopped before it finished." : `Content plan failed: ${run.error ?? "unknown error"}`}</p>;
  if (!running || !run) return null;

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
