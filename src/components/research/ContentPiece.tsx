"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "@tiptap/extension-link";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Brief } from "@/lib/briefTypes";
import { briefDocHtml, wordFile } from "@/lib/briefDoc";
import { createDoc, getBrief, getGuideline, listDocs, saveBrief, type CalendarItem, type CalendarStatus, type DocMeta, type Site } from "@/lib/db";
import type { RunAuth } from "@/lib/runner";
import { putStash } from "@/lib/stash";
import { briefToDoc } from "@/lib/writer";
import type { BrandGuideline } from "@/lib/writerTypes";
import { Seg } from "../ui";
import { Difficulty, FIELD, fmtNum, post, StageTag } from "./shared";

export const STATUSES: { id: CalendarStatus; label: string }[] = [
  { id: "planned", label: "Planned" },
  { id: "brief", label: "Brief ready" },
  { id: "writing", label: "Writing" },
  { id: "published", label: "Published" },
];

type Tab = "overview" | "brief" | "draft";

/** One content piece: its details, its content brief as an editable document, and its draft. */
export function ContentPiece({
  sb,
  auth,
  site,
  brandName,
  item,
  canEdit,
  onPatch,
  onRemove,
  onWrite,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  site: Site;
  brandName: string;
  item: CalendarItem;
  canEdit: boolean;
  onPatch: (p: Partial<CalendarItem>) => void;
  onRemove: () => void;
  onWrite: () => void;
}) {
  const [tab, setTab] = useState<Tab>(item.brief_status ? "brief" : "overview");
  const [brief, setBrief] = useState<Awaited<ReturnType<typeof getBrief>> | null>(null);
  const [guideline, setGuideline] = useState<BrandGuideline | null | undefined>(undefined);
  const [drafts, setDrafts] = useState<DocMeta[] | null>(null);
  const [error, setError] = useState("");

  const loadBrief = useCallback(async () => {
    try {
      const b = await getBrief(sb, item.id);
      setBrief(b);
      if (b.brief_status !== item.brief_status) onPatch({ brief_status: b.brief_status, ...(b.brief_status === "done" && item.status === "planned" ? { status: "brief" as const } : {}) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [sb, item.id, item.brief_status, item.status, onPatch]);

  useEffect(() => {
    // Loading the brief, the brand guideline and the drafts when the piece opens is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadBrief();
    getGuideline(sb, item.site_id).then(setGuideline).catch(() => setGuideline(null));
    listDocs(sb, item.site_id)
      .then((d) => setDrafts(d.filter((x) => x.calendar_item_id === item.id)))
      .catch(() => setDrafts([]));
    // Only when another piece opens.
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = brief?.brief_status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(loadBrief, 4000);
    return () => clearInterval(t);
  }, [running, loadBrief]);

  async function createBrief() {
    setError("");
    try {
      await post(auth, "/api/research/brief", { itemId: item.id });
      setBrief((b) => ({ ...(b ?? { brief: null, brief_error: null, brief_at: null }), brief_status: "running" }));
      onPatch({ brief_status: "running" });
      setTab("brief");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Open (or make) the draft for this piece in the Writer, with the brief's outline in place.
  async function toWriter(blank = false) {
    setError("");
    try {
      const b = brief?.brief;
      const doc = await createDoc(sb, {
        workspace_id: auth.workspaceId,
        site_id: item.site_id,
        calendar_item_id: item.id,
        title: b?.brief.h1 || item.keyword,
        content: (b && !blank ? briefToDoc(item.keyword, item.secondary, b) : { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: item.keyword }] }, { type: "paragraph" }] }) as unknown as Record<string, unknown>,
      });
      putStash(`writer:${item.site_id}:open`, doc.id);
      putStash(`writer:${item.site_id}:docs`, null);
      if (item.status === "planned" || item.status === "brief") onPatch({ status: "writing" });
      onWrite();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(/docs/.test(message) ? `${message}. Run supabase/010_writer.sql in Supabase.` : message);
    }
  }

  const draft = drafts?.[0] ?? null;
  const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "No date");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
        <StageTag stage={item.stage} />
        <span className="aw-num">{fmtNum(item.volume)} searches / mo</span>
        <Difficulty kd={item.difficulty} />
        <span>{fmtDate(item.due_date)}</span>
        <span className="aw-status aw-status--pending">{STATUSES.find((s) => s.id === item.status)?.label}</span>
      </div>

      <Seg
        label="Content piece"
        value={tab}
        onChange={setTab}
        options={[
          { id: "overview", label: "Overview" },
          { id: "brief", label: brief?.brief_status === "done" ? "Content Brief ✓" : brief?.brief_status === "running" ? "Content Brief ···" : "Content Brief" },
          { id: "draft", label: draft ? "Content Draft ✓" : "Content Draft" },
        ]}
      />
      {error ? <p className="aw-error">{error}</p> : null}

      {tab === "overview" ? (
        <Overview item={item} canEdit={canEdit} onPatch={onPatch} onRemove={onRemove} />
      ) : tab === "brief" ? (
        !brief || guideline === undefined ? (
          <p className="aw-small">Loading...</p>
        ) : running ? (
          <div className="aw-frame flex flex-col items-center gap-3 px-6 py-16 text-center" role="status" aria-live="polite">
            <span className="aw-think__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 1.5c.6 4.9 2.9 8.6 10.5 10.5-7.6 1.9-9.9 5.6-10.5 10.5-.6-4.9-2.9-8.6-10.5-10.5C9.1 10.1 11.4 6.4 12 1.5z" />
              </svg>
            </span>
            <span className="aw-h4">Reading Google&apos;s top 10 and writing the brief...</span>
          </div>
        ) : !brief.brief ? (
          <div className="aw-frame flex flex-col items-start gap-4 p-8">
            {brief.brief_status === "failed" ? <p className="aw-error">{brief.brief_error}</p> : null}
            <h3 className="aw-h3">{item.keyword}</h3>
            {canEdit ? (
              <button type="button" className="aw-btn aw-btn--accent" onClick={createBrief}>
                ✦ Create content brief
              </button>
            ) : null}
          </div>
        ) : (
          <BriefEditor
            key={brief.brief_at ?? "brief"}
            sb={sb}
            item={item}
            brief={brief.brief}
            html={brief.brief.doc ?? briefDocHtml(item, brief.brief, { name: brandName, country: site.profile.country }, guideline)}
            canEdit={canEdit}
            onSaved={(b) => setBrief({ ...brief, brief: b })}
            onRecreate={createBrief}
            onWriter={() => toWriter()}
          />
        )
      ) : (
        <div className="aw-frame flex flex-col items-start gap-4 p-8">
          {draft ? (
            <>
              <h3 className="aw-h3">{draft.title}</h3>
              <span className="aw-num text-[13px] text-muted">
                {draft.words} words · updated {new Date(draft.updated_at).toLocaleDateString()}
              </span>
              <button type="button" className="aw-btn aw-btn--accent" onClick={() => toWriter()}>
                Open in Writer
              </button>
            </>
          ) : (
            <>
              <h3 className="aw-h3">{item.keyword}</h3>
              {canEdit ? (
                <span className="flex flex-wrap gap-2">
                  {brief?.brief ? (
                    <button type="button" className="aw-btn aw-btn--accent" onClick={() => toWriter()}>
                      Import brief into Writer
                    </button>
                  ) : (
                    <button type="button" className="aw-btn aw-btn--accent" onClick={createBrief}>
                      ✦ Create content brief first
                    </button>
                  )}
                  <button type="button" className="aw-btn aw-btn--secondary" onClick={() => toWriter(true)}>
                    Start a blank draft
                  </button>
                </span>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Overview({ item, canEdit, onPatch, onRemove }: { item: CalendarItem; canEdit: boolean; onPatch: (p: Partial<CalendarItem>) => void; onRemove: () => void }) {
  const [keyword, setKeyword] = useState(item.keyword);
  const [owner, setOwner] = useState(item.owner ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [url, setUrl] = useState(item.url ?? "");
  const field = (label: string, input: React.ReactNode) => (
    <label className="flex flex-col gap-1.5">
      <span className="aw-label">{label}</span>
      {input}
    </label>
  );
  const box = `${FIELD} h-10 w-full text-[14px]!`;
  return (
    <div className="aw-frame grid gap-5 p-6 sm:grid-cols-2">
      {field("Keyword", <input value={keyword} disabled={!canEdit} onChange={(e) => setKeyword(e.target.value)} onBlur={() => keyword.trim() && keyword !== item.keyword && onPatch({ keyword: keyword.trim() })} className={box} />)}
      {field(
        "Status",
        <select value={item.status} disabled={!canEdit} onChange={(e) => onPatch({ status: e.target.value as CalendarStatus })} className={box}>
          {STATUSES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>,
      )}
      {field("Publish date", <input type="date" value={item.due_date ?? ""} disabled={!canEdit} onChange={(e) => onPatch({ due_date: e.target.value || null })} className={box} />)}
      {field("Owner", <input value={owner} disabled={!canEdit} onChange={(e) => setOwner(e.target.value)} onBlur={() => owner !== (item.owner ?? "") && onPatch({ owner: owner || null })} placeholder="Who writes it" className={box} />)}
      {field("Live URL", <input value={url} disabled={!canEdit} onChange={(e) => setUrl(e.target.value)} onBlur={() => url !== (item.url ?? "") && onPatch(url && item.action === "new" ? { url, status: "published" } : { url: url || null })} placeholder="https://" className={box} />)}
      {field("Also covers", <span className="flex min-h-10 items-center text-[14px] text-body">{item.secondary.join(" · ") || "–"}</span>)}
      <div className="sm:col-span-2">
        {field("Notes", <textarea value={notes} disabled={!canEdit} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (item.notes ?? "") && onPatch({ notes: notes || null })} rows={4} className="aw-textarea text-[14px]!" />)}
      </div>
      {canEdit ? (
        <div className="sm:col-span-2">
          <button type="button" className="aw-text-link text-[13px] text-neg!" onClick={onRemove}>
            Remove from calendar
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DocToolbar({ editor }: { editor: Editor }) {
  const b = (label: string, on: boolean, run: () => void, title: string) => (
    <button type="button" title={title} aria-label={title} aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={run} className={`aw-tool ${on ? "is-on" : ""}`}>
      {label}
    </button>
  );
  const c = () => editor.chain().focus();
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-rule bg-white px-3 py-2">
      {b("H1", editor.isActive("heading", { level: 1 }), () => c().toggleHeading({ level: 1 }).run(), "Heading 1")}
      {b("H2", editor.isActive("heading", { level: 2 }), () => c().toggleHeading({ level: 2 }).run(), "Heading 2")}
      {b("H3", editor.isActive("heading", { level: 3 }), () => c().toggleHeading({ level: 3 }).run(), "Heading 3")}
      {b("¶", editor.isActive("paragraph"), () => c().setParagraph().run(), "Paragraph")}
      <span className="mx-1 h-5 w-px bg-rule" />
      {b("B", editor.isActive("bold"), () => c().toggleBold().run(), "Bold")}
      {b("I", editor.isActive("italic"), () => c().toggleItalic().run(), "Italic")}
      {b("•", editor.isActive("bulletList"), () => c().toggleBulletList().run(), "Bullet list")}
      {b("1.", editor.isActive("orderedList"), () => c().toggleOrderedList().run(), "Numbered list")}
      {b("🔗", editor.isActive("link"), () => {
        if (editor.isActive("link")) return c().unsetLink().run();
        const url = prompt("Link to");
        if (url) c().setLink({ href: url }).run();
      }, "Link")}
      <span className="mx-1 h-5 w-px bg-rule" />
      {b("⊞", false, () => c().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run(), "Insert table")}
      {editor.isActive("table") ? (
        <>
          {b("+Row", false, () => c().addRowAfter().run(), "Add row")}
          {b("+Col", false, () => c().addColumnAfter().run(), "Add column")}
          {b("−Row", false, () => c().deleteRow().run(), "Delete row")}
        </>
      ) : null}
      <span className="mx-1 h-5 w-px bg-rule" />
      {b("↶", false, () => c().undo().run(), "Undo")}
      {b("↷", false, () => c().redo().run(), "Redo")}
    </div>
  );
}

/** The brief as a document you can edit, download as Word, and send to the Writer. */
function BriefEditor({
  sb,
  item,
  brief,
  html,
  canEdit,
  onSaved,
  onRecreate,
  onWriter,
}: {
  sb: SupabaseClient;
  item: CalendarItem;
  brief: Brief;
  html: string;
  canEdit: boolean;
  onSaved: (b: Brief) => void;
  onRecreate: () => void;
  onWriter: () => void;
}) {
  const [state, setState] = useState<"saved" | "saving" | "error">("saved");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }), Link.configure({ openOnClick: false }), Table.configure({ resizable: false }), TableRow, TableHeader, TableCell],
    content: html,
    onUpdate: ({ editor: ed }) => {
      if (!canEdit) return;
      if (timer.current) clearTimeout(timer.current);
      setState("saving");
      timer.current = setTimeout(async () => {
        const next: Brief = { ...brief, doc: ed.getHTML(), docAt: new Date().toISOString() };
        try {
          await saveBrief(sb, item.id, next);
          onSaved(next);
          setState("saved");
        } catch {
          setState("error");
        }
      }, 1500);
    },
  });
  const title = `Content Brief - ${brief.brief.h1 || item.keyword}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="aw-num mr-auto text-[12px] text-muted">{state === "saving" ? "Saving..." : state === "error" ? "Not saved" : "Saved"}</span>
        <button
          type="button"
          className="aw-btn aw-btn--secondary aw-btn--sm"
          onClick={() => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([wordFile(title, editor?.getHTML() ?? html)], { type: "application/msword" }));
            a.download = `${title.replace(/[^\w-]+/g, "-")}.doc`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          Download .doc
        </button>
        <button
          type="button"
          className="aw-btn aw-btn--secondary aw-btn--sm"
          onClick={async () => {
            const out = editor?.getHTML() ?? html;
            await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([out], { type: "text/html" }), "text/plain": new Blob([editor?.getText() ?? ""], { type: "text/plain" }) })]).catch(() => navigator.clipboard.writeText(editor?.getText() ?? ""));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {canEdit ? (
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => confirm("Write the brief again? Your edits to this brief will be replaced.") && onRecreate()}>
            Recreate
          </button>
        ) : null}
        {canEdit ? (
          <button type="button" className="aw-btn aw-btn--accent aw-btn--sm" onClick={onWriter}>
            Import into Writer →
          </button>
        ) : null}
      </div>
      <section className="aw-frame">
        {editor && canEdit ? <DocToolbar editor={editor} /> : null}
        <div className="aw-editor aw-doc px-6 py-8 sm:px-12">
          <EditorContent editor={editor} />
        </div>
      </section>
    </div>
  );
}
