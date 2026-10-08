"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { addCalendarItems, deleteCalendarItems, listCalendar, updateCalendarItem, type CalendarItem, type CalendarStatus, type Site } from "@/lib/db";
import { slots, STAGES, type Stage } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { Card, Seg, sortRows, SortTh, Thinking, useSort } from "../ui";
import { Check, Difficulty, downloadCsv, FIELD, fmtNum, STAGE_COLORS, StageTag } from "./shared";

const STATUSES: { id: CalendarStatus; label: string }[] = [
  { id: "planned", label: "Planned" },
  { id: "brief", label: "Brief ready" },
  { id: "writing", label: "Writing" },
  { id: "published", label: "Published" },
];
const STATUS_CLASS: Record<CalendarStatus, string> = { planned: "aw-status--pending", brief: "aw-status--warn", writing: "aw-status--warn", published: "aw-status--ranked" };
const STAGE_ORDER = (s: Stage | null) => (s ? STAGES.findIndex((x) => x.id === s) : 3);

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const short = (s: string | null) => (s ? parse(s).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "No date");

/** Every planned page for one website, as a board, a list or a month. */
export function ContentCalendar({ sb, auth, site, canEdit, onFind }: { sb: SupabaseClient; auth: RunAuth; site: Site; canEdit: boolean; onFind: () => void }) {
  const [items, setItems] = useState<CalendarItem[] | null>(null);
  const [view, setView] = useState<"board" | "list" | "month">("board");
  const [stage, setStage] = useState<Stage | "all">("all");
  const [error, setError] = useState("");
  const [planning, setPlanning] = useState(false);
  const [perWeek, setPerWeek] = useState(2);
  const [start, setStart] = useState(() => iso(new Date()));
  const [newKw, setNewKw] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sort, setSort] = useSort("due", false);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [drag, setDrag] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listCalendar(sb, site.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    }
  }, [sb, site.id]);

  useEffect(() => {
    // Loading from Supabase on first render is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

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
    const open = items!
      .filter((i) => !i.due_date && i.status !== "published")
      .sort((a, b) => STAGE_ORDER(a.stage) - STAGE_ORDER(b.stage) || (b.volume ?? 0) - (a.volume ?? 0));
    const dates = slots(parse(start), perWeek, open.length);
    setPlanning(false);
    await Promise.all(open.map((i, n) => patch(i.id, { due_date: dates[n] })));
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

  const shown = items.filter((i) => stage === "all" || i.stage === stage);
  const undated = items.filter((i) => !i.due_date && i.status !== "published").length;

  if (!items.length) {
    return (
      <section className="aw-frame">
        <div className="aw-frame__body flex flex-col gap-4">
          <h2 className="aw-h3">Your content calendar is empty</h2>
          <p className="text-[15px] text-body">Run Agentic keyword research to plan 120 keywords, or add keywords from Keyword research. Approved pages land here.</p>
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

  const statusSelect = (i: CalendarItem) => (
    <select aria-label={`Status of ${i.keyword}`} value={i.status} disabled={!canEdit} onChange={(e) => patch(i.id, { status: e.target.value as CalendarStatus })} className={`${FIELD} py-1`}>
      {STATUSES.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </select>
  );

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

      <section className="aw-frame flex flex-wrap items-center gap-3 px-4 py-3">
        <Seg
          label="View"
          value={view}
          onChange={setView}
          options={[
            { id: "board", label: "Board" },
            { id: "list", label: "List" },
            { id: "month", label: "Month" },
          ]}
        />
        <Seg
          label="Stage"
          value={stage}
          onChange={setStage}
          options={[{ id: "all" as const, label: "All" }, ...STAGES.map((s) => ({ id: s.id, label: s.label }))]}
        />
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {canEdit ? (
            <form onSubmit={add} className="flex gap-2">
              <input value={newKw} onChange={(e) => setNewKw(e.target.value)} placeholder="Add a keyword" aria-label="Add a keyword" className={`${FIELD} w-44`} />
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
                ["keyword", "also covers", "stage", "theme", "volume", "difficulty", "status", "due date", "owner", "url"],
                items.map((i) => [i.keyword, i.secondary.join("; "), i.stage, i.theme, i.volume, i.difficulty, i.status, i.due_date, i.owner, i.url]),
              )
            }
          >
            Export CSV
          </button>
        </span>
      </section>

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

      {view === "board" ? (
        <div className="grid gap-4 lg:grid-cols-4">
          {STATUSES.map((s) => {
            const col = shown.filter((i) => i.status === s.id).sort((a, b) => (a.due_date ?? "9").localeCompare(b.due_date ?? "9"));
            return (
              <section
                key={s.id}
                className={`aw-frame flex min-h-40 flex-col ${drag ? "outline-dashed outline-1 outline-rule" : ""}`}
                onDragOver={(e) => canEdit && e.preventDefault()}
                onDrop={() => {
                  if (drag) patch(drag, { status: s.id });
                  setDrag(null);
                }}
              >
                <div className="flex items-center justify-between border-b border-rule px-4 py-3">
                  <span className={`aw-status ${STATUS_CLASS[s.id]}`}>{s.label}</span>
                  <span className="aw-num text-[13px] text-muted">{col.length}</span>
                </div>
                <ul className="flex max-h-[70vh] flex-col gap-2 overflow-auto p-3">
                  {col.map((i) => (
                    <li
                      key={i.id}
                      draggable={canEdit}
                      onDragStart={() => setDrag(i.id)}
                      onDragEnd={() => setDrag(null)}
                      className={`flex flex-col gap-2 border border-rule bg-white p-3 ${canEdit ? "cursor-grab" : ""}`}
                      style={i.stage ? { boxShadow: `inset 2px 0 0 ${STAGE_COLORS[i.stage]}` } : undefined}
                    >
                      <span className="text-[14px] font-medium text-ink">{i.keyword}</span>
                      {i.secondary.length ? <span className="text-[12px] text-muted">+{i.secondary.length} more keywords</span> : null}
                      <span className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                        <StageTag stage={i.stage} />
                        <span>{fmtNum(i.volume)} / mo</span>
                        <span>· {short(i.due_date)}</span>
                      </span>
                      {canEdit ? statusSelect(i) : null}
                    </li>
                  ))}
                  {!col.length ? <li className="aw-small px-1 py-2">Nothing here.</li> : null}
                </ul>
              </section>
            );
          })}
        </div>
      ) : view === "list" ? (
        <Card title={`${shown.length} pages`}>
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
          <div className="overflow-x-auto">
            <table className="aw-table aw-table--compact">
              <thead>
                <tr>
                  <th className="w-8">
                    <Check
                      checked={shown.length > 0 && shown.every((i) => picked.has(i.id))}
                      some={shown.some((i) => picked.has(i.id))}
                      disabled={!canEdit}
                      label="Select all shown"
                      onChange={(on) => setPicked(on ? new Set(shown.map((i) => i.id)) : new Set())}
                    />
                  </th>
                  <SortTh id="keyword" sort={sort} onSort={setSort} text>
                    Keyword
                  </SortTh>
                  <SortTh id="stage" sort={sort} onSort={setSort} text>
                    Stage
                  </SortTh>
                  <SortTh id="volume" sort={sort} onSort={setSort}>
                    Volume
                  </SortTh>
                  <SortTh id="kd" sort={sort} onSort={setSort}>
                    Difficulty
                  </SortTh>
                  <SortTh id="status" sort={sort} onSort={setSort} text>
                    Status
                  </SortTh>
                  <SortTh id="due" sort={sort} onSort={setSort} text>
                    Due
                  </SortTh>
                  <SortTh id="owner" sort={sort} onSort={setSort} text>
                    Owner
                  </SortTh>
                  <th>Published URL</th>
                </tr>
              </thead>
              <tbody>
                {sortRows(shown, sort, {
                  keyword: (i) => i.keyword,
                  stage: (i) => STAGE_ORDER(i.stage),
                  volume: (i) => i.volume,
                  kd: (i) => i.difficulty,
                  status: (i) => STATUSES.findIndex((s) => s.id === i.status),
                  due: (i) => i.due_date,
                  owner: (i) => i.owner,
                }).map((i) => (
                  <tr key={i.id} className={picked.has(i.id) ? "bg-brand-pale" : ""}>
                    <td>
                      <Check
                        checked={picked.has(i.id)}
                        disabled={!canEdit}
                        label={`Select ${i.keyword}`}
                        onChange={(on) => setPicked((p) => (on ? new Set([...p, i.id]) : new Set([...p].filter((x) => x !== i.id))))}
                      />
                    </td>
                    <td className="max-w-sm">
                      <span className="flex flex-col">
                        <span className="text-ink">{i.keyword}</span>
                        {i.secondary.length ? (
                          <span className="truncate text-[12px] text-muted" title={i.secondary.join("\n")}>
                            Also: {i.secondary.join(" · ")}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td>
                      <StageTag stage={i.stage} />
                    </td>
                    <td className="aw-num">{fmtNum(i.volume)}</td>
                    <td>
                      <Difficulty kd={i.difficulty} />
                    </td>
                    <td>{statusSelect(i)}</td>
                    <td>
                      <input
                        type="date"
                        aria-label={`Due date for ${i.keyword}`}
                        value={i.due_date ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => patch(i.id, { due_date: e.target.value || null })}
                        className={`${FIELD} py-1`}
                      />
                    </td>
                    <td>
                      <input
                        defaultValue={i.owner ?? ""}
                        aria-label={`Owner of ${i.keyword}`}
                        placeholder="Name"
                        disabled={!canEdit}
                        onBlur={(e) => e.target.value !== (i.owner ?? "") && patch(i.id, { owner: e.target.value.trim() || null })}
                        className={`${FIELD} w-28 py-1`}
                      />
                    </td>
                    <td>
                      <input
                        defaultValue={i.url ?? ""}
                        aria-label={`Published URL for ${i.keyword}`}
                        placeholder="https://"
                        disabled={!canEdit}
                        onBlur={(e) => {
                          const url = e.target.value.trim() || null;
                          if (url !== i.url) patch(i.id, url ? { url, status: "published" } : { url });
                        }}
                        className={`${FIELD} w-48 py-1`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <MonthView month={month} onMonth={setMonth} items={shown} />
      )}
    </div>
  );
}

/** A month grid with each page on its due date. */
function MonthView({ month, onMonth, items }: { month: Date; onMonth: (d: Date) => void; items: CalendarItem[] }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => {
    const d = i - lead + 1;
    return d >= 1 && d <= days ? new Date(month.getFullYear(), month.getMonth(), d) : null;
  });
  const today = iso(new Date());
  const undated = items.filter((i) => !i.due_date).length;
  return (
    <Card
      title={month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
      action={
        <span className="flex items-center gap-2">
          {undated ? <span className="aw-label">{undated} without a date</span> : null}
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" aria-label="Previous month" onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
            ←
          </button>
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" aria-label="Next month" onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
            →
          </button>
        </span>
      }
    >
      <div className="overflow-x-auto">
        <div className="grid min-w-[720px] grid-cols-7">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="aw-label border-b border-rule px-2 py-2">
              {d}
            </div>
          ))}
          {cells.map((d, n) => {
            const key = d ? iso(d) : `x${n}`;
            const list = d ? items.filter((i) => i.due_date === key) : [];
            return (
              <div key={key} className={`min-h-28 border-b border-r border-rule-faint p-1.5 ${d ? "" : "bg-surface-2"}`}>
                {d ? (
                  <span className={`aw-num mb-1 block text-[12px] ${key === today ? "font-medium text-brand" : "text-muted"}`}>
                    {d.getDate()}
                    {key === today ? " · today" : ""}
                  </span>
                ) : null}
                <ul className="flex flex-col gap-1">
                  {list.map((i) => (
                    <li
                      key={i.id}
                      className="truncate border border-rule bg-white px-1.5 py-1 text-[12px] text-ink"
                      style={i.stage ? { boxShadow: `inset 2px 0 0 ${STAGE_COLORS[i.stage]}` } : undefined}
                      title={`${i.keyword} · ${STATUSES.find((s) => s.id === i.status)?.label}${i.stage ? ` · ${i.stage.toUpperCase()}` : ""}`}
                    >
                      {i.status === "published" ? "✓ " : ""}
                      {i.keyword}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
