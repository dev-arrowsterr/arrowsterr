"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, mergeAttributes, Node, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Brief } from "@/lib/briefTypes";
import { createDoc, deleteDoc, ensureCalendarItem, getBrief, linkDoc, listCalendar, updateCalendarItem, type CalendarItem, getDoc, getGuideline, listDocs, saveDoc, type Doc, type DocMeta, type Site } from "@/lib/db";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import { briefDocHtml } from "@/lib/briefDoc";
import { briefToDoc, coverage, mdToHtml, type Section } from "@/lib/writer";
import type { BrandGuideline, ChatMessage } from "@/lib/writerTypes";
import { Seg, Thinking } from "../ui";
import { post } from "./shared";

/** A note to the writer. Shown in the editor, left out when the draft is copied or exported. */
const Note = Node.create({
  name: "note",
  group: "block",
  content: "inline*",
  defining: true,
  parseHTML: () => [{ tag: "aside[data-note]" }],
  renderHTML: ({ HTMLAttributes }) => ["aside", mergeAttributes(HTMLAttributes, { "data-note": "", class: "aw-note" }), 0],
});

/** The writer's own text, without the notes. */
const draftText = (ed: Editor) => {
  const parts: string[] = [];
  ed.state.doc.forEach((n) => {
    if (n.type.name !== "note") parts.push(n.textContent);
  });
  return parts.join("\n");
};
/** Body text without headings or notes, and the word count under each heading. */
const draftParts = (ed: Editor) => {
  const body: string[] = [];
  const sections: Section[] = [];
  ed.state.doc.forEach((n) => {
    if (n.type.name === "note") return;
    if (n.type.name === "heading") sections.push({ heading: n.textContent, words: 0 });
    else {
      body.push(n.textContent);
      if (sections.length) sections[sections.length - 1].words += n.textContent.split(/\s+/).filter(Boolean).length;
    }
  });
  return { body: body.join("\n"), sections };
};
const clean = (html: string) => html.replace(/<aside data-note[^>]*>[\s\S]*?<\/aside>/g, "");
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
  const [tab, setTab] = useStash<"assistant" | "brief" | "brand">(k("tab"), "assistant");
  const [side, setSide] = useStash(k("side"), true);
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
          onGuideline={setGuideline}
          tab={tab}
          onTab={setTab}
          side={side}
          onSide={setSide}
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
    <div className="flex flex-wrap items-center gap-1 border-b border-rule px-3 py-2">
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
      {b("✎", editor.isActive("note"), () => (editor.isActive("note") ? c().setParagraph().run() : c().setNode("note").run()), "Writer note (left out of exports)")}
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
  onGuideline,
  tab,
  onTab,
  side,
  onSide,
  onSaved,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  site: Site;
  doc: Doc;
  canEdit: boolean;
  guideline: BrandGuideline | null;
  onGuideline: (g: BrandGuideline) => void;
  tab: "assistant" | "brief" | "brand";
  onTab: (t: "assistant" | "brief" | "brand") => void;
  side: boolean;
  onSide: (v: boolean) => void;
  onSaved: (meta: DocMeta) => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const [state, setState] = useState<"saved" | "saving" | "error">("saved");
  const [text, setText] = useState("");
  const [html, setHtml] = useState("");
  const [parts, setParts] = useState<{ body: string; sections: Section[] }>({ body: "", sections: [] });
  const [brief, setBrief] = useState<Brief | null>(null);
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
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }), Link.configure({ openOnClick: false }), Placeholder.configure({ placeholder: "Start writing..." }), Note],
    content: doc.content && Object.keys(doc.content).length ? doc.content : undefined,
    onCreate: ({ editor: ed }) => {
      setParts(draftParts(ed));
      setText(draftText(ed));
      setHtml(clean(ed.getHTML()));
    },
    onUpdate: ({ editor: ed }) => {
      setParts(draftParts(ed));
      setText(draftText(ed));
      setHtml(clean(ed.getHTML()));
      save(ed);
    },
  });

  const [itemId, setItemId] = useState(doc.calendar_item_id);
  useEffect(() => {
    if (!itemId) return;
    let live = true;
    getBrief(sb, itemId)
      .then((b) => live && setBrief(b.brief))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sb, itemId]);

  const words = text.split(/\s+/).filter(Boolean).length;
  const cov = brief ? coverage(parts.body, html, brief, parts.sections) : null;
  const exportHtml = () => clean(editor?.getHTML() ?? "");

  const target = brief ? Number((brief.brief.wordCount.match(/[\d,]+/g) ?? []).pop()?.replace(/,/g, "") ?? 0) : 0;
  return (
    <div className={`grid items-start gap-4 ${side ? "xl:grid-cols-[minmax(0,1fr)_400px]" : ""}`}>
      <section className="aw-frame flex min-w-0 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-rule px-5 py-3">
          <span className="flex min-w-40 flex-1 items-center gap-3 text-[13px] text-muted">
            <span className="aw-num">
              {words.toLocaleString()} words{brief ? ` / ${brief.brief.wordCount}` : ""}
            </span>
            {target ? (
              <span className="aw-progress w-32" title={`${Math.round((words / target) * 100)}% of the target length`}>
                <span className="aw-progress__fill block" style={{ width: `${Math.min(100, (words / target) * 100)}%` }} />
              </span>
            ) : null}
            <span>{state === "saving" ? "Saving..." : state === "error" ? "Not saved" : "Saved"}</span>
          </span>
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => navigator.clipboard.writeText(exportHtml())}>
            Copy HTML
          </button>
          <button
            type="button"
            className="aw-btn aw-btn--secondary aw-btn--sm"
            onClick={() => {
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob([`<!doctype html><meta charset="utf-8"><title>${title}</title>\n${exportHtml()}`], { type: "text/html" }));
              a.download = `${(title || "draft").replace(/\W+/g, "-")}.html`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            Download
          </button>
          <button type="button" className={`aw-btn aw-btn--sm ${side ? "aw-btn--primary" : "aw-btn--secondary"}`} onClick={() => onSide(!side)} aria-pressed={side}>
            {side ? "Hide panel" : `Assistant${cov ? ` · Brief ${cov.score}%` : ""}`}
          </button>
        </div>
        {editor && canEdit ? (
          <div className="sticky top-[57px] z-10 rounded-none bg-white">
            <Toolbar editor={editor} />
          </div>
        ) : null}
        <div className="aw-editor min-h-[75vh] flex-1 px-6 py-10 sm:px-16">
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

      {side ? (
      <aside className="aw-frame flex max-h-[calc(100vh-110px)] min-w-0 flex-col xl:sticky xl:top-[72px]">
        <div className="border-b border-rule px-3 py-2.5">
          <Seg
            label="Side panel"
            value={tab}
            onChange={onTab}
            options={[
              { id: "assistant", label: "Assistant" },
              { id: "brief", label: cov ? `Brief ${cov.score}%` : "Brief +" },
              { id: "brand", label: "Brand" },
            ]}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {tab === "assistant" ? (
            <Assistant auth={auth} site={site} docId={doc.id} editor={editor} text={text} canEdit={canEdit} />
          ) : tab === "brief" ? (
            <BriefTab sb={sb} auth={auth} site={site} docId={doc.id} title={title} itemId={itemId} brief={brief} cov={cov} canEdit={canEdit} onLinked={setItemId} onBrief={setBrief} />
          ) : (
            <BrandPanel auth={auth} site={site} guideline={guideline} onGuideline={onGuideline} canEdit={canEdit} />
          )}
        </div>
      </aside>
      ) : null}
    </div>
  );
}

