"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { addCalendarItems, deleteCalendarItems, listCalendar, restoreCalendarItems, updateCalendarItem, type CalendarItem, type KeywordRun, type Site } from "@/lib/db";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import { quietly, recordUndo } from "@/lib/undo";
import type { NewPiece } from "./DayPanel";

/**
 * The Content Plan's pieces, shared by Opportunities and the Calendar: load, edit with Undo, add, delete with
 * 10 seconds to undo, and Write now. Both pages read the same stash, so a date set on one shows on the other.
 */
export function usePlan({ sb, auth, site }: { sb: SupabaseClient; auth: RunAuth; site: Site }) {
  const [items, setItems] = useStash<CalendarItem[] | null>(`cal:${site.id}:items`, null);
  const [runs] = useStash<KeywordRun[] | null>(`agentic:${site.id}:runs`, null);
  const [error, setError] = useState("");
  const [undo, setUndo] = useState<CalendarItem[] | null>(null);
  const [flash, setFlash] = useState("");
  const pending = useRef<{ ids: string[]; timer: ReturnType<typeof setTimeout> } | null>(null);

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

  // A delete waits 10 seconds for Undo. Leaving the page makes it final.
  const commit = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    deleteCalendarItems(sb, p.ids).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [sb]);
  useEffect(() => commit, [commit]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(""), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  async function patch(id: string, p: Partial<CalendarItem>) {
    const was = items?.find((i) => i.id === id);
    if (was) {
      const back = Object.fromEntries(Object.keys(p).map((f) => [f, was[f as keyof CalendarItem]])) as Partial<CalendarItem>;
      recordUndo({ label: `a change to "${was.keyword}"`, undo: () => patch(id, back), redo: () => patch(id, p), key: `plan:${id}:${Object.keys(p).join(",")}` });
    }
    setItems((list) => (list ?? []).map((i) => (i.id === id ? { ...i, ...p } : i)));
    try {
      await updateCalendarItem(sb, id, p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      load();
    }
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
    if (!items) return false;
    if (ids.length > 10 && !confirm(`Delete ${ids.length} pieces from your Content Plan?${(runs ?? []).some((r) => r.status === "done") ? " You can restore the AI's plan later." : ""}`)) return false;
    commit();
    const gone = items.filter((i) => ids.includes(i.id));
    setItems(items.filter((i) => !ids.includes(i.id)));
    setUndo(gone);
    pending.current = {
      ids,
      timer: setTimeout(() => {
        commit();
        setUndo(null);
      }, 10_000),
    };
    recordUndo({ label: `deleting ${gone.length} ${gone.length === 1 ? "piece" : "pieces"}`, undo: () => bringBack(gone) });
    return true;
  }
  /** Ctrl + Z after a delete: cancel it while it waits, or put the pieces back once it went through. */
  async function bringBack(gone: CalendarItem[]) {
    const ids = new Set(gone.map((g) => g.id));
    if (pending.current && pending.current.ids.every((id) => ids.has(id))) return undoRemove();
    setUndo(null);
    setItems((list) => [...(list ?? []).filter((i) => !ids.has(i.id)), ...gone]);
    await restoreCalendarItems(sb, gone);
  }
  function undoRemove() {
    if (!undo) return;
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
    setItems((list) => [...(list ?? []), ...undo]);
    setUndo(null);
  }

  /**
   * Write now: queue pieces for writing. The status set has no "queued" yet, so a queued piece turns Writing
   * and keeps the time it was queued in extra.write_queued_at for the writing job to pick up.
   */
  async function writeNow(ids: string[]) {
    const todo = (items ?? []).filter((i) => ids.includes(i.id) && i.status !== "published" && i.status !== "writing");
    if (!todo.length) {
      setFlash(ids.length === 1 ? "Already writing" : "Nothing to queue");
      return;
    }
    const at = new Date().toISOString();
    const before = new Map(todo.map((i) => [i.id, { status: i.status, extra: i.extra }]));
    const queue = () => Promise.all(todo.map((i) => patch(i.id, { status: "writing", extra: { ...(i.extra ?? {}), write_queued_at: at } })));
    recordUndo({
      label: `queuing ${todo.length} ${todo.length === 1 ? "article" : "articles"}`,
      undo: () => Promise.all(todo.map((i) => patch(i.id, before.get(i.id)!))),
      redo: queue,
    });
    await quietly(queue);
    setFlash(todo.length === 1 ? `Queued "${todo[0].keyword}" for writing` : `Queued ${todo.length} articles for writing`);
  }

  const toast = undo ? (
    <div className="aw-undo" role="status">
      Deleted {undo.length} {undo.length === 1 ? "piece" : "pieces"}
      <button type="button" onClick={undoRemove}>
        Undo
      </button>
    </div>
  ) : flash ? (
    <div className="aw-undo" role="status">
      {flash}
    </div>
  ) : null;

  return { items, setItems, runs, error, setError, load, patch, addOn, remove, writeNow, toast };
}
