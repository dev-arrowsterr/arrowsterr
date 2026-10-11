"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { addCalendarItems, deleteCalendarItems, keywordRunResult, listCalendar, saveSite, updateCalendarItem, type BankRow, type CalendarItem, type CalendarStatus, type KeywordRun, type NewCalendarItem, type SheetColumn, type Site } from "@/lib/db";
import { nextMonday, schedulePlan, slots, STAGES, type Stage } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import { Sheet, type Col, type Edit } from "../Sheet";
import type { Chat } from "@/lib/chats";
import { Card, SidePanel, Thinking } from "../ui";
import { CalendarGrid } from "./CalendarGrid";
import { ContentPiece, STATUSES, type WriterAccess } from "./ContentPiece";
import { useAiIdeas } from "./AiIdeas";
import { DayPanel, ideaPiece, type NewPiece } from "./DayPanel";
import { byStage, Difficulty, downloadCsv, FIELD, PLAN_VIEWS, post, STAGE_LABEL, StageTag, statusLabel, ViewSwitch, type PlanView } from "./shared";
import { PlanProgress, planRows } from "./AgenticResearch";
import { PlanIntro, PlanSample } from "./PlanIntro";

const STAGE_ORDER = (s: Stage | null) => (s ? STAGES.findIndex((x) => x.id === s) : 3);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const BRIEF_LABEL = { running: "Writing...", done: "Ready", failed: "Failed" } as const;

type Tab = PlanView;
const VIEW_KEY = "arrowsterr.planView"; // each person's last view, kept in this browser
const readView = (): Tab => {
  try {
    return localStorage.getItem(VIEW_KEY) === "calendar" ? "calendar" : "list";
  } catch {
    return "list";
  }
};
const REFRESH_DAYS = 30;
/** Paid plans can refresh the Content Plan once a month. */
export type Refresh = { paid: boolean; onUpgrade: () => void };
type PlanRow = Omit<BankRow, "id" | "added">;

/** A plan row as a Content Plan item. */
const toItem = (siteId: string, r: PlanRow & { due_date?: string | null }): NewCalendarItem => ({
  site_id: siteId,
  keyword: r.keyword,
  secondary: r.others ?? [],
  stage: r.stage,
  theme: r.theme ?? null,
  volume: r.volume,
  difficulty: r.kd,
  intent: r.intent,
  cpc: r.cpc ?? null,
  source: r.source,
  notes: r.notes,
  due_date: r.due_date ?? null,
  action: r.action ?? "new",
  current_url: r.url ?? null,
  current_rank: r.rank ?? null,
});

const icon = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const AiIconSmall = () => icon(<path d="M12 3c.6 4.6 1.9 5.9 6.5 6.5-4.6.6-5.9 1.9-6.5 6.5-.6-4.6-1.9-5.9-6.5-6.5C10.1 8.9 11.4 7.6 12 3Z" />);

/**
 * The Content Plan: every piece of content in one place. The list is the plan, edited like a spreadsheet.
 * The calendar is the Editorial Calendar, with every unscheduled idea on the side to drag onto a day.
 * The AI agent builds it the Perceptric way, with dates; people edit it from there.
 */
