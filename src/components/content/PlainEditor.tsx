"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveDoc, type Doc, type DocMeta } from "@/lib/db";
import { SLASH, SlashMenu, slashKeysExtension } from "../research/DocsEditor";
import { draftText } from "../research/Writer";
import { Embed, Note } from "../research/writerNodes";

// The plain editor in Content: the editing core of the Agentic Writer (DocsEditor) with no AI in it.
// Text, headings, lists, links, images, tables and interactive blocks. It saves as you type.

const PLAIN_SLASH = SLASH.filter((s) => !s.ai);
const countWords = (ed: Editor) => draftText(ed).split(/\s+/).filter(Boolean).length;

export type SaveState = "saved" | "saving" | "error";

/** The article's text editor. editor() hands the parent the live editor, for export and publishing. */
export function PlainEditor({
  sb,
  workspaceId,
  doc,
  canEdit,
  onSaved,
  onEditor,
  onState,
}: {
  sb: SupabaseClient;
  workspaceId: string;
  doc: Doc;
  canEdit: boolean;
  onSaved: (meta: DocMeta) => void;
  onEditor: (ed: Editor | null) => void;
  onState: (s: SaveState, note?: string) => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef(title);
  const canvas = useRef<HTMLDivElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const uploadRef = useRef<(files: File[], at?: number) => void>(() => {});
  // A plain box the slash menu fills with its key handler, read by the editor plugin.
  const [slashKeys] = useState<{ current: ((e: KeyboardEvent) => boolean) | null }>(() => ({ current: null }));
  const [slashExt] = useState(() => slashKeysExtension(slashKeys));

  // The same save path as the Agentic Writer: the whole draft, a moment after typing stops.
  const save = useCallback(
    (ed: Editor) => {
      if (!canEdit) return;
      if (timer.current) clearTimeout(timer.current);
      onState("saving");
      timer.current = setTimeout(async () => {
        timer.current = null;
        const words = countWords(ed);
        try {
          await saveDoc(sb, doc.id, { title: titleRef.current || "Untitled", content: ed.getJSON() as Record<string, unknown>, words });
          onState("saved");
          onSaved({ id: doc.id, site_id: doc.site_id, calendar_item_id: doc.calendar_item_id, title: titleRef.current || "Untitled", words, updated_at: new Date().toISOString() });
        } catch {
          onState("error");
        }
      }, 1200);
    },
    [sb, doc.id, doc.site_id, doc.calendar_item_id, canEdit, onSaved, onState],
  );

  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Link.configure({ openOnClick: false }),
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : "Type / for headings, lists, images and tables") }),
      Note,
      Embed,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      slashExt,
    ],
    content: doc.content && Object.keys(doc.content).length ? doc.content : undefined,
    editorProps: {
      // Paste or drop pictures straight into the article.
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        uploadRef.current(files);
        return true;
      },
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();
        uploadRef.current(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => save(ed),
  });

  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);
  // Save what's pending when the article closes.
  useEffect(
    () => () => {
      if (!timer.current || !editor) return;
      clearTimeout(timer.current);
      try {
        void saveDoc(sb, doc.id, { title: titleRef.current || "Untitled", content: editor.getJSON() as Record<string, unknown>, words: countWords(editor) }).catch(() => {});
      } catch {
        // The editor is already gone. What was typed before the last pause is saved.
      }
    },
    [editor, sb, doc.id],
  );

  /** Upload pictures to the article's folder and put them in. Alt text is the file name; edit it on the site. */
  async function upload(files: File[], at?: number) {
    if (!editor || !canEdit) return;
    for (const f of files) {
      if (f.size > 10 * 1024 * 1024) {
        onState("error", `${f.name} is over 10 MB.`);
        continue;
      }
      onState("saving", `Uploading ${f.name}...`);
      const path = `${workspaceId}/${doc.id}/${Date.now()}-${f.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-")}`;
      const { error } = await sb.storage.from("doc-images").upload(path, f, { contentType: f.type, upsert: false });
      if (error) {
        onState("error", /bucket|not found/i.test(error.message) ? "Run supabase/028_doc_images.sql in Supabase to turn on images." : error.message);
        continue;
      }
      const src = sb.storage.from("doc-images").getPublicUrl(path).data.publicUrl;
      const alt = f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ");
      editor
        .chain()
        .focus()
        .insertContentAt(at ?? editor.state.selection.to, { type: "image", attrs: { src, alt } })
        .run();
    }
  }
  useEffect(() => {
    uploadRef.current = upload;
  });

  /** Do what a slash menu choice says, after the "/word" is taken out. */
  function slash(id: string, range: { from: number; to: number }) {
    if (!editor) return;
    const c = editor.chain().focus().deleteRange(range);
    if (id === "h1" || id === "h2" || id === "h3") c.setNode("heading", { level: Number(id[1]) }).run();
    else if (id === "p") c.setParagraph().run();
    else if (id === "bullet") c.toggleBulletList().run();
    else if (id === "numbered") c.toggleOrderedList().run();
    else if (id === "quote") c.toggleBlockquote().run();
    else if (id === "table") c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    else if (id === "divider") c.setHorizontalRule().run();
    else {
      c.run();
      if (id === "image") fileInput.current?.click();
    }
  }

  return (
    <section className="aw-frame flex min-w-0 flex-col">
      <div className="sticky top-[57px] z-20 flex flex-wrap items-center gap-2 border-b border-rule bg-white px-3 py-2">
        {editor && canEdit ? <PlainToolbar editor={editor} onImage={() => fileInput.current?.click()} /> : <span className="flex-1" />}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) upload(files);
        }}
      />
      <div ref={canvas} className="aw-editor aw-editor--draft relative min-h-[75vh] px-6 py-10 sm:px-14 [&_img]:h-auto [&_img]:max-w-full">
        <input
          value={title}
          disabled={!canEdit}
          onChange={(e) => {
            setTitle(e.target.value);
            titleRef.current = e.target.value;
            if (editor) save(editor);
          }}
          placeholder="Untitled"
          aria-label="Article title"
          className="mx-auto mb-6 block w-full max-w-[760px] border-0 bg-transparent px-0 font-mono text-[12px] tracking-[0.08em] text-muted uppercase outline-none placeholder:text-faint"
        />
        <EditorContent editor={editor} />
        {editor && canEdit ? <SlashMenu editor={editor} canvas={canvas} keysRef={slashKeys} onPick={slash} items={PLAIN_SLASH} /> : null}
      </div>
    </section>
  );
}

