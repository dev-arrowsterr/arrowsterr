"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import { createDoc, deleteDoc, getBrief, listCalendar, updateCalendarItem, type CalendarItem, getDoc, getGuideline, listDocs, saveDoc, type Doc, type DocMeta, type Site } from "@/lib/db";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import { briefGuides, briefToDoc, type Guide } from "@/lib/writer";
import type { BrandGuideline } from "@/lib/writerTypes";
import { Thinking } from "../ui";
import { GuideRail, railSections, type RailSection } from "./CommentRail";
import { Embed, exportClean, Note } from "./writerNodes";
import { PublishPanel } from "./PublishPanel";

const wi = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
/** Icons for the writer's header and side panel. */
const WI = {
  code: wi(<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />),
  download: wi(<path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 20h14" />),
  expand: wi(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />),
  shrink: wi(<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />),
  send: wi(<path d="M4 12 20 4l-6 16-3-7z" />),
};

/** The writer's own text, without the notes. */
const draftText = (ed: Editor) => {
  const parts: string[] = [];
  ed.state.doc.forEach((n) => {
    if (n.type.name !== "note") parts.push(n.textContent);
  });
  return parts.join("\n");
};
/** Tables in the brand's style for export: the main brand color on the header row. */
export const brandTables = (html: string, g: BrandGuideline | null) => {
  const main = g?.colors.find((c) => /primary|brand|main/i.test(`${c.name} ${c.use}`))?.hex ?? g?.colors[0]?.hex ?? "#0943B0";
  return html
    .replace(/<table(?![^>]*style=)/g, '<table style="width:100%;border-collapse:collapse;margin:1.5em 0"')
    .replace(/<th(?=[\s>])(?![^>]*style=)/g, `<th style="background:${main};color:#fff;text-align:left;padding:10px 12px"`)
    .replace(/<td(?=[\s>])(?![^>]*style=)/g, '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb"');
};
const ago = (iso: string) => {
  const d = (Date.now() - Date.parse(iso)) / 1000;
  return d < 60 ? "just now" : d < 3600 ? `${Math.round(d / 60)}m ago` : d < 86400 ? `${Math.round(d / 3600)}h ago` : new Date(iso).toLocaleDateString();
};

/** The Writer's Workspace: drafts started from content briefs, a brand guideline built from the site, and an assistant that follows both. */
export function Writer({ sb, auth, site, canEdit }: { sb: SupabaseClient; auth: RunAuth; site: Site; canEdit: boolean }) {
  const k = (name: string) => `writer:${site.id}:${name}`;
  const [docs, setDocs] = useStash<DocMeta[] | null>(k("docs"), null);
  const [openId, setOpenId] = useStash<string | null>(k("open"), null);
  const [guideline, setGuideline] = useStash<BrandGuideline | null | undefined>(k("guideline"), undefined);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const list = await listDocs(sb, site.id);
      setDocs(list);
      setGuideline(await getGuideline(sb, site.id));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(/docs|guideline/.test(message) ? `${message}. Run supabase/010_writer.sql in Supabase → SQL Editor.` : message);
      setDocs([]);
    }
  }, [sb, site.id, setDocs, setGuideline]);

  useEffect(() => {
    // Loading from Supabase on first render is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    if (!openId) return;
    let live = true;
    getDoc(sb, openId)
      .then((d) => live && setDoc(d))
      .catch(() => live && setOpenId(null));
    return () => {
      live = false;
    };
  }, [sb, openId, setOpenId]);

  async function remove(id: string) {
    if (!confirm("Delete this draft?")) return;
    try {
      await deleteDoc(sb, id);
      setDocs((docs ?? []).filter((d) => d.id !== id));
      if (openId === id) {
        setOpenId(null);
        setDoc(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!docs) return <Thinking text="Opening your workspace..." />;

  async function blank() {
    setError("");
    try {
      const d = await createDoc(sb, { workspace_id: auth.workspaceId, site_id: site.id, title: "Untitled", content: { type: "doc", content: [{ type: "paragraph" }] } });
      setDocs([{ ...d }, ...docs!]);
      setOpenId(d.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const open = doc && doc.id === openId ? doc : null;
  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="aw-error">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <DraftMenu docs={docs} openId={openId} canEdit={canEdit} onOpen={setOpenId} onRemove={remove} onClose={() => setOpenId(null)} />
        {canEdit ? (
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={blank}>
            + New draft
          </button>
        ) : null}
      </div>

      {open ? (
        <DocEditor
          key={open.id}
          sb={sb}
          auth={auth}
          site={site}
          doc={open}
          canEdit={canEdit}
          guideline={guideline ?? null}
          onSaved={(meta) => setDocs((list) => [{ ...meta }, ...(list ?? []).filter((x) => x.id !== meta.id)])}
        />
      ) : openId ? (
        <Thinking text="Opening the draft..." />
      ) : docs.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {docs.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => setOpenId(d.id)} className="aw-frame flex h-full w-full flex-col gap-2 p-5 text-left transition-shadow hover:shadow-aw">
                <span className="line-clamp-2 text-[16px] font-medium text-ink">{d.title || "Untitled"}</span>
                <span className="aw-num mt-auto text-[12px] text-muted">
                  {d.words} words · {ago(d.updated_at)}
                  {d.calendar_item_id ? " · from brief" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <FromCalendar sb={sb} auth={auth} site={site} canEdit={canEdit} onBlank={blank} onOpen={(d) => {
          setDocs([d, ...docs]);
          setOpenId(d.id);
        }} />
      )}
    </div>
  );
}

/** With no drafts yet: start from a brief or a planned piece on the Editorial Calendar, or a blank page. */
function FromCalendar({ sb, auth, site, canEdit, onBlank, onOpen }: { sb: SupabaseClient; auth: RunAuth; site: Site; canEdit: boolean; onBlank: () => void; onOpen: (d: DocMeta) => void }) {
  const [items, setItems] = useState<CalendarItem[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    listCalendar(sb, site.id)
      .then((list) => live && setItems(list.filter((i) => i.status !== "published")))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [sb, site.id]);

  async function start(i: CalendarItem) {
    setError("");
    try {
      const b = i.brief_status === "done" ? (await getBrief(sb, i.id)).brief : null;
      const doc = await createDoc(sb, {
        workspace_id: auth.workspaceId,
        site_id: site.id,
        calendar_item_id: i.id,
        title: b?.brief.h1 || i.keyword,
        content: (b ? briefToDoc(i.keyword, i.secondary, b) : { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: i.keyword }] }, { type: "paragraph" }] }) as unknown as Record<string, unknown>,
      });
      if (i.status === "planned" || i.status === "brief") await updateCalendarItem(sb, i.id, { status: "writing" }).catch(() => {});
      onOpen(doc);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const briefs = (items ?? []).filter((i) => i.brief_status === "done");
  const planned = (items ?? []).filter((i) => i.brief_status !== "done").sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const card = (i: CalendarItem, tag: string) => (
    <li key={i.id}>
      <button type="button" disabled={!canEdit} onClick={() => start(i)} className="aw-frame flex h-full w-full flex-col gap-2 p-5 text-left transition-shadow hover:shadow-aw">
        <span className="flex items-center gap-2">
          <span className="aw-chip">{tag}</span>
          {i.due_date ? <span className="aw-num text-[12px] text-muted">{new Date(`${i.due_date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span> : null}
        </span>
        <span className="text-[16px] font-medium text-ink">{i.keyword}</span>
        <span className="mt-auto text-[13px] font-medium text-brand">Start writing →</span>
      </button>
    </li>
  );

  return (
    <div className="flex flex-col gap-6">
      {error ? <p className="aw-error">{error}</p> : null}
      <section className="aw-frame flex flex-wrap items-center justify-between gap-4 p-8">
        <span className="flex flex-col gap-1">
          <h2 className="aw-h3">Start writing</h2>
        </span>
        {canEdit ? (
          <button type="button" className="aw-btn aw-btn--secondary" onClick={onBlank}>
            Blank page
          </button>
        ) : null}
      </section>
      {items === null ? <Thinking text="Loading your calendar..." /> : null}
      {briefs.length ? (
        <section className="flex flex-col gap-3">
          <h3 className="aw-h4">Briefs ready to write</h3>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{briefs.map((i) => card(i, "Brief ready"))}</ul>
        </section>
      ) : null}
      {planned.length ? (
        <section className="flex flex-col gap-3">
          <h3 className="aw-h4">Planned on the calendar</h3>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{planned.slice(0, 12).map((i) => card(i, "Planned"))}</ul>
        </section>
      ) : null}
    </div>
  );
}

/** Pick a draft from a menu, so the editor gets the full width. */
function DraftMenu({ docs, openId, canEdit, onOpen, onRemove, onClose }: { docs: DocMeta[]; openId: string | null; canEdit: boolean; onOpen: (id: string) => void; onRemove: (id: string) => void; onClose: () => void }) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!show) return;
    const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as globalThis.Node) && setShow(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [show]);
  const cur = docs.find((d) => d.id === openId);
  return (
    <div className="relative" ref={ref}>
      <span className="flex items-center gap-1">
        {cur ? (
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onClose} aria-label="All drafts">
            ←
          </button>
        ) : null}
        <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm max-w-96" onClick={() => setShow(!show)} aria-expanded={show}>
          <span className="truncate">{cur ? cur.title || "Untitled" : `All drafts · ${docs.length}`}</span> ▾
        </button>
      </span>
      {show ? (
        <ul className="absolute z-30 mt-2 max-h-[60vh] w-80 overflow-auto rounded-aw border border-rule bg-white py-1 shadow-aw-lg">
          {docs.map((d) => (
            <li key={d.id} className={`group flex items-start gap-2 px-3 py-2 ${d.id === openId ? "bg-brand-pale" : "hover:bg-surface-2"}`}>
              <button
                type="button"
                className="min-w-0 flex-1 rounded-none text-left"
                onClick={() => {
                  onOpen(d.id);
                  setShow(false);
                }}
              >
                <span className="block truncate text-[14px] text-ink">{d.title || "Untitled"}</span>
                <span className="text-[11px] text-muted">
                  {d.words} words · {ago(d.updated_at)}
                </span>
              </button>
              {canEdit ? (
                <button type="button" aria-label={`Delete ${d.title}`} className="text-[12px] text-muted opacity-0 group-hover:opacity-100" onClick={() => onRemove(d.id)}>
                  ✕
                </button>
              ) : null}
            </li>
          ))}
          {!docs.length ? <li className="aw-small px-3 py-3">No drafts yet</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const b = (label: string, on: boolean, run: () => void, title: string) => (
    <button type="button" title={title} aria-label={title} aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={run} className={`aw-tool ${on ? "is-on" : ""}`}>
      {label}
    </button>
  );
  const c = () => editor.chain().focus();
  return (
    <div className="flex flex-wrap items-center gap-1">
      {b("H1", editor.isActive("heading", { level: 1 }), () => c().toggleHeading({ level: 1 }).run(), "Heading 1")}
      {b("H2", editor.isActive("heading", { level: 2 }), () => c().toggleHeading({ level: 2 }).run(), "Heading 2")}
      {b("H3", editor.isActive("heading", { level: 3 }), () => c().toggleHeading({ level: 3 }).run(), "Heading 3")}
      {b("¶", editor.isActive("paragraph"), () => c().setParagraph().run(), "Paragraph")}
      <span className="mx-1 h-5 w-px bg-rule" />
      {b("B", editor.isActive("bold"), () => c().toggleBold().run(), "Bold")}
      {b("I", editor.isActive("italic"), () => c().toggleItalic().run(), "Italic")}
      {b("•", editor.isActive("bulletList"), () => c().toggleBulletList().run(), "Bullet list")}
      {b("1.", editor.isActive("orderedList"), () => c().toggleOrderedList().run(), "Numbered list")}
      {b("❝", editor.isActive("blockquote"), () => c().toggleBlockquote().run(), "Quote")}
      {b("</>", editor.isActive("codeBlock"), () => c().toggleCodeBlock().run(), "Code block")}
      {b("🔗", editor.isActive("link"), () => {
        if (editor.isActive("link")) return c().unsetLink().run();
        const url = prompt("Link to");
        if (url) c().setLink({ href: url }).run();
      }, "Link")}
      <span className="mx-1 h-5 w-px bg-rule" />
      {b("↶", false, () => c().undo().run(), "Undo")}
      {b("↷", false, () => c().redo().run(), "Redo")}
    </div>
  );
}

function DocEditor({
  sb,
  auth,
  site,
  doc,
  canEdit,
  guideline,
  onSaved,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  site: Site;
  doc: Doc;
  canEdit: boolean;
  guideline: BrandGuideline | null;
  onSaved: (meta: DocMeta) => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const [state, setState] = useState<"saved" | "saving" | "error">("saved");
  const [text, setText] = useState("");
  const [rail, setRail] = useState<RailSection[]>([]);
  const [guides, setGuides] = useState<Map<string, Guide>>(new Map());
  const [full, setFull] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [cursor, setCursor] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef(title);

  const save = useCallback(
    (ed: Editor) => {
      if (!canEdit) return;
      if (timer.current) clearTimeout(timer.current);
      setState("saving");
      timer.current = setTimeout(async () => {
        const words = draftText(ed).split(/\s+/).filter(Boolean).length;
        try {
          await saveDoc(sb, doc.id, { title: titleRef.current || "Untitled", content: ed.getJSON() as Record<string, unknown>, words });
          setState("saved");
          onSaved({ id: doc.id, site_id: doc.site_id, calendar_item_id: doc.calendar_item_id, title: titleRef.current || "Untitled", words, updated_at: new Date().toISOString() });
        } catch {
          setState("error");
        }
      }, 1200);
    },
    [sb, doc.id, doc.site_id, doc.calendar_item_id, canEdit, onSaved],
  );

  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : "Start writing, or let the agent on the right write it...") }),
      Note,
      Embed,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: doc.content && Object.keys(doc.content).length ? doc.content : undefined,
    onCreate: ({ editor: ed }) => {
      setRail(railSections(ed));
      setText(draftText(ed));
    },
    onSelectionUpdate: ({ editor: ed }) => setCursor(ed.state.selection.from),
    onUpdate: ({ editor: ed }) => {
      setRail(railSections(ed));
      setText(draftText(ed));
      save(ed);
    },
  });

  // The guide for each heading comes from the brief the draft was made from.
  useEffect(() => {
    if (!doc.calendar_item_id) return;
    let live = true;
    getBrief(sb, doc.calendar_item_id)
      .then((b) => live && b.brief && setGuides(briefGuides(b.keyword ?? doc.title, b.secondary ?? [], b.brief)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sb, doc.calendar_item_id, doc.title]);

  // Full screen closes with Escape.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [full]);

  const exportHtml = () => brandTables(exportClean(editor?.getHTML() ?? ""), guideline);
  const icon = (label: string, icon: React.ReactNode, run: () => void, pressed?: boolean) => (
    <button type="button" className="aw-iconbtn" title={label} aria-label={label} aria-pressed={pressed} onClick={run}>
      {icon}
    </button>
  );

  return (
    <div className={full ? "fixed inset-0 z-[70] overflow-y-auto bg-surface-2 p-3 md:p-6" : ""}>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="aw-frame flex min-w-0 flex-col">
          <div className={`sticky z-20 flex flex-wrap items-center gap-2 rounded-t-[inherit] border-b border-rule bg-white px-3 py-2 ${full ? "top-0" : "top-[57px]"}`}>
            {editor && canEdit ? <Toolbar editor={editor} /> : <span className="flex-1" />}
            <span className="aw-wbar ml-auto">
              <span className="mr-1 flex items-center gap-1.5 text-[12px] text-muted" title={state === "error" ? "Not saved" : state === "saving" ? "Saving" : "Saved"}>
                <i className={`inline-block h-1.5 w-1.5 rounded-full ${state === "error" ? "bg-neg" : state === "saving" ? "bg-warn" : "bg-pos"}`} aria-hidden="true" />
                {state === "error" ? "Not saved" : state === "saving" ? "Saving" : "Saved"}
              </span>
              {icon("Copy HTML", WI.code, () => navigator.clipboard.writeText(exportHtml()))}
              {icon("Download HTML", WI.download, () => {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(new Blob([`<!doctype html><meta charset="utf-8"><title>${title}</title>\n${exportHtml()}`], { type: "text/html" }));
                a.download = `${(title || "draft").replace(/\W+/g, "-")}.html`;
                a.click();
                URL.revokeObjectURL(a.href);
              })}
              {icon(full ? "Exit full screen (Esc)" : "Full screen", full ? WI.shrink : WI.expand, () => setFull(!full), full)}
              {canEdit ? (
                <button type="button" className="aw-btn aw-btn--primary aw-btn--sm ml-1" onClick={() => setPublishing(true)}>
                  {WI.send}
                  Publish
                </button>
              ) : null}
            </span>
          </div>
          <div className="aw-editor aw-editor--draft min-h-[75vh] px-6 py-10 sm:px-14">
            <input
              value={title}
              disabled={!canEdit}
              onChange={(e) => {
                setTitle(e.target.value);
                titleRef.current = e.target.value;
                if (editor) save(editor);
              }}
              placeholder="Untitled"
              aria-label="Draft title"
              className="mx-auto mb-6 block w-full max-w-[760px] border-0 bg-transparent px-0 font-mono text-[12px] tracking-[0.08em] text-muted uppercase outline-none placeholder:text-faint"
            />
            <EditorContent editor={editor} />
          </div>
        </section>

        <aside className="hidden min-w-0 pt-[64px] xl:block">
          {editor ? <GuideRail sb={sb} auth={auth} siteId={site.id} docId={doc.id} editor={editor} sections={rail} guides={guides} docText={text} canEdit={canEdit} cursor={cursor} /> : null}
        </aside>
      </div>
      {publishing ? <PublishPanel sb={sb} auth={auth} docId={doc.id} title={title} html={exportHtml} onClose={() => setPublishing(false)} /> : null}
    </div>
  );
}