export function ContentCalendar({
  sb,
  auth,
  site,
  canEdit,
  writer,
  onImport,
  results,
  onSite,
  refresh,
}: {
  refresh?: Refresh;
  /** Open Keyword Research to add keywords from there. */
  onImport?: () => void;
  onSite: (s: Site) => void;
  sb: SupabaseClient;
  auth: RunAuth;
  site: Site;
  canEdit: boolean;
  writer?: WriterAccess;
  results: { brandId: string; brandName: string; days: number; chats: Chat[] };
}) {
  const [items, setItems] = useStash<CalendarItem[] | null>(`cal:${site.id}:items`, null);
  const [view, setViewState] = useState<Tab>(readView);
  const setTab = (v: Tab) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };
  const [runs] = useStash<KeywordRun[] | null>(`agentic:${site.id}:runs`, null);
  const [tick, setTick] = useState(0); // reloads the plan progress after a build starts
  const [building, setBuilding] = useState(false);
  const [undo, setUndo] = useState<CalendarItem[] | null>(null);
  const pending = useRef<{ ids: string[]; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [error, setError] = useState("");
  const [planning, setPlanning] = useState(false);
  const [perWeek, setPerWeek] = useState(2);
  const [start, setStart] = useState(() => iso(new Date()));
  const [newKw, setNewKw] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<{ day: string | null; piece: string | null; tab?: "serp" | "draft"; run?: boolean } | null>(null);
  const [adding, setAdding] = useState(false);
  const [colName, setColName] = useState("");
  const [colType, setColType] = useState<SheetColumn["type"]>("text");
  const custom = site.profile.columns ?? [];

  const load = useCallback(async () => {
    try {
      setItems(await listCalendar(sb, site.id));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(/action|brief|current_/.test(message) ? `${message}. Run supabase/007_briefs_and_pages.sql in Supabase → SQL Editor.` : message);
      setItems([]);
    }
  }, [sb, site.id, setItems]);

  useEffect(() => {
    // Loading from Supabase on first render is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Keywords saved in the old Topic Bank move into the Content Plan as ideas, once.
  const oldBank = site.profile.bank;
  useEffect(() => {
    if (!canEdit || !oldBank?.length) return;
    const s2 = { ...site, profile: { ...site.profile, bank: undefined } };
    addCalendarItems(sb, auth.workspaceId, oldBank.map((b) => toItem(site.id, b)))
      .then(() => saveSite(sb, s2))
      .then(() => {
        onSite(s2);
        load();
      })
      .catch(() => {});
    // Only when old rows are found.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldBank?.length]);

  // A delete waits 10 seconds for Undo. Leaving the page makes it final.
  const commit = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    deleteCalendarItems(sb, p.ids).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [sb]);
  useEffect(() => commit, [commit]);

  // A finished plan lands here: the first one with dates, a monthly refresh as new ideas.
  const onPlan = useCallback(
    (rows: PlanRow[], first: boolean) => {
      const list = first ? schedulePlan(rows, nextMonday()) : rows;
      addCalendarItems(sb, auth.workspaceId, list.map((r) => toItem(site.id, r)))
        .then(load)
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    },
    [sb, auth.workspaceId, site.id, load],
  );



  const ideas = useAiIdeas(auth, site, results.brandName, results.chats, (items ?? []).map((i) => i.keyword));
  if (!items) return <Thinking text="Loading your calendar..." />;

  async function patch(id: string, p: Partial<CalendarItem>) {
    setItems((list) => list!.map((i) => (i.id === id ? { ...i, ...p } : i)));
    try {
      await updateCalendarItem(sb, id, p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      load();
    }
  }

  async function plan() {
    const todo = items!
      .filter((i) => !i.due_date && i.status !== "published")
      .sort((a, b) => STAGE_ORDER(a.stage) - STAGE_ORDER(b.stage) || (b.volume ?? 0) - (a.volume ?? 0));
    const dates = slots(parse(start), perWeek, todo.length);
    setPlanning(false);
    await Promise.all(todo.map((i, n) => patch(i.id, { due_date: dates[n] })));
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const keyword = newKw.trim().replace(/\s+/g, " ");
    if (!keyword) return;
    setNewKw("");
    await addOn(keyword, null);
  }

  async function addOn(keyword: string, due_date: string | null, extra: Omit<NewPiece, "keyword"> = {}) {
    try {
      await addCalendarItems(sb, auth.workspaceId, [
        {
          site_id: site.id,
          keyword,
          secondary: [],
          stage: extra.stage ?? null,
          theme: null,
          volume: extra.volume ?? null,
          difficulty: extra.kd ?? null,
          intent: extra.intent ?? null,
          cpc: null,
          source: extra.notes ? "ai visibility" : "added by hand",
          due_date,
          notes: extra.notes ?? null,
          ...(extra.action === "update" && extra.url ? { action: "update" as const, current_url: extra.url } : {}),
        },
      ]);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Take items off the plan, with 10 seconds to undo. Big deletes ask first. */
  function remove(ids: string[]) {
    if (ids.length > 10 && !confirm(`Delete ${ids.length} pieces from your Content Plan?${(runs ?? []).some((r) => r.status === "done") ? " You can restore the AI's plan later." : ""}`)) return;
    commit();
    const gone = items!.filter((i) => ids.includes(i.id));
    setItems(items!.filter((i) => !ids.includes(i.id)));
    setPicked(new Set());
    setUndo(gone);
    pending.current = { ids, timer: setTimeout(() => {
      commit();
      setUndo(null);
    }, 10_000) };
  }
  function undoRemove() {
    if (!undo) return;
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
    setItems([...items!, ...undo]);
    setUndo(null);
  }

  async function build() {
    setBuilding(true);
    setError("");
    try {
      await post(auth, "/api/research/agentic", { siteId: site.id });
      setTick((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  }

  /** Put the AI's last plan back, with fresh dates. Pieces still on the plan are skipped. */
  async function restore() {
    const done = (runs ?? []).find((r) => r.status === "done");
    if (!done) return;
    setError("");
    try {
      const result = await keywordRunResult(sb, done.id);
      const rows = schedulePlan(planRows({ ...result, approved: [] }), nextMonday());
      await addCalendarItems(sb, auth.workspaceId, rows.map((r) => toItem(site.id, r)));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const ordered = [...items].sort(byStage);
  /** Keywords pasted below the last row become new ideas. */
  async function appendRows(list: Record<string, string>[]) {
    const fresh = list.map((r) => (r.keyword ?? Object.values(r)[0] ?? "").trim().replace(/\s+/g, " ")).filter(Boolean);
    if (!fresh.length) return;
    try {
      await addCalendarItems(
        sb,
        auth.workspaceId,
        fresh.map((keyword) => ({ site_id: site.id, keyword, secondary: [], stage: null, theme: null, volume: null, difficulty: null, intent: null, cpc: null, source: "pasted", due_date: null, notes: null })),
      );
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const undated = items.filter((i) => !i.due_date && i.status !== "published").length;
  const openItem = panel?.piece ? (items.find((i) => i.id === panel.piece) ?? null) : null;
  const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const text = (k: "keyword" | "theme" | "owner" | "notes"): Edit<CalendarItem> => ({
    kind: "text",
    save: (i, v) => (k === "keyword" ? v && patch(i.id, { keyword: v }) : patch(i.id, { [k]: v })),
  });
  const ed = <E,>(x: E) => (canEdit ? x : undefined);
  const cols: Col<CalendarItem>[] = [
    { id: "keyword", label: "Keyword", type: "text", value: (i) => i.keyword, width: 220, edit: ed(text("keyword")) },
    {
      id: "serp",
      label: "SERP",
      type: "list",
      value: () => null,
      width: 110,
      cell: (i) => (
        <button type="button" className="aw-chip aw-chip--btn whitespace-nowrap" onClick={() => setPanel({ day: null, piece: i.id, tab: "serp", run: canEdit })} title={`Read Google's top 10 for "${i.keyword}"`}>
          ⌕ Analyze
        </button>
      ),
    },
    {
      id: "write",
      label: "Writer",
      type: "list",
      value: () => null,
      width: 100,
      cell: (i) => (
        <button type="button" className="aw-chip aw-chip--btn whitespace-nowrap" onClick={() => setPanel({ day: null, piece: i.id, tab: "draft" })} title="Open in the Agentic Writer">
          ✎ Write
        </button>
      ),
    },
    {
      id: "brief",
      label: "Brief",
      type: "list",
      value: (i) => (i.brief_status ? BRIEF_LABEL[i.brief_status] : "None"),
      options: ["Ready", "Writing...", "Failed", "None"],
      cell: (i) => (
        <button type="button" className={`aw-status ${i.brief_status === "done" ? "aw-status--ranked" : i.brief_status === "failed" ? "aw-status--missed" : i.brief_status === "running" ? "aw-status--warn" : "aw-status--pending"}`} onClick={() => setPanel({ day: i.due_date, piece: i.id })}>
          {i.brief_status ? BRIEF_LABEL[i.brief_status] : "Write brief"}
        </button>
      ),
    },
    {
      id: "status",
      label: "Status",
      type: "list",
      value: (i) => statusLabel(i),
      options: ["Idea", ...STATUSES.map((s) => s.label)],
      edit: ed<Edit<CalendarItem>>({ kind: "select", options: STATUSES, value: (i) => i.status, save: (i, v) => v && patch(i.id, { status: v as CalendarStatus }) }),
    },
    {
      id: "due",
      label: "Due",
      type: "date",
      value: (i) => i.due_date,
      cell: (i) => (i.due_date ? parse(i.due_date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : <span className="text-muted">–</span>),
      edit: ed<Edit<CalendarItem>>({ kind: "date", value: (i) => i.due_date ?? "", save: (i, v) => patch(i.id, { due_date: v }) }),
    },
    { id: "owner", label: "Owner", type: "text", value: (i) => i.owner, edit: ed(text("owner")) },
    { id: "action", label: "Job", type: "list", value: (i) => (i.action === "update" ? "Update page" : "New page"), options: ["New page", "Update page"] },
    {
      id: "stage",
      label: "Stage",
      type: "list",
      value: (i) => (i.stage ? STAGE_LABEL[i.stage] : ""),
      options: ["BOFU", "MOFU", "TOFU"],
      cell: (i) => <StageTag stage={i.stage} />,
      edit: ed<Edit<CalendarItem>>({
        kind: "select",
        options: [{ id: "", label: "None" }, ...STAGES.map((x) => ({ id: x.id, label: STAGE_LABEL[x.id] }))],
        value: (i) => i.stage ?? "",
        save: (i, v) => patch(i.id, { stage: (v || null) as Stage | null }),
      }),
    },
    { id: "theme", label: "Theme", type: "list", value: (i) => i.theme, edit: ed(text("theme")) },
    { id: "volume", label: "Volume", type: "number", value: (i) => i.volume },
    { id: "kd", label: "Difficulty", type: "number", value: (i) => i.difficulty, cell: (i) => <Difficulty kd={i.difficulty} /> },
    {
      id: "url",
      label: "Page URL",
      type: "text",
      value: (i) => i.url ?? i.current_url,
      width: 200,
      edit: ed<Edit<CalendarItem>>({
        kind: "text",
        save: (i, url) => patch(i.id, url && i.action === "new" ? { url, status: "published" } : { url }),
      }),
    },
    { id: "notes", label: "Notes", type: "text", value: (i) => i.notes, width: 180, edit: ed(text("notes")) },
    { id: "rank", label: "Now ranks", type: "number", value: (i) => i.current_rank, cell: (i) => (i.current_rank ? `#${i.current_rank}` : <span className="text-muted">–</span>) },
    { id: "also", label: "Also covers", type: "text", value: (i) => i.secondary.join(", "), width: 200, cell: (i) => <span className="block max-w-72 truncate" title={i.secondary.join("\n")}>{i.secondary.join(" · ") || "–"}</span> },
    { id: "source", label: "Source", type: "list", value: (i) => i.source },
    ...custom.map(
      (c): Col<CalendarItem> => ({
        id: `x:${c.id}`,
        label: c.name,
        type: c.type === "number" ? "number" : c.type === "date" ? "date" : "text",
        value: (i) => i.extra?.[c.id] ?? null,
        edit: ed<Edit<CalendarItem>>({
          kind: c.type,
          value: (i) => String(i.extra?.[c.id] ?? ""),
          save: (i, v) => patch(i.id, { extra: { ...(i.extra ?? {}), [c.id]: c.type === "number" && v !== null ? Number(v) : v } }),
        }),
        onRemove: canEdit ? () => removeColumn(c.id) : undefined,
      }),
    ),
  ];

  async function saveColumns(next: SheetColumn[]) {
    const s2 = { ...site, profile: { ...site.profile, columns: next } };
    try {
      await saveSite(sb, s2);
      onSite(s2);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function removeColumn(cid: string) {
    const c = custom.find((x) => x.id === cid);
    if (c && confirm(`Delete the column "${c.name}"? Its values stay saved but hidden.`)) saveColumns(custom.filter((x) => x.id !== cid));
  }



  // The latest finished plan, and when the next monthly refresh opens.
  const lastDone = (runs ?? []).find((r) => r.status === "done") ?? null;
  const running = (runs ?? [])[0]?.status === "running";
  const nextRefresh = lastDone ? new Date(new Date(lastDone.created_at).getTime() + REFRESH_DAYS * 864e5) : null;
  const canRefresh = Boolean(refresh?.paid && nextRefresh && nextRefresh <= new Date());
  const short = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const toggle = <ViewSwitch value={view} onChange={setTab} options={PLAN_VIEWS} />;
  const built = Boolean(items.length || lastDone);
  const intro = <PlanIntro canEdit={canEdit} busy={building || running} built={built} onBuild={build} />;
  const head = (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="aw-h2 mb-0!">Content Plan</h1>
      <div className="flex flex-wrap items-center gap-3">
        {lastDone && canEdit && !running ? (
          refresh?.paid ? (
            canRefresh ? (
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={build} disabled={building} title="Run the research again and add new ideas. Dated and written pieces stay as they are.">
                <AiIconSmall />
                {building ? "Starting..." : "Refresh plan"}
              </button>
            ) : nextRefresh ? (
              <span className="text-[13px] text-muted" title="Paid plans can refresh the Content Plan once a month.">
                Next refresh {short(nextRefresh)}
              </span>
            ) : null
          ) : (
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={refresh?.onUpgrade} title="Refresh the Content Plan every month on paid plans.">
              🔒 Monthly refresh · paid plans
            </button>
          )
        ) : null}
      </div>
    </header>
  );
  const undoBar = undo ? (
    <div className="aw-undo" role="status">
      Deleted {undo.length} {undo.length === 1 ? "piece" : "pieces"}
      <button type="button" onClick={undoRemove}>
        Undo
      </button>
    </div>
  ) : null;
  const progress = <PlanProgress sb={sb} site={site} refresh={tick} onRows={onPlan} />;

  // Before the first plan: what it is, a sample, and one button.
  if (!items.length && !lastDone && !running)
    return (
      <div className="flex flex-col gap-5">
        {error ? <p className="aw-error">{error}</p> : null}
        {head}
        {intro}
        {progress}
        <PlanSample />
        {undoBar}
      </div>
    );

  return (
    <div className="flex flex-col gap-5">
      {error ? <p className="aw-error">{error}</p> : null}
      {head}
      {intro}
      {progress}
      {!items.length && lastDone && !running ? (
        <section className="aw-frame flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="aw-h4">Your Content Plan is empty</span>
          <p className="max-w-md text-[15px] text-ink">{canEdit ? "Put the AI's plan back with fresh dates, or add keywords of your own below." : "An editor can restore the plan or add keywords."}</p>
          {canEdit ? (
            <button type="button" className="aw-btn aw-btn--accent" onClick={restore}>
              Restore the AI&apos;s plan
            </button>
          ) : null}
        </section>
      ) : null}


      {planning ? (
        <section className="aw-frame flex flex-wrap items-end gap-4 px-4 py-4">
          <label className="flex flex-col gap-1">
            <span className="aw-label">Posts per week</span>
            <select value={perWeek} onChange={(e) => setPerWeek(Number(e.target.value))} className={FIELD}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="aw-label">Start on</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={FIELD} />
          </label>
          <button type="button" className="aw-btn aw-btn--accent aw-btn--sm" onClick={plan} disabled={!undated}>
            Set dates
          </button>
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setPlanning(false)}>
            Cancel
          </button>
        </section>
      ) : null}

      {view === "calendar" ? (
        <CalendarGrid
          toolbar={toggle}
          items={items}
          canEdit={canEdit}
          onMove={(id, date) => patch(id, { due_date: date })}
          onDay={(day) => setPanel({ day, piece: null })}
          ideas={ideas}
          onIdea={(idea, date) => addOn(idea.keyword, date, ideaPiece(idea))}
          onOpen={(id) => setPanel({ day: items.find((i) => i.id === id)?.due_date ?? null, piece: id })}
          onAutoSchedule={() => setPlanning(true)}
        />
      ) : (
      <Card
        title={`${items.length} ${items.length === 1 ? "piece" : "pieces"}`}
        action={
          <span className="flex flex-wrap items-center gap-2">
            {canEdit && onImport ? (
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onImport} title="Find keywords in Keyword Research, then click Add to Content Plan">
                Import from Keyword Research
              </button>
            ) : null}
            {canEdit ? (
              <form onSubmit={add} className="flex gap-2">
                <input value={newKw} onChange={(e) => setNewKw(e.target.value)} placeholder="Add a keyword" aria-label="Add a keyword" className={`${FIELD} w-40`} />
                <button type="submit" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={!newKw.trim()}>
                  Add
                </button>
              </form>
            ) : null}
            {canEdit ? (
              <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={() => setPlanning(!planning)}>
                Plan dates{undated ? ` (${undated})` : ""}
              </button>
            ) : null}
            <button
              type="button"
              className="aw-btn aw-btn--secondary aw-btn--sm"
              onClick={() =>
                downloadCsv(
                  `content-calendar-${site.domain}.csv`,
                  ["keyword", "job", "stage", "theme", "volume", "difficulty", "status", "due date", "owner", "page url", "now ranks", "also covers"],
                  items.map((i) => [i.keyword, i.action, i.stage, i.theme, i.volume, i.difficulty, i.status, i.due_date, i.owner, i.url ?? i.current_url, i.current_rank, i.secondary.join("; ")]),
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
            <select
              aria-label="Set status"
              value=""
              onChange={(e) => {
                const st = e.target.value as CalendarStatus;
                [...picked].forEach((id) => patch(id, { status: st }));
              }}
              className={FIELD}
            >
              <option value="" disabled>
                Set status
              </option>
              {STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => remove([...picked])}>
              Delete
            </button>
          </div>
        ) : null}
        {adding ? (
          <form
            className="flex flex-wrap items-center gap-2 border-b border-rule-faint bg-surface-2 px-5 py-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              const name = colName.trim();
              if (!name) return;
              saveColumns([...custom, { id: `c${Date.now().toString(36)}`, name: name.slice(0, 40), type: colType }]);
              setColName("");
              setAdding(false);
            }}
          >
            <input autoFocus value={colName} onChange={(e) => setColName(e.target.value)} placeholder="Column name, like Writer or Word count" aria-label="Column name" className={`${FIELD} w-64`} />
            <select value={colType} onChange={(e) => setColType(e.target.value as SheetColumn["type"])} aria-label="Column type" className={FIELD}>
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
            </select>
            <button type="submit" className="aw-btn aw-btn--primary aw-btn--sm" disabled={!colName.trim()}>
              Add column
            </button>
            <button type="button" className="aw-text-link text-[13px]" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </form>
        ) : null}
        <Sheet
          id={`cal:${site.id}`}
          onAddColumn={canEdit ? () => setAdding(true) : undefined}
          label="Content Plan"
          toolbar={toggle}
          rows={ordered}
          cols={cols}
          rowKey={(i) => i.id}
          sort={{ key: "stage", desc: false }}
          onDeleteRows={canEdit ? remove : undefined}
          onAppend={canEdit ? appendRows : undefined}
          selected={canEdit ? picked : undefined}
          onSelect={canEdit ? setPicked : undefined}
          onOpen={(i) => setPanel({ day: null, piece: i.id })}
        />
      </Card>
      )}

      {openItem ? (
        <SidePanel
          title={openItem.keyword}
          kicker={
            panel?.day ? (
              <button type="button" className="aw-text-link" onClick={() => setPanel({ day: panel.day, piece: null })}>
                ← {dayLabel(panel.day)}
              </button>
            ) : (
              "Content piece"
            )
          }
          onClose={() => setPanel(null)}
        >
          <ContentPiece
            key={openItem.id}
            sb={sb}
            auth={auth}
            site={site}
            brandName={results.brandName}
            item={openItem}
            canEdit={canEdit}
            onPatch={(p) => patch(openItem.id, p)}
            onRemove={() => {
              remove([openItem.id]);
              setPanel(panel?.day ? { day: panel.day, piece: null } : null);
            }}
            writer={writer}
            startTab={panel?.tab}
            autoSerp={panel?.run}
          />
        </SidePanel>
      ) : panel?.day ? (
        <SidePanel title={dayLabel(panel.day)} kicker="Editorial Calendar" onClose={() => setPanel(null)}>
          <DayPanel
            items={items.filter((i) => i.due_date === panel.day)}
            ideas={ideas}
            canEdit={canEdit}
            onOpen={(id) => setPanel({ day: panel.day, piece: id })}
            onAdd={(p) => addOn(p.keyword, panel.day, p)}
          />
        </SidePanel>
      ) : null}
      {undoBar}
    </div>
  );
}
