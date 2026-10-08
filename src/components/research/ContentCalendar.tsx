"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { addCalendarItems, deleteCalendarItems, listCalendar, saveSite, updateCalendarItem, type CalendarItem, type CalendarStatus, type SheetColumn, type Site } from "@/lib/db";
import { slots, STAGES, type Stage } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import type { SheetOp } from "@/lib/sheetAi";
import { Sheet, type Col, type Edit } from "../Sheet";
import { SampleRows, SampleStats, ToolIntro } from "../ToolIntro";
import type { Chat } from "@/lib/chats";
import { Card, Seg, Thinking } from "../ui";
import { ContentResults } from "./ContentResults";
import { AiBar } from "./AiBar";
import { BriefPanel } from "./BriefPanel";
import { Difficulty, downloadCsv, FIELD, STAGE_LABEL, StageTag } from "./shared";

const STATUSES: { id: CalendarStatus; label: string }[] = [
  { id: "planned", label: "Planned" },
  { id: "brief", label: "Brief ready" },
  { id: "writing", label: "Writing" },
  { id: "published", label: "Published" },
];
const STAGE_ORDER = (s: Stage | null) => (s ? STAGES.findIndex((x) => x.id === s) : 3);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const BRIEF_LABEL = { running: "Writing...", done: "Ready", failed: "Failed" } as const;

