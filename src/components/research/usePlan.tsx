"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { addCalendarItems, deleteCalendarItems, listCalendar, restoreCalendarItems, updateCalendarItem, type CalendarItem, type KeywordRun, type Site } from "@/lib/db";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import { quietly, recordUndo } from "@/lib/undo";
import { canImport, importPatch } from "@/lib/writerImport";
import { Confirm } from "../reports/Dialog";
import type { NewPiece } from "./DayPanel";

/**
 * The Content Plan's pieces for the Editorial Calendar's list and calendar views: load, edit with Undo, add,
 * delete with 10 seconds to undo, and Import to Agentic Writer. Every view reads the same stash.
 */
export function usePlan({ sb, auth, site }: { sb: SupabaseClient; auth: RunAuth; site: Site }) {
  const [items, setItems] = useStash<CalendarItem[] | null>(`cal:${site.id}:items`, null);
  const [runs] = useStash<KeywordRun[] | null>(`agentic:${site.id}:runs`, null);
  const [error, setError] = useState("");
  const [undo, setUndo] = useState<CalendarItem[] | null>(null);
  const [flash, setFlash] = useState("");
  const [asking, setAsking] = useState<{ ids: string[]; done?: () => void } | null>(null);
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

  /** Take items off the plan, with 10 seconds to undo. Big deletes ask first; done runs once they go. */
  function remove(ids: string[], done?: () => void) {
    if (!items) return;
    if (ids.length > 10) return setAsking({ ids, done });
    drop(ids);
    done?.();
  }
  function drop(ids: string[]) {
    if (!items) return;
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
    recordUndo({ label: gone.length === 1 ? `deleting "${gone[0].keyword}"` : "deleting pieces", undo: () => bringBack(gone) });
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
   * Import to Agentic Writer: sets extra.in_writer_at (src/lib/writerImport.ts) and leaves the status alone.
   * Pieces already in the writer, and published ones, are skipped. One step for Undo.
   */
  async function importToWriter(ids: string[]) {
    const todo = (items ?? []).filter((i) => ids.includes(i.id) && canImport(i));
    if (!todo.length) {
      setFlash("Already in the Agentic Writer");
      return;
    }
    const at = new Date().toISOString();
    const before = new Map(todo.map((i) => [i.id, i.extra ?? {}]));
    const send = () => Promise.all(todo.map((i) => patch(i.id, importPatch({ extra: before.get(i.id) }, at))));
    recordUndo({
      label: todo.length === 1 ? `importing "${todo[0].keyword}"` : "importing to the Agentic Writer",
      undo: () => Promise.all(todo.map((i) => patch(i.id, { extra: before.get(i.id)! }))),
      redo: send,
    });
    await quietly(send);
    setFlash(todo.length === 1 ? `Imported "${todo[0].keyword}" to the Agentic Writer` : "Imported to the Agentic Writer");
  }

  const toast = undo ? (
    <div className="aw-undo" role="status">
      Deleted
      <button type="button" onClick={undoRemove}>
        Undo
      </button>
    </div>
  ) : flash ? (
    <div className="aw-undo" role="status">
      {flash}
    </div>
  ) : null;
  const dialog = asking ? (
    <Confirm
      title="Delete pieces"
      text={`They come off the Editorial Calendar.${(runs ?? []).some((r) => r.status === "done") ? " You can restore the AI's plan later." : ""}`}
      action="Delete"
      onConfirm={() => {
        drop(asking.ids);
        asking.done?.();
        setAsking(null);
      }}
      onClose={() => setAsking(null)}
    />
  ) : null;

  return {
    items,
    setItems,
    runs,
    error,
    setError,
    load,
    patch,
    addOn,
    remove,
    importToWriter,
    toast: (
      <>
        {toast}
        {dialog}
      </>
    ),
  };
}
