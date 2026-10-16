"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import type { NewTarget, OutreachList } from "@/lib/outreach";
import type { RunAuth } from "@/lib/runner";
import { post } from "../research/shared";

/** Add websites, podcasts or channels to an outreach list, or to a new one. */
export function AddToList({
  sb,
  auth,
  brandId,
  items,
  from,
  onClose,
  onDone,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  brandId: string;
  items: NewTarget[];
  from: "industry" | "sources" | "social";
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [lists, setLists] = useState<(OutreachList & { count: number })[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error: err } = await sb.from("outreach_lists").select("id, name, brand_id, created_at, outreach_targets(count)").eq("workspace_id", auth.workspaceId).order("created_at", { ascending: false });
      if (!live) return;
      if (err) {
        setError(/outreach_/.test(err.message) ? "Run supabase/040_outreach.sql in Supabase." : err.message);
        setLists([]);
        return;
      }
      const rows = (data ?? []).map((l) => ({ ...(l as OutreachList), count: (l as { outreach_targets?: { count: number }[] }).outreach_targets?.[0]?.count ?? 0 }));
      setLists(rows);
      setPicked(rows[0]?.id ?? null);
    })();
    return () => {
      live = false;
    };
  }, [sb, auth.workspaceId]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const add = async () => {
    setBusy(true);
    setError("");
    try {
      let listId = picked;
      let name = lists?.find((l) => l.id === picked)?.name ?? "";
      if (draft.trim()) {
        const { list } = await post<{ list: OutreachList }>(auth, "/api/outreach", { action: "createList", name: draft.trim(), brandId });
        listId = list.id;
        name = list.name;
      }
      if (!listId) throw new Error("Pick a list or name a new one.");
      const { added, skipped } = await post<{ added: number; skipped: number }>(auth, "/api/outreach", { action: "add", listId, items, from });
      onDone(`Added ${added} to ${name}${skipped ? ` (${skipped} already there)` : ""}. Finding emails now.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const plural = { website: "websites", press: "publications", podcast: "podcasts", youtube: "channels", social: "accounts" } as const;
  const label = items.length === 1 ? items[0].name : `${items.length} ${items.every((i) => i.kind === items[0].kind) ? plural[items[0].kind] : "targets"}`;
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-[rgba(16,20,30,0.45)] p-4 pt-[12vh]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Add to list" onClick={(e) => e.stopPropagation()} className="aw-frame flex max-h-[80vh] w-full max-w-lg flex-col gap-4 overflow-y-auto bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="aw-h4 mb-0!">Add {label} to a list</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="px-1 text-[24px] leading-none text-body hover:text-ink">
            ×
          </button>
        </div>
        {lists === null ? (
          <p className="aw-small">Loading lists…</p>
        ) : lists.length ? (
          <div role="radiogroup" aria-label="List" className="flex flex-col gap-2">
            {lists.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={picked === l.id && !draft.trim()}
                onClick={() => {
                  setPicked(l.id);
                  setDraft("");
                }}
                className={`flex items-center justify-between gap-3 border px-4 py-3 text-left ${picked === l.id && !draft.trim() ? "border-brand bg-brand-pale" : "border-rule hover:bg-surface-2"}`}
              >
                <span className="text-[14px] font-medium text-ink">{l.name}</span>
                <span className="aw-num text-[13px] text-muted">{l.count}</span>
              </button>
            ))}
          </div>
        ) : null}
        <label className="flex flex-col gap-1.5">
          <span className="aw-label">{lists?.length ? "Or a new list" : "New list"}</span>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={80} placeholder="Like: SaaS podcasts Q4" className="aw-input" />
        </label>
        {error ? <p className="aw-error">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="aw-btn aw-btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="aw-btn aw-btn--accent" onClick={add} disabled={busy || (!picked && !draft.trim())}>
            {busy ? "Adding…" : "Add to list"}
          </button>
        </div>
      </div>
    </div>
  );
}
