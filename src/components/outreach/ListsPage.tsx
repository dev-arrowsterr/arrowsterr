"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { KIND_LABEL, SOURCE_LABEL, STATUS_LABEL, type OutreachList, type OutreachTarget, type TargetKind, type TargetStatus } from "@/lib/outreach";
import type { RunAuth } from "@/lib/runner";
import { BrandLogo } from "../BrandLogo";
import { post } from "../research/shared";
import { ToolIntro } from "../ToolIntro";
import { favicon, Thinking } from "../ui";

type List = OutreachList & { count: number };
const STATUS_CLASS: Record<TargetStatus, string> = {
  new: "aw-status--pending",
  drafted: "aw-status--warn",
  scheduled: "aw-status--pending",
  sent: "aw-status--pending",
  replied: "aw-status--ranked",
  do_not_contact: "aw-status--missed",
};
const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Outreach › Lists: the lists of websites, press, podcasts and channels to contact, with their emails. */
export function ListsPage({ sb, auth, canEdit, onResearch }: { sb: SupabaseClient; auth: RunAuth; canEdit: boolean; onResearch: () => void }) {
  const [lists, setLists] = useState<List[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [targets, setTargets] = useState<OutreachTarget[] | null>(null);
  const [kind, setKind] = useState<TargetKind | "">("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; email: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadLists = useCallback(async () => {
    const { data, error: err } = await sb.from("outreach_lists").select("id, name, brand_id, created_at, outreach_targets(count)").eq("workspace_id", auth.workspaceId).order("created_at", { ascending: false });
    if (err) {
      setError(/outreach_/.test(err.message) ? "Run supabase/040_outreach.sql in Supabase." : err.message);
      setLists([]);
      return;
    }
    const rows = (data ?? []).map((l) => ({ ...(l as OutreachList), count: (l as { outreach_targets?: { count: number }[] }).outreach_targets?.[0]?.count ?? 0 }));
    setLists(rows);
    setOpen((o) => (o && rows.some((l) => l.id === o) ? o : (rows[0]?.id ?? null)));
  }, [sb, auth.workspaceId]);

  const loadTargets = useCallback(async () => {
    if (!open) return setTargets([]);
    const { data, error: err } = await sb.from("outreach_targets").select("*").eq("list_id", open).order("created_at");
    if (err) setError(err.message);
    setTargets((data ?? []) as OutreachTarget[]);
  }, [sb, open]);

  useEffect(() => {
    // Loading on open is the point of these effects.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLists();
  }, [loadLists]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTargets();
  }, [loadTargets]);

  // While emails are being looked up, check back every 8 seconds.
  const looking = (targets ?? []).some((t) => t.email_status === "pending");
  useEffect(() => {
    if (!looking) return;
    const t = setInterval(() => void loadTargets(), 8000);
    return () => clearInterval(t);
  }, [looking, loadTargets]);

  const act = async (body: Record<string, unknown>, after?: () => void) => {
    setBusy(true);
    setError("");
    try {
      await post(auth, "/api/outreach", body);
      after?.();
      await Promise.all([loadLists(), loadTargets()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (lists === null) return <Thinking text="Loading your lists" />;

  if (!lists.length)
    return (
      <div className="flex flex-col gap-6">
        <h1 className="aw-h2">Lists</h1>
        {error ? <p className="aw-error max-w-2xl">{error}</p> : null}
        <ToolIntro
          title="Lists of people to reach out to"
          lead="Group the websites, press, podcasts and YouTube channels you want to get mentioned on. Arrowsterr finds a public contact email for each one."
          action={
            <>
              <button type="button" className="aw-btn aw-btn--accent" onClick={onResearch}>
                Find targets in Industry Research
              </button>
              {canEdit ? (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newName.trim()) void act({ action: "createList", name: newName.trim() }, () => setNewName(""));
                  }}
                >
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} placeholder="New list name" aria-label="New list name" className="aw-input" />
                  <button type="submit" className="aw-btn aw-btn--secondary" disabled={busy || !newName.trim()}>
                    Create list
                  </button>
                </form>
              ) : null}
            </>
          }
          features={[
            { title: "Add from your research", text: "Pick websites, press, podcasts and channels in Industry Research and add them in one click." },
            { title: "Emails found for you", text: "Arrowsterr reads each site's contact pages and each podcast's RSS feed. It never guesses an address." },
            { title: "Do not contact", text: "Opt-outs and bounces are never emailed again, on any list." },
            { title: "Ready for campaigns", text: "Each list becomes a campaign: drafts, slow random sending and an inbox for replies." },
          ]}
        />
      </div>
    );

  const list = lists.find((l) => l.id === open) ?? lists[0];
  const shown = (targets ?? []).filter((t) => !kind || t.kind === kind);
  const kinds = [...new Set((targets ?? []).map((t) => t.kind))];
  const withEmail = (targets ?? []).filter((t) => t.email).length;
  const missing = (targets ?? []).filter((t) => t.email_status === "not_found" && (t.kind === "website" || t.kind === "press" || t.kind === "podcast"));
  const flip = (id: string) => setPicked(picked.has(id) ? new Set([...picked].filter((x) => x !== id)) : new Set([...picked, id]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="aw-h2 mb-0!">Lists</h1>
        {canEdit ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) void act({ action: "createList", name: newName.trim() }, () => setNewName(""));
            }}
          >
            <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} placeholder="New list name" aria-label="New list name" className="aw-input py-1.5! text-[14px]!" />
            <button type="submit" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={busy || !newName.trim()}>
              New list
            </button>
          </form>
        ) : null}
      </div>
      {error ? <p className="aw-error max-w-2xl">{error}</p> : null}

      <div className="flex flex-wrap items-start gap-5">
        <nav aria-label="Your lists" className="flex w-full flex-col gap-2 md:w-72">
          {lists.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-current={l.id === list.id ? "true" : undefined}
              onClick={() => {
                setOpen(l.id);
                setPicked(new Set());
                setKind("");
                setConfirmDelete(false);
              }}
              className={`aw-frame flex flex-col gap-1 px-4 py-3 text-left ${l.id === list.id ? "border-brand! bg-brand-pale" : "hover:bg-surface-2"}`}
            >
              <span className="text-[14px] font-medium text-ink">{l.name}</span>
              <span className="aw-small">{l.count} targets</span>
            </button>
          ))}
        </nav>

        <section className="aw-frame min-w-0 flex-[999_1_560px]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-4">
            {renaming !== null ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (renaming.trim()) void act({ action: "renameList", listId: list.id, name: renaming.trim() }, () => setRenaming(null));
                }}
              >
                <input value={renaming} onChange={(e) => setRenaming(e.target.value)} maxLength={80} aria-label="List name" className="aw-input py-1.5! text-[14px]!" autoFocus />
                <button type="submit" className="aw-btn aw-btn--accent aw-btn--sm" disabled={busy}>
                  Save
                </button>
                <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setRenaming(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <div className="flex flex-col gap-0.5">
                <h2 className="aw-h4 mb-0!">{list.name}</h2>
                <span className="aw-small">
                  {targets?.length ?? 0} targets · {withEmail} with email{looking ? " · looking for emails…" : ""}
                </span>
              </div>
            )}
            {canEdit && renaming === null ? (
              <div className="flex flex-wrap items-center gap-2">
                {missing.length ? (
                  <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={busy} onClick={() => act({ action: "findEmails", targetIds: missing.map((t) => t.id) })}>
                    Look again ({missing.length})
                  </button>
                ) : null}
                <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setRenaming(list.name)}>
                  Rename
                </button>
                {confirmDelete ? (
                  <span className="flex items-center gap-2 text-[14px] text-ink">
                    Delete this list?
                    <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm text-neg!" disabled={busy} onClick={() => act({ action: "deleteList", listId: list.id }, () => setConfirmDelete(false))}>
                      Delete
                    </button>
                    <button type="button" className="aw-text-link text-[14px]" onClick={() => setConfirmDelete(false)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setConfirmDelete(true)}>
                    Delete list
                  </button>
                )}
              </div>
            ) : null}
          </div>

          {kinds.length > 1 ? (
            <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-2 border-b border-rule-faint px-5 py-3">
              {(["", ...kinds] as (TargetKind | "")[]).map((k) => (
                <button key={k || "all"} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`aw-chip aw-chip--btn ${kind === k ? "is-on" : ""}`}>
                  {k ? KIND_LABEL[k] : "All"}
                </button>
              ))}
            </div>
          ) : null}

          {canEdit && picked.size ? (
            <div className="flex flex-wrap items-center gap-3 border-b border-rule-faint bg-brand-pale px-5 py-2.5">
              <span className="text-[14px] font-medium text-ink">{picked.size} selected</span>
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={busy} onClick={() => act({ action: "findEmails", targetIds: [...picked] }, () => setPicked(new Set()))}>
                Find emails
              </button>
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={busy} onClick={() => act({ action: "remove", targetIds: [...picked] }, () => setPicked(new Set()))}>
                Remove from list
              </button>
              <button type="button" className="aw-text-link text-[14px]" onClick={() => setPicked(new Set())}>
                Clear
              </button>
            </div>
          ) : null}

          {targets === null ? (
            <p className="aw-small px-5 py-4">Loading…</p>
          ) : !shown.length ? (
            <p className="aw-small px-5 py-5">
              This list is empty. Add websites, press, podcasts or channels from{" "}
              <button type="button" className="aw-text-link" onClick={onResearch}>
                Industry Research
              </button>
              .
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="aw-table">
                <thead>
                  <tr>
                    {canEdit ? (
                      <th className="w-10">
                        <input
                          type="checkbox"
                          aria-label="Select every target shown"
                          checked={shown.every((t) => picked.has(t.id))}
                          onChange={(e) => setPicked(e.target.checked ? new Set([...picked, ...shown.map((t) => t.id)]) : new Set())}
                          className="h-4 w-4 accent-[var(--aw-brand)]"
                        />
                      </th>
                    ) : null}
                    <th>Target</th>
                    <th className="w-28">Type</th>
                    <th className="w-80">Contact</th>
                    <th className="w-36">Status</th>
                    <th className="w-24">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={t.id} className={picked.has(t.id) ? "bg-brand-pale" : ""}>
                      {canEdit ? (
                        <td>
                          <input type="checkbox" aria-label={`Select ${t.name}`} checked={picked.has(t.id)} onChange={() => flip(t.id)} className="h-4 w-4 accent-[var(--aw-brand)]" />
                        </td>
                      ) : null}
                      <td className="max-w-80">
                        <span className="flex min-w-0 items-center gap-2.5">
                          {t.domain ? <BrandLogo src={favicon(t.domain)} name={t.name} size={18} /> : null}
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate font-medium text-ink">{t.name}</span>
                            {t.url ? (
                              <a href={t.url} target="_blank" rel="noopener noreferrer" className="aw-text-link truncate text-[12px]">
                                {t.url.replace(/^https?:\/\/(www\.)?/, "")}
                              </a>
                            ) : null}
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="aw-status aw-status--pending">{KIND_LABEL[t.kind]}</span>
                      </td>
                      <td>
                        {editing?.id === t.id ? (
                          <form
                            className="flex gap-2"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void act({ action: "setEmail", targetId: t.id, email: editing.email }, () => setEditing(null));
                            }}
                          >
                            <input type="email" value={editing.email} onChange={(e) => setEditing({ id: t.id, email: e.target.value })} aria-label={`Email for ${t.name}`} placeholder="name@site.com" className="aw-input min-w-0 flex-1 py-1! text-[13px]!" autoFocus />
                            <button type="submit" className="aw-btn aw-btn--accent aw-btn--sm" disabled={busy}>
                              Save
                            </button>
                            <button type="button" className="aw-text-link text-[13px]" onClick={() => setEditing(null)}>
                              Cancel
                            </button>
                          </form>
                        ) : t.email ? (
                          <span className="flex flex-col">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-[14px] text-ink">{t.email}</span>
                              {canEdit ? (
                                <button type="button" className="aw-text-link text-[12px]" onClick={() => setEditing({ id: t.id, email: t.email ?? "" })}>
                                  Edit
                                </button>
                              ) : null}
                            </span>
                            <span className="aw-micro">{t.email_source ? SOURCE_LABEL[t.email_source] : ""}</span>
                          </span>
                        ) : t.email_status === "pending" ? (
                          <span className="aw-small">Looking…</span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <span className="aw-small">{t.kind === "youtube" || t.kind === "social" ? "Add by hand" : "Not found"}</span>
                            {canEdit ? (
                              <button type="button" className="aw-text-link text-[13px]" onClick={() => setEditing({ id: t.id, email: "" })}>
                                Add email
                              </button>
                            ) : null}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`aw-status ${STATUS_CLASS[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                      </td>
                      <td className="aw-small whitespace-nowrap">{date(t.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