const svg = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const ICON = {
  link: svg(<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />),
  image: svg(
    <>
      <rect x={3.5} y={4.5} width={17} height={15} rx={1} />
      <path d="m3.5 16 5-5 4 4 3-3 5 5" />
    </>,
  ),
  table: svg(
    <>
      <rect x={3.5} y={4.5} width={17} height={15} rx={1} />
      <path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10M15 9.5v10" />
    </>,
  ),
};

/** Formatting buttons. A link opens a small field in the bar instead of the browser's prompt. */
function PlainToolbar({ editor, onImage }: { editor: Editor; onImage: () => void }) {
  const [link, setLink] = useState<string | null>(null);
  const b = (label: React.ReactNode, on: boolean, run: () => void, title: string) => (
    <button key={title} type="button" title={title} aria-label={title} aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={run} className={`aw-tool ${on ? "is-on" : ""}`}>
      {label}
    </button>
  );
  const c = () => editor.chain().focus();
  const inTable = editor.isActive("table");
  function applyLink() {
    const href = (link ?? "").trim();
    if (href) c().extendMarkRange("link").setLink({ href: /^(https?:|mailto:|\/|#)/i.test(href) ? href : `https://${href}` }).run();
    setLink(null);
  }
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
      {b(ICON.link, editor.isActive("link"), () => (editor.isActive("link") ? c().unsetLink().run() : setLink(String(editor.getAttributes("link").href ?? ""))), "Link")}
      {b(ICON.image, false, onImage, "Image")}
      {b(ICON.table, inTable, () => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), "Table")}
      {inTable ? (
        <>
          {b("+ Row", false, () => c().addRowAfter().run(), "Add row")}
          {b("+ Col", false, () => c().addColumnAfter().run(), "Add column")}
          {b("− Row", false, () => c().deleteRow().run(), "Delete row")}
          {b("− Col", false, () => c().deleteColumn().run(), "Delete column")}
        </>
      ) : null}
      <span className="mx-1 h-5 w-px bg-rule" />
      {b("↶", false, () => c().undo().run(), "Undo")}
      {b("↷", false, () => c().redo().run(), "Redo")}
      {link !== null ? (
        <form
          className="ml-1 flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            applyLink();
          }}
        >
          <input
            autoFocus
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setLink(null)}
            placeholder="https://"
            aria-label="Link to"
            className="aw-input h-8! w-56 py-0! text-[13px]!"
          />
          <button type="submit" className="aw-btn aw-btn--secondary aw-btn--sm">
            Add link
          </button>
        </form>
      ) : null}
    </div>
  );
}
