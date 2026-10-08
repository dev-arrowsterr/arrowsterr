"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { addCalendarItems, deleteCalendarItems, listCalendar, updateCalendarItem, type CalendarItem, type CalendarStatus, type Site } from "@/lib/db";
import { slots, STAGES, type Stage } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import { Sheet, type Col } from "../Sheet";
import { Card, Thinking } from "../ui";
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
export function ContentCalendar({ sb, auth, site, canEdit, onFind, onWrite }: { sb: SupabaseClient; auth: RunAuth; site: Site; canEdit: boolean; onFind: () => void; onWrite: () => void }) {
  const [items, setItems] = useStash<CalendarItem[] | null>(`cal:${site.id}:items`, null);
  const [error, setError] = useState("");
  const [planning, setPlanning] = useState(false);
  const [perWeek, setPerWeek] = useState(2);
  const [start, setStart] = useState(() => iso(new Date()));
  const [newKw, setNewKw] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);

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
      <section className="aw-frame">
        <div className="aw-frame__body flex flex-col gap-4">
          {error ? <p className="aw-error">{error}</p> : null}
          <h2 className="aw-h3">Your content calendar is empty</h2>
          <p className="text-[15px] text-body">Run Agentic research to plan 120 keywords, or add keywords from Keyword research. Approved pages land here.</p>
          <div className="flex flex-wrap gap-3">
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
          </div>
        </div>
      </section>
    );
  }

  const cols: Col<CalendarItem>[] = [
    { id: "keyword", label: "Keyword", type: "text", value: (i) => i.keyword, width: 220 },
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
    { id: "action", label: "Job", type: "list", value: (i) => (i.action === "update" ? "Update page" : "New page"), options: ["New page", "Update page"] },
    { id: "stage", label: "Stage", type: "list", value: (i) => (i.stage ? STAGE_LABEL[i.stage] : ""), options: ["BOFU", "MOFU", "TOFU"], cell: (i) => <StageTag stage={i.stage} /> },
    { id: "theme", label: "Theme", type: "list", value: (i) => i.theme },
    { id: "volume", label: "Volume", type: "number", value: (i) => i.volume },
    { id: "kd", label: "Difficulty", type: "number", value: (i) => i.difficulty, cell: (i) => <Difficulty kd={i.difficulty} /> },
    {
      id: "status",
      label: "Status",
      type: "list",
      value: (i) => STATUSES.find((s) => s.id === i.status)?.label,
      options: STATUSES.map((s) => s.label),
      cell: (i) => (
        <select aria-label={`Status of ${i.keyword}`} value={i.status} disabled={!canEdit} onChange={(e) => patch(i.id, { status: e.target.value as CalendarStatus })}>
          {STATUSES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      ),
    },
    {
      id: "due",
      label: "Due",
      type: "date",
      value: (i) => i.due_date,
      cell: (i) => (
        <input type="date" aria-label={`Due date for ${i.keyword}`} value={i.due_date ?? ""} disabled={!canEdit} onChange={(e) => patch(i.id, { due_date: e.target.value || null })} />
      ),
    },
    {
      id: "owner",
      label: "Owner",
      type: "text",
      value: (i) => i.owner,
      cell: (i) => (
        <input
          key={`${i.id}-owner-${i.owner ?? ""}`}
          defaultValue={i.owner ?? ""}
          aria-label={`Owner of ${i.keyword}`}
          placeholder="Name"
          disabled={!canEdit}
          onBlur={(e) => e.target.value.trim() !== (i.owner ?? "") && patch(i.id, { owner: e.target.value.trim() || null })}
          className="w-28"
        />
      ),
    },
    {
      id: "url",
      label: "Page URL",
      type: "text",
      value: (i) => i.url ?? i.current_url,
      width: 220,
      cell: (i) => (
        <input
          key={`${i.id}-url-${i.url ?? ""}`}
          defaultValue={i.url ?? i.current_url ?? ""}
          aria-label={`Page URL for ${i.keyword}`}
          placeholder="https://"
          disabled={!canEdit}
          onBlur={(e) => {
            const url = e.target.value.trim() || null;
            if (url !== (i.url ?? i.current_url)) patch(i.id, url && i.action === "new" ? { url, status: "published" } : { url });
          }}
          className="w-52"
        />
      ),
    },
    { id: "rank", label: "Now ranks", type: "number", value: (i) => i.current_rank, cell: (i) => (i.current_rank ? `#${i.current_rank}` : <span className="text-muted">–</span>) },
    { id: "also", label: "Also covers", type: "text", value: (i) => i.secondary.join(", "), width: 200, cell: (i) => <span className="block max-w-72 truncate" title={i.secondary.join("\n")}>{i.secondary.join(" · ") || "–"}</span> },
    { id: "source", label: "Source", type: "list", value: (i) => i.source },
  ];

  return (
    <div className="flex flex-col gap-5">
      {error ? <p className="aw-error">{error}</p> : null}

      <div className="aw-stats" style={{ ["--cols" as string]: 4 }}>
        {STATUSES.map((s) => (
          <div key={s.id} className="aw-stat">
            <div className="aw-stat__lab">{s.label}</div>
            <span className="aw-stat__num">{items.filter((i) => i.status === s.id).length}</span>
          </div>
        ))}
      </div>

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
              <button type="button" className="aw-btn aw-btn--sm" onClick={() => setPlanning(!planning)}>
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
        <Sheet
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