const QUICK = [
  { label: "Ideas for the intro", text: "Give me 3 different ways to open this article, each 2 sentences, in our brand voice." },
  { label: "Improve my selection", text: "Rewrite the text I selected so it follows our brand voice. Keep my meaning and facts." },
  { label: "Check my draft", text: "Check my draft against the brief and the brand guideline. List what to fix, most important first." },
  { label: "On-brand HTML section", text: "Build an on-brand HTML and CSS section for this page: a short comparison table with a call to action button." },
];

function Assistant({ auth, site, docId, editor, text, canEdit }: { auth: RunAuth; site: Site; docId: string; editor: Editor | null; text: string; canEdit: boolean }) {
  const [chat, setChat] = useStash<ChatMessage[]>(`writer:chat:${docId}`, []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const end = useRef<HTMLDivElement | null>(null);

  async function send(message: string) {
    if (!message.trim() || busy) return;
    const selection = editor ? editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " ") : "";
    const next = [...chat, { role: "user" as const, text: message }];
    setChat(next);
    setInput("");
    setBusy(true);
    setError("");
    try {
      const { reply } = await post<{ reply: string }>(auth, "/api/writer/assist", { siteId: site.id, docId, message, selection, docText: text, history: chat });
      setChat([...next, { role: "assistant", text: reply }]);
      setTimeout(() => end.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const htmlBlock = (s: string) => s.match(/```html\n([\s\S]*?)```/)?.[1] ?? null;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 p-4">
        {!chat.length ? (
          <div className="flex flex-col gap-2">
            {QUICK.map((q) => (
              <button key={q.label} type="button" className="aw-btn aw-btn--secondary aw-btn--sm justify-start" onClick={() => send(q.text)} disabled={!canEdit || busy}>
                {q.label}
              </button>
            ))}
          </div>
        ) : null}
        {chat.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-6 self-end bg-surface-2 px-3 py-2 text-[13px] text-ink">
              {m.text}
            </div>
          ) : (
            <div key={i} className="flex flex-col gap-2 border border-rule p-3">
              <div className="aw-md text-[13px] text-body" dangerouslySetInnerHTML={{ __html: mdToHtml(m.text) }} />
              <div className="flex flex-wrap gap-2">
                {canEdit && editor ? (
                  <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => editor.chain().focus().insertContent(mdToHtml(m.text)).run()}>
                    Insert
                  </button>
                ) : null}
                <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => navigator.clipboard.writeText(m.text)}>
                  Copy
                </button>
                {htmlBlock(m.text) ? (
                  <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setPreview(preview === m.text ? null : m.text)}>
                    {preview === m.text ? "Hide preview" : "Preview"}
                  </button>
                ) : null}
              </div>
              {preview === m.text ? <iframe title="Preview" sandbox="" srcDoc={htmlBlock(m.text) ?? ""} className="h-80 w-full border border-rule bg-white" /> : null}
            </div>
          ),
        )}
        {busy ? <p className="aw-small">Thinking...</p> : null}
        {error ? <p className="aw-error">{error}</p> : null}
        <div ref={end} />
      </div>
      <form
        className="sticky bottom-0 flex flex-col gap-2 border-t border-rule bg-white p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={2}
          placeholder="Ask the assistant..."
          aria-label="Message the assistant"
          disabled={!canEdit}
          className="w-full resize-none border border-rule px-2.5 py-2 text-[13px] text-ink outline-none focus:border-brand"
        />
        <div className="flex items-center justify-between">
          {chat.length ? (
            <button type="button" className="aw-text-link text-[12px]" onClick={() => setChat([])}>
              Clear chat
            </button>
          ) : (
            <span />
          )}
          <button type="submit" className="aw-btn aw-btn--primary aw-btn--sm" disabled={!canEdit || busy || !input.trim()}>
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