/** Every planned page for one website, as a spreadsheet. Click a keyword to open its content brief. */
export function ContentCalendar({
  sb,
  auth,
  site,
  canEdit,
  onFind,
  onWrite,
  results,
  onSite,
}: {
  onSite: (s: Site) => void;
  sb: SupabaseClient;
  auth: RunAuth;
  site: Site;
  canEdit: boolean;
  onFind: () => void;
  onWrite: () => void;
  results: { brandId: string; days: number; chats: Chat[] };
}) {
  const [items, setItems] = useStash<CalendarItem[] | null>(`cal:${site.id}:items`, null);
  const [tab, setTab] = useStash<"plan" | "results">(`cal:${site.id}:tab`, "plan");
  const [error, setError] = useState("");
  const [planning, setPlanning] = useState(false);
  const [perWeek, setPerWeek] = useState(2);
  const [start, setStart] = useState(() => iso(new Date()));
  const [newKw, setNewKw] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
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

  const onBriefStatus = useCallback(
    (s: CalendarItem["brief_status"]) => {
      setItems((list) => list?.map((i) => (i.id === open ? { ...i, brief_status: s, status: s === "done" && i.status === "planned" ? "brief" : i.status } : i)) ?? null);
    },
    [open, setItems],
  );

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
    try {
      await addCalendarItems(sb, auth.workspaceId, [
        { site_id: site.id, keyword, secondary: [], stage: null, theme: null, volume: null, difficulty: null, intent: null, cpc: null, source: "added by hand" },
      ]);
      setNewKw("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function removePicked() {
    if (!confirm(`Remove ${picked.size} ${picked.size === 1 ? "page" : "pages"} from the calendar?`)) return;
    try {
      await deleteCalendarItems(sb, [...picked]);
      setItems(items!.filter((i) => !picked.has(i.id)));
      setPicked(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const undated = items.filter((i) => !i.due_date && i.status !== "published").length;
  const openItem = items.find((i) => i.id === open) ?? null;

  if (!items.length) {
    return (
      <div className="flex flex-col gap-4">
        {error ? <p className="aw-error">{error}</p> : null}
        <ToolIntro
          title="Plan, brief and track every page in one sheet"
          lead="Your calendar holds every page you plan to write or update. Set dates, assign owners, write a content brief from Google's top 10 in one click, and mark pages published to track their results."
          action={
            <>
              <button type="button" className="aw-btn aw-btn--accent" onClick={onFind}>
                Plan keywords
              </button>
              {canEdit ? (
                <form onSubmit={add} className="flex gap-2">
                  <input value={newKw} onChange={(e) => setNewKw(e.target.value)} placeholder="Or add a keyword" aria-label="Add a keyword" className={`${FIELD} w-56`} />
                  <button type="submit" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={!newKw.trim()}>
                    Add
                  </button>
                </form>
              ) : null}
            </>
          }
          features={[
            { title: "One sheet for every page", text: "Sort and filter by stage, status, volume, difficulty, owner and due date.", visual: <SampleRows rows={[["crm for dentists", 900, "Writing"], ["best dental crm", 600, "Brief"], ["what is a crm", 2400, "Planned"]]} /> },
            { title: "Content briefs in one click", text: "Reads Google's top 10, then gives you the format that wins, an outline, questions to answer and gaps to fill." },
            { title: "Dates on autopilot", text: "Pick posts per week. Plan dates schedules ready-to-buy pages first, biggest volume first.", visual: <SampleStats items={[["Per week", "2"], ["Planned", "24"], ["Weeks", "12"]]} /> },
            { title: "Write in Writer", text: "Open any brief as a draft with headings in place and a note under each on what to write." },
            { title: "Track what you publish", text: "Add the live URL and the page shows up in Content performance with its Google, AI and visitor numbers." },
          ]}
          steps={["Run the Planner, or add keywords from Keywords or Domains.", "Click a keyword to write its content brief.", "Write it, publish it, and paste the live URL."]}
        />
      </div>
    );
  }

  const text = (k: "keyword" | "theme" | "owner" | "notes"): Edit<CalendarItem> => ({
    kind: "text",
    save: (i, v) => (k === "keyword" ? v && patch(i.id, { keyword: v }) : patch(i.id, { [k]: v })),
  });
  const ed = <E,>(x: E) => (canEdit ? x : undefined);
  const cols: Col<CalendarItem>[] = [
    { id: "keyword", label: "Keyword", type: "text", value: (i) => i.keyword, width: 220, edit: ed(text("keyword")) },
    {
      id: "brief",
      label: "Brief",
      type: "list",
      value: (i) => (i.brief_status ? BRIEF_LABEL[i.brief_status] : "None"),
      options: ["Ready", "Writing...", "Failed", "None"],
      cell: (i) => (
        <button type="button" className={`aw-status ${i.brief_status === "done" ? "aw-status--ranked" : i.brief_status === "failed" ? "aw-status--missed" : i.brief_status === "running" ? "aw-status--warn" : "aw-status--pending"}`} onClick={() => setOpen(i.id)}>
          {i.brief_status ? BRIEF_LABEL[i.brief_status] : "Write brief"}
        </button>
      ),
    },
    {
      id: "status",
      label: "Status",
      type: "list",
      value: (i) => STATUSES.find((s) => s.id === i.status)?.label,
      options: STATUSES.map((s) => s.label),
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

  /** Make the AI's changes: one save per row, so changes to the same row do not overwrite each other. */
  async function applyOps(ops: SheetOp[]) {
    const byRow = new Map<string, Partial<CalendarItem>>();
    for (const o of ops) {
      if (o.op !== "update") continue;
      for (const id of o.ids) {
        const item = items!.find((i) => i.id === id);
        if (!item) continue;
        const p = byRow.get(id) ?? {};
        for (const [k, v] of Object.entries(o.set)) {
          if (custom.some((c) => c.id === k)) p.extra = { ...(item.extra ?? {}), ...(p.extra ?? {}), [k]: v };
          else (p as Record<string, unknown>)[k] = v;
        }
        byRow.set(id, p);
      }
    }
    await Promise.all([...byRow].map(([id, p]) => patch(id, p)));
    const gone = ops.flatMap((o) => (o.op === "delete" ? o.ids : []));
    if (gone.length) {
      await deleteCalendarItems(sb, gone);
      setItems((list) => list?.filter((i) => !gone.includes(i.id)) ?? null);
    }
    const added = ops.flatMap((o) => (o.op === "add" ? o.keywords : []));
    if (added.length) {
      await addCalendarItems(
        sb,
        auth.workspaceId,
        added.map((keyword) => ({ site_id: site.id, keyword, secondary: [], stage: null, theme: null, volume: null, difficulty: null, intent: null, cpc: null, source: "added by AI" })),
      );
      await load();
    }
    const sel = ops.flatMap((o) => (o.op === "select" ? o.ids : []));
    if (sel.length) setPicked(new Set([...picked, ...sel]));
  }

  const switcher = (
    <Seg
      label="Calendar view"
      value={tab}
      onChange={setTab}
      options={[
        { id: "plan", label: "Plan" },
        { id: "results", label: `Results ${items.filter((i) => i.status === "published" && (i.url || i.current_url)).length}` },
      ]}
    />
  );

  if (tab === "results")
    return (
      <div className="flex flex-col gap-5">
        <div>{switcher}</div>
        <ContentResults auth={auth} brandId={results.brandId} domain={site.domain} days={results.days} chats={results.chats} items={items} />
      </div>
    );

  return (
    <div className="flex flex-col gap-5">
      {error ? <p className="aw-error">{error}</p> : null}
      <div>{switcher}</div>

      {canEdit ? (
        <AiBar
          kind="calendar"
          auth={auth}
          domain={site.domain}
          rows={items.map((i) => ({
            id: i.id,
            keyword: i.keyword,
            status: i.status,
            due: i.due_date,
            owner: i.owner,
            job: i.action,
            stage: i.stage,
            theme: i.theme,
            volume: i.volume,
            kd: i.difficulty,
            notes: i.notes,
            brief: i.brief_status,
            ...Object.fromEntries(custom.map((c) => [c.id, i.extra?.[c.id] ?? null])),
          }))}
          columns={custom.map((c) => ({ id: c.id, name: c.name }))}
          tips={[
            "Schedule all undated pages, 2 a week from next Monday, BOFU first",
            "Mark pages with a ready brief as Writing",
            "Push every TOFU page with volume under 20 to the end of the schedule",
            "Remove keywords with no search volume",
          ]}
          label={(id) => items.find((i) => i.id === id)?.keyword ?? id}
          columnName={(k) => custom.find((c) => c.id === k)?.name ?? k.replace("_", " ")}
          onApply={applyOps}
        />
      ) : null}

      {planning ? (
        <section className="aw-frame flex flex-wrap items-end gap-4 px-4 py-4">
          <p className="w-full text-[14px] text-body">
            Give dates to the {undated} pages that have none. BOFU goes first, then MOFU, then TOFU, biggest search volume first. Posts land on weekdays.
          </p>
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

      <Card
        title={`${items.length} pages`}
        action={
          <span className="flex flex-wrap items-center gap-2">
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
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={removePicked}>
              Remove
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
          label="Content calendar"
          rows={items}
          cols={cols}
          rowKey={(i) => i.id}
          sort={{ key: "due", desc: false }}
          selected={canEdit ? picked : undefined}
          onSelect={canEdit ? setPicked : undefined}
          onOpen={(i) => setOpen(i.id)}
        />
      </Card>

      {openItem ? <BriefPanel sb={sb} auth={auth} item={openItem} canEdit={canEdit} onClose={() => setOpen(null)} onStatus={onBriefStatus} onWrite={onWrite} /> : null}
    </div>
  );
}
