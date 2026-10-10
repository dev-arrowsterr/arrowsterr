"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { addCalendarItems, deleteCalendarItems, listCalendar, saveSite, updateCalendarItem, type CalendarItem, type CalendarStatus, type SheetColumn, type Site } from "@/lib/db";
import { slots, STAGES, type Stage } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import { Sheet, type Col, type Edit } from "../Sheet";
import type { Chat } from "@/lib/chats";
import { Card, SidePanel, Thinking } from "../ui";
import { ContentResults } from "./ContentResults";
import { SitePages } from "./SitePages";
import { CalendarGrid } from "./CalendarGrid";
import { ContentPiece, STATUSES } from "./ContentPiece";
import { useAiIdeas } from "./AiIdeas";
import { DayPanel, ideaPiece, type NewPiece } from "./DayPanel";
import { Difficulty, downloadCsv, FIELD, STAGE_LABEL, StageTag } from "./shared";

const STAGE_ORDER = (s: Stage | null) => (s ? STAGES.findIndex((x) => x.id === s) : 3);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const BRIEF_LABEL = { running: "Writing...", done: "Ready", failed: "Failed" } as const;

type Tab = "calendar" | "list" | "results";

const icon = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const CalendarIcon = () => icon(<><rect x={3.5} y={5} width={17} height={15} rx={2.5} /><path d="M3.5 10h17M8 3v4M16 3v4" /></>);
const ListIcon = () => icon(<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />);
const ChartIcon = () => icon(<path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />);

/** The editorial calendar: build it by hand on a month grid or a sheet, or generate a content plan and approve it in. */
export function ContentCalendar({
  sb,
  auth,
  site,
  canEdit,
  onWrite,
  results,
  onSite,
}: {
  onSite: (s: Site) => void;
  sb: SupabaseClient;
  auth: RunAuth;
  site: Site;
  canEdit: boolean;
  onWrite: () => void;
  results: { brandId: string; brandName: string; days: number; chats: Chat[] };
}) {
  const [items, setItems] = useStash<CalendarItem[] | null>(`cal:${site.id}:items`, null);
  const [tab, setTab] = useStash<Tab>(`cal:${site.id}:view`, "calendar");
  const view: Tab = tab === "list" || tab === "results" ? tab : "calendar"; // older sessions may have saved a view that no longer exists
  const [error, setError] = useState("");
  const [planning, setPlanning] = useState(false);
  const [perWeek, setPerWeek] = useState(2);
  const [start, setStart] = useState(() => iso(new Date()));
  const [newKw, setNewKw] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<{ day: string | null; piece: string | null } | null>(null);
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
  const openItem = panel?.piece ? (items.find((i) => i.id === panel.piece) ?? null) : null;
  const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const text = (k: "keyword" | "theme" | "owner" | "notes"): Edit<CalendarItem> => ({
    kind: "text",
    save: (i, v) => (k === "keyword" ? v && patch(i.id, { keyword: v }) : patch(i.id, { [k]: v })),
  });
  const ed = <E,>(x: E) => (canEdit ? x : undefined);
  const cols: Col<CalendarItem>[] = [
    { id: "keyword", label: "Keyword", type: "text", value: (i) => i.keyword, width: 220 },
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



  const views: { id: Tab; label: string; icon: React.ReactNode; n?: number }[] = [
    { id: "calendar", label: "Calendar", icon: <CalendarIcon /> },
    { id: "list", label: "List", icon: <ListIcon />, n: items.length },
    { id: "results", label: "Performance", icon: <ChartIcon /> },
  ];
  const head = (
    <nav className="flex items-center gap-1 border-b border-rule" role="tablist" aria-label="Calendar view">
      {views.map((v, n) => (
        <span key={v.id} className="flex items-center">
          {n ? <span className="mx-1 h-5 w-px bg-rule" aria-hidden="true" /> : null}
          <button
            type="button"
            role="tab"
            aria-selected={view === v.id}
            onClick={() => setTab(v.id)}
            className={`-mb-px flex items-center gap-2 rounded-none border-b-2 px-3 py-2.5 text-[15px] transition-colors ${view === v.id ? "border-brand font-medium text-brand" : "border-transparent text-body hover:text-ink"}`}
          >
            {v.icon}
            {v.label}
            {v.n ? <span className="aw-num rounded-full bg-surface-2 px-1.5 text-[11px] text-muted">{v.n}</span> : null}
          </button>
        </span>
      ))}
    </nav>
  );

  if (view === "results")
    return (
      <div className="flex flex-col gap-5">
        {head}
        <SitePages auth={auth} site={site} items={items} canEdit={canEdit} />
        <ContentResults auth={auth} brandId={results.brandId} domain={site.domain} days={results.days} chats={results.chats} items={items} />
      </div>
    );

  return (
    <div className="flex flex-col gap-5">
      {error ? <p className="aw-error">{error}</p> : null}
      {head}


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
          label="Editorial calendar"
          rows={items}
          cols={cols}
          rowKey={(i) => i.id}
          sort={{ key: "due", desc: false }}
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
            onRemove={async () => {
              if (!confirm(`Remove "${openItem.keyword}" from the calendar?`)) return;
              await deleteCalendarItems(sb, [openItem.id]).catch((e) => setError(e instanceof Error ? e.message : String(e)));
              setItems(items.filter((i) => i.id !== openItem.id));
              setPanel(panel?.day ? { day: panel.day, piece: null } : null);
            }}
            onWrite={onWrite}
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
    </div>
  );
}