/** The brief beside the draft: a checklist of what it covers, the brief itself, or a button to write one. */
function BriefTab({
  sb,
  auth,
  site,
  docId,
  title,
  itemId,
  brief,
  cov,
  canEdit,
  onLinked,
  onBrief,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  site: Site;
  docId: string;
  title: string;
  itemId: string | null;
  brief: Brief | null;
  cov: ReturnType<typeof coverage> | null;
  canEdit: boolean;
  onLinked: (id: string) => void;
  onBrief: (b: Brief) => void;
}) {
  const [keyword, setKeyword] = useState(title.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim());
  const [state, setState] = useState<"idle" | "running" | "failed">("idle");
  const [error, setError] = useState("");
  const [view, setView] = useState<"check" | "brief">("check");

  // While the brief is being written, check on it every 4 seconds.
  useEffect(() => {
    if (state !== "running" || !itemId) return;
    const t = setInterval(async () => {
      const b = await getBrief(sb, itemId).catch(() => null);
      if (b?.brief_status === "done" && b.brief) {
        onBrief(b.brief);
        setState("idle");
      } else if (b?.brief_status === "failed") {
        setError(b.brief_error ?? "The brief failed.");
        setState("failed");
      }
    }, 4000);
    return () => clearInterval(t);
  }, [state, itemId, sb, onBrief]);

  async function create() {
    const kw = keyword.trim().replace(/\s+/g, " ");
    if (!kw) return;
    setError("");
    setState("running");
    try {
      let id = itemId;
      if (!id) {
        id = await ensureCalendarItem(sb, auth.workspaceId, site.id, kw);
        await linkDoc(sb, docId, id);
        onLinked(id);
      }
      await post(auth, "/api/research/brief", { itemId: id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("failed");
    }
  }

  if (state === "running")
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-12 text-center" role="status" aria-live="polite">
        <span className="aw-think__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M12 1.5c.6 4.9 2.9 8.6 10.5 10.5-7.6 1.9-9.9 5.6-10.5 10.5-.6-4.9-2.9-8.6-10.5-10.5C9.1 10.1 11.4 6.4 12 1.5z" />
          </svg>
        </span>
        <span className="text-[14px] font-medium text-ink">Reading Google&apos;s top 10 and writing the brief...</span>
      </div>
    );

  if (!brief || !cov)
    return (
      <div className="flex flex-col gap-3 p-4">
        {error ? <p className="aw-error">{error}</p> : null}
        <span className="text-[15px] font-medium text-ink">Create a content brief</span>
        {canEdit ? (
          <>
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Main keyword" aria-label="Main keyword" className="aw-input py-2! text-[14px]!" />
            <button type="button" className="aw-btn aw-btn--accent" onClick={create} disabled={!keyword.trim()}>
              ✦ Create content brief
            </button>
          </>
        ) : null}
      </div>
    );

  return (
    <div className="flex flex-col gap-3 p-4">
      <Seg
        label="Brief view"
        value={view}
        onChange={setView}
        options={[
          { id: "check", label: `Checklist ${cov.score}%` },
          { id: "brief", label: "Brief" },
        ]}
      />
      {view === "brief" ? (
        // The brief is built from escaped text, or saved from the brief editor, which only keeps its own nodes.
        <div className="aw-editor aw-doc aw-doc--side" dangerouslySetInnerHTML={{ __html: brief.doc ?? briefDocHtml({ keyword, secondary: [], action: "new", current_url: null }, brief, { name: site.name, country: site.profile.country }, null) }} />
      ) : (
        <>
          <div className="flex items-center gap-3">
            <span className="aw-num text-[28px] text-ink">{cov.score}%</span>
            <span className="text-[13px] text-body">of the brief covered</span>
          </div>
          <span className="h-1.5 rounded-full bg-rule-faint">
            <span className="block h-full rounded-full bg-brand" style={{ width: `${cov.score}%` }} />
          </span>
          <ul className="flex flex-col gap-1.5">
            {cov.items.map((i) => (
              <li key={`${i.kind}${i.label}`} className="flex items-start gap-2 text-[13px]">
                <span aria-label={i.done ? "Done" : "To do"} className={i.done ? "text-pos" : "text-muted"}>
                  {i.done ? "✓" : "○"}
                </span>
                <span className={i.done ? "text-muted line-through" : "text-ink"}>
                  <span className="aw-label mr-1.5">{i.kind}</span>
                  {i.label}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function BrandPanel({ auth, site, guideline, onGuideline, canEdit }: { auth: RunAuth; site: Site; guideline: BrandGuideline | null; onGuideline: (g: BrandGuideline) => void; canEdit: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function build() {
    setBusy(true);
    setError("");
    try {
      onGuideline((await post<{ guideline: BrandGuideline }>(auth, "/api/writer/guideline", { siteId: site.id })).guideline);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  if (busy) return <p className="aw-small p-4">Reading {site.domain} and its styles... about 30 seconds.</p>;
  if (!guideline)
    return (
      <div className="flex flex-col gap-3 p-4">
        {error ? <p className="aw-error">{error}</p> : null}
        <p className="text-[13px] text-body">
          The assistant reads the full homepage of {site.domain}, its stylesheets and copy, then writes a brand guideline: voice, words to use, colors, fonts and ready-made CSS.
          It follows this guideline in every answer.
        </p>
        {canEdit ? (
          <button type="button" className="aw-btn aw-btn--accent aw-btn--sm self-start" onClick={build}>
            Build brand guideline
          </button>
        ) : null}
      </div>
    );
  const g = guideline;
  const list = (title: string, items: string[]) =>
    items.length ? (
      <div className="flex flex-col gap-1">
        <span className="aw-label">{title}</span>
        <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[13px] text-body">
          {items.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <div className="flex flex-col gap-4 p-4">
      {error ? <p className="aw-error">{error}</p> : null}
      <p className="text-[13px] text-ink">{g.summary}</p>
      <div className="flex flex-wrap gap-1.5">
        {g.voice.tone.map((t) => (
          <span key={t} className="border border-rule px-2 py-0.5 text-[12px] text-ink">
            {t}
          </span>
        ))}
      </div>
      <blockquote className="border-l-2 border-brand pl-3 text-[13px] italic text-body">{g.voice.sample}</blockquote>
      {list("Do", g.voice.do)}
      {list("Don't", g.voice.dont)}
      {list("Writing rules", g.writing)}
      {g.vocabulary.use.length ? (
        <p className="text-[13px] text-body">
          <span className="aw-label mr-1.5">Use</span>
          {g.vocabulary.use.join(", ")}
        </p>
      ) : null}
      {g.vocabulary.avoid.length ? (
        <p className="text-[13px] text-body">
          <span className="aw-label mr-1.5">Avoid</span>
          {g.vocabulary.avoid.join(", ")}
        </p>
      ) : null}
      {list("Calls to action", g.ctas)}
      <div className="flex flex-col gap-1.5">
        <span className="aw-label">Colors</span>
        <ul className="grid grid-cols-2 gap-2">
          {g.colors.map((c) => (
            <li key={c.hex + c.name} className="flex items-center gap-2">
              <span className="h-7 w-7 shrink-0 border border-rule" style={{ background: c.hex }} aria-hidden="true" />
              <span className="min-w-0 text-[12px]">
                <span className="block text-ink">{c.name}</span>
                <span className="font-mono text-muted">{c.hex}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[13px] text-body">
        <span className="aw-label mr-1.5">Headings</span>
        {g.typography.headings}
        <br />
        <span className="aw-label mr-1.5">Body</span>
        {g.typography.body}
        {g.typography.notes ? (
          <>
            <br />
            {g.typography.notes}
          </>
        ) : null}
      </p>
      <p className="text-[13px] text-body">
        <span className="aw-label mr-1.5">Buttons</span>
        {g.ui.buttons} <span className="aw-label mx-1.5">Corners</span>
        {g.ui.corners}
      </p>
      {g.css ? (
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center justify-between">
            <span className="aw-label">Brand CSS</span>
            <button type="button" className="aw-text-link text-[12px]" onClick={() => navigator.clipboard.writeText(g.css)}>
              Copy
            </button>
          </span>
          <pre className="max-h-60 overflow-auto bg-surface-2 p-2 font-mono text-[11px] text-ink">{g.css}</pre>
        </div>
      ) : null}
      <span className="aw-label">Built {new Date(g.at).toLocaleString()}</span>
      {canEdit ? (
        <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm self-start" onClick={build}>
          Rebuild from homepage
        </button>
      ) : null}
    </div>
  );
}
