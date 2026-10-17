"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, Extension, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getBrief, getDocMeta, saveDoc, saveDocMeta, saveSite, type Doc, type DocMeta, type Site } from "@/lib/db";
import type { RunAuth } from "@/lib/runner";
import type { Brief } from "@/lib/briefTypes";
import { briefGuides, briefToDoc, guideKey, type Guide } from "@/lib/writer";
import { AGENT_TASKS, knowledgeText, REWRITES, tasksFor, type AgentTask, type WriterAgentResult } from "@/lib/writerAgent";
import type { BrandGuideline } from "@/lib/writerTypes";
import { AiIcon } from "../ui";
import { bodyOf, railSections, TaskIcon, type RailSection } from "./CommentRail";
import { PublishPanel } from "./PublishPanel";
import { post, StopButton, stopped, Tick } from "./shared";
import { brandTables, draftText, Toolbar } from "./Writer";
import { Embed, exportClean, Note } from "./writerNodes";

// The Agentic Writer, built like Google Docs: letter-size pages on a gray desk, one agent card at a time.
// Every line has its own agent button in the margin. Pick any text and ask the agent to rewrite it.
// The agent knows the brand guideline, the product knowledge and the content brief.

const PAGE_H = 1056; // US Letter at 96 dpi
const PAGE_GAP = 24;
const MARGIN = 96; // one inch
const PITCH = PAGE_H + PAGE_GAP;
const BODY_H = PAGE_H - 2 * MARGIN;

// ── Page breaks: a spacer before any block that would cross the bottom margin ──

const pagesKey = new PluginKey<DecorationSet>("awPages");
type Break = { pos: number; h: number };
const Pages = Extension.create({
  name: "awPages",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: pagesKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const next = tr.getMeta(pagesKey) as Break[] | undefined;
            if (!next) return set.map(tr.mapping, tr.doc);
            return DecorationSet.create(
              tr.doc,
              next.map((b) =>
                Decoration.widget(
                  b.pos,
                  () => {
                    const d = document.createElement("div");
                    d.className = "aw-pagebreak";
                    d.style.height = `${b.h}px`;
                    d.contentEditable = "false";
                    return d;
                  },
                  { key: `pb${b.pos}:${b.h}`, side: -1, ignoreSelection: true },
                ),
              ),
            );
          },
        },
        props: { decorations: (st) => pagesKey.getState(st) },
      }),
    ];
  },
});

type Block = { pos: number; size: number; top: number; h: number; type: string; level: number; text: string };

/** Lay the blocks out on pages. Returns the spacers to add and where each block sits. */
function layOut(ed: Editor): { breaks: Break[]; blocks: Block[]; pages: number } {
  const view = ed.view;
  const blocks: Block[] = [];
  const breaks: Break[] = [];
  let spacers = 0; // spacer height already on the page, above the block being measured
  let shift = 0; // spacer height in the new layout
  let bottom = 0;
  ed.state.doc.forEach((node, pos) => {
    const el = view.nodeDOM(pos) as HTMLElement | null;
    if (!el || !(el instanceof HTMLElement)) return;
    const prev = el.previousElementSibling as HTMLElement | null;
    if (prev?.classList.contains("aw-pagebreak")) spacers += prev.offsetHeight;
    const natural = el.offsetTop - spacers;
    const h = el.offsetHeight;
    let t = natural + shift;
    const page = Math.floor(t / PITCH);
    const end = page * PITCH + BODY_H;
    // A block that starts in the gap, or runs past the bottom margin, moves to the next page.
    if ((t + h > end && h <= BODY_H && t > page * PITCH + 1) || t > end) {
      const need = Math.round((page + 1) * PITCH - t);
      breaks.push({ pos, h: need });
      shift += need;
      t += need;
    }
    blocks.push({ pos, size: node.nodeSize, top: t, h, type: node.type.name, level: node.type.name === "heading" ? (node.attrs.level as number) : 0, text: node.textContent });
    bottom = t + h;
  });
  return { breaks, blocks, pages: Math.max(1, Math.floor(bottom / PITCH) + 1) };
}

/** Agent HTML, kept to the tags the article may use, before it is shown. */
function cleanHtml(html: string) {
  const ok = new Set(["P", "H3", "H4", "UL", "OL", "LI", "STRONG", "EM", "B", "I", "A", "BLOCKQUOTE", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "BR"]);
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const walk = (el: Element) => {
    for (const c of [...el.children]) {
      if (!ok.has(c.tagName)) {
        c.replaceWith(...[...c.childNodes]);
        continue;
      }
      for (const a of [...c.attributes]) if (!(c.tagName === "A" && a.name === "href" && /^https?:\/\//.test(a.value))) c.removeAttribute(a.name);
      walk(c);
    }
  };
  const root = doc.body.firstElementChild!;
  walk(root);
  return root.innerHTML;
}

type Target = { kind: "block"; pos: number; type: string; level: number; text: string } | { kind: "selection"; from: number; to: number; text: string };
type Result = { task: AgentTask; html?: string; note?: string; done?: string; preview?: boolean };
type CardState = "idle" | "busy" | Result | { error: string };

/** The slash menu reads keys before the editor does, while it is open. */
export const slashKeysExtension = (box: { current: ((e: KeyboardEvent) => boolean) | null }) =>
  Extension.create({
    name: "awSlashKeys",
    addProseMirrorPlugins: () => [new Plugin({ props: { handleKeyDown: (_v, e) => box.current?.(e) ?? false } })],
  });

/** One choice in the slash menu. */
export type Slash = { id: string; label: string; hint: string; keys: string; icon: string; ai?: boolean };
export const SLASH: Slash[] = [
  { id: "h1", label: "Heading 1", hint: "The page title", keys: "h1 heading title", icon: "H1" },
  { id: "h2", label: "Heading 2", hint: "A main section", keys: "h2 heading section", icon: "H2" },
  { id: "h3", label: "Heading 3", hint: "A sub-section", keys: "h3 heading sub", icon: "H3" },
  { id: "p", label: "Text", hint: "A plain paragraph", keys: "p text paragraph", icon: "¶" },
  { id: "bullet", label: "Bullet list", hint: "A simple list", keys: "bullet list ul", icon: "•" },
  { id: "numbered", label: "Numbered list", hint: "Steps in order", keys: "numbered list ol steps", icon: "1." },
  { id: "quote", label: "Quote", hint: "A pull quote", keys: "quote blockquote", icon: "❝" },
  { id: "table", label: "Table", hint: "3 by 3, with a header row", keys: "table grid", icon: "⊞" },
  { id: "divider", label: "Divider", hint: "A line across the page", keys: "divider hr line", icon: "—" },
  { id: "image", label: "Image", hint: "Upload a picture", keys: "image picture photo upload img", icon: "▣" },
  { id: "write", label: "Write this line", hint: "The agent writes what belongs here", keys: "write agent ai line paragraph", icon: "✦", ai: true },
  { id: "section", label: "Write this section", hint: "The agent writes the section under the heading above", keys: "section agent ai write", icon: "✦", ai: true },
];

const countWords = (ed: Editor) => draftText(ed).split(/\s+/).filter(Boolean).length;
type BriefState = { status: "loading" | "none" | "running" | "done" | "failed"; error?: string; data?: { keyword: string; secondary: string[]; brief: Brief } };
const IMPORT_KEY = (docId: string) => `arrowsterr.briefImport.${docId}`;

/** The writer's own draft as a Google Docs-style editor with an agent beside every line. */
export function DocsEditor({
  sb,
  auth,
  site,
  doc,
  canEdit,
  guideline,
  onSaved,
  importBrief = false,
  onImported,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  site: Site;
  doc: Doc;
  canEdit: boolean;
  guideline: BrandGuideline | null;
  onSaved: (meta: DocMeta) => void;
  /** Import the brief into this draft as soon as it opens. The draft before it can be put back. */
  importBrief?: boolean;
  onImported?: () => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const [state, setState] = useState<"saved" | "saving" | "error">("saved");
  const [full, setFull] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [knowing, setKnowing] = useState(false);
  const [profile, setProfile] = useState(site.profile);
  const [guides, setGuides] = useState<Map<string, Guide>>(new Map());
  const [brief, setBrief] = useState<BriefState>({ status: doc.calendar_item_id ? "loading" : "none" });
  const [layout, setLayout] = useState<{ blocks: Block[]; pages: number; words: number; sections: RailSection[] }>({ blocks: [], pages: 1, words: 0, sections: [] });
  const [target, setTarget] = useState<Target | null>(null);
  const [card, setCard] = useState<CardState>("idle");
  const [note, setNote] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef(title);
  const targetRef = useRef<Target | null>(null);
  const canvas = useRef<HTMLDivElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const lastBreaks = useRef("");
  const lastLayout = useRef("");
  // A plain box the slash menu fills with its key handler, read by the editor plugin.
  const [slashKeys] = useState<{ current: ((e: KeyboardEvent) => boolean) | null }>(() => ({ current: null }));
  const uploadRef = useRef<(files: File[], at?: number) => void>(() => {});

  const save = useCallback(
    (ed: Editor) => {
      if (!canEdit) return;
      if (timer.current) clearTimeout(timer.current);
      setState("saving");
      timer.current = setTimeout(async () => {
        const w = countWords(ed);
        try {
          await saveDoc(sb, doc.id, { title: titleRef.current || "Untitled", content: ed.getJSON() as Record<string, unknown>, words: w });
          setState("saved");
          onSaved({ id: doc.id, site_id: doc.site_id, calendar_item_id: doc.calendar_item_id, title: titleRef.current || "Untitled", words: w, updated_at: new Date().toISOString() });
        } catch {
          setState("error");
        }
      }, 1200);
    },
    [sb, doc.id, doc.site_id, doc.calendar_item_id, canEdit, onSaved],
  );

  const [slashExt] = useState(() => slashKeysExtension(slashKeys));

  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Link.configure({ openOnClick: false }),
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : "Type / for headings, images and the agent") }),
      Note,
      Embed,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Pages,
      slashExt,
    ],
    content: doc.content && Object.keys(doc.content).length ? doc.content : undefined,
    editorProps: {
      // Paste or drop pictures straight into the draft.
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

  // Page breaks, block positions, words and the outline. Measured after typing pauses, and on resize.
  // Margins never change when a break is added, so a block cannot flip back and forth between pages.
  useEffect(() => {
    if (!editor) return;
    let raf = 0;
    let wait: ReturnType<typeof setTimeout> | null = null;
    const measure = () => {
      if (editor.isDestroyed) return;
      const out = layOut(editor);
      const key = JSON.stringify(out.breaks);
      if (key !== lastBreaks.current) {
        lastBreaks.current = key;
        editor.view.dispatch(editor.state.tr.setMeta(pagesKey, out.breaks).setMeta("addToHistory", false));
      }
      const sections = railSections(editor);
      const sig = `${out.pages}|${out.blocks.map((b) => `${b.pos}:${b.top}:${b.h}:${b.type}`).join(",")}|${sections.map((s) => `${s.pos}${s.heading}${s.text.trim() ? 1 : 0}`).join(",")}`;
      if (sig !== lastLayout.current) {
        lastLayout.current = sig;
        setLayout({ blocks: out.blocks, pages: out.pages, words: countWords(editor), sections });
      }
    };
    const soon = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    const later = () => {
      if (wait) clearTimeout(wait);
      wait = setTimeout(soon, 180);
    };
    soon();
    editor.on("update", later);
    const obs = new ResizeObserver(later);
    obs.observe(editor.view.dom);
    document.fonts?.ready.then(soon).catch(() => {});
    return () => {
      cancelAnimationFrame(raf);
      if (wait) clearTimeout(wait);
      editor.off("update", later);
      obs.disconnect();
    };
  }, [editor]);

  // Keep the agent's target on the same text while the draft changes.
  useEffect(() => {
    if (!editor) return;
    const onTr = ({ transaction }: { transaction: import("@tiptap/pm/state").Transaction }) => {
      const t = targetRef.current;
      if (!t || !transaction.docChanged) return;
      const m = transaction.mapping;
      const next: Target = t.kind === "block" ? { ...t, pos: m.map(t.pos, -1) } : { ...t, from: m.map(t.from, 1), to: m.map(t.to, -1) };
      targetRef.current = next;
      setTarget(next);
    };
    editor.on("transaction", onTr);
    return () => {
      editor.off("transaction", onTr);
    };
  }, [editor]);

  // The brief for this piece: its guide for each heading, or a button to write it.
  const loadBrief = useCallback(async () => {
    if (!doc.calendar_item_id) return;
    try {
      const b = await getBrief(sb, doc.calendar_item_id);
      if (b.brief) {
        setGuides(briefGuides(b.keyword ?? doc.title, b.secondary ?? [], b.brief));
        setBrief({ status: "done", data: { keyword: b.keyword ?? doc.title, secondary: b.secondary ?? [], brief: b.brief } });
      } else setBrief({ status: b.brief_status === "running" ? "running" : b.brief_status === "failed" ? "failed" : "none", error: b.brief_error ?? undefined });
    } catch {
      setBrief({ status: "none" });
    }
  }, [sb, doc.calendar_item_id, doc.title]);
  useEffect(() => {
    // Loading the brief when the draft opens is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadBrief();
  }, [loadBrief]);
  useEffect(() => {
    if (brief.status !== "running") return;
    const t = setInterval(loadBrief, 4000);
    return () => clearInterval(t);
  }, [brief.status, loadBrief]);
  async function writeBrief() {
    if (!doc.calendar_item_id) return;
    setBrief({ status: "running" });
    try {
      await post(auth, "/api/research/brief", { itemId: doc.calendar_item_id });
    } catch (e) {
      setBrief({ status: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  }
  async function stopBrief() {
    if (!doc.calendar_item_id) return;
    try {
      await post(auth, "/api/research/brief", { itemId: doc.calendar_item_id, action: "stop" });
      setBrief({ status: "failed", error: "Stopped." });
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  }

  // Import the brief: the draft becomes the brief's outline. The draft from before is kept, in this browser, so it can be put back.
  const [revertable, setRevertable] = useState(() => {
    try {
      return Boolean(localStorage.getItem(IMPORT_KEY(doc.id)));
    } catch {
      return false;
    }
  });
  function importTheBrief() {
    if (!editor || !brief.data) return;
    try {
      localStorage.setItem(IMPORT_KEY(doc.id), JSON.stringify({ at: new Date().toISOString(), content: editor.getJSON() }));
    } catch {
      // Storage full or blocked. Undo (Ctrl + Z) still brings the draft back in this session.
    }
    editor.commands.setContent(briefToDoc(brief.data.keyword, brief.data.secondary, brief.data.brief) as unknown as Record<string, unknown>, true);
    setRevertable(true);
    setNote("Brief imported");
    setTimeout(() => setNote(""), 2500);
  }
  function revertImport() {
    if (!editor) return;
    try {
      const saved = JSON.parse(localStorage.getItem(IMPORT_KEY(doc.id)) ?? "null") as { content: Record<string, unknown> } | null;
      if (saved?.content) editor.commands.setContent(saved.content, true);
      localStorage.removeItem(IMPORT_KEY(doc.id));
    } catch {
      editor.commands.undo();
    }
    setRevertable(false);
  }
  function keepImport() {
    try {
      localStorage.removeItem(IMPORT_KEY(doc.id));
    } catch {}
    setRevertable(false);
  }
  // Asked for from the brief tab: import as soon as both the draft and the brief are ready.
  const imported = useRef(false);
  useEffect(() => {
    if (!importBrief || imported.current || !editor || brief.status !== "done") return;
    imported.current = true;
    importTheBrief();
    onImported?.();
    // Runs once, when the editor and the brief are both loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importBrief, editor, brief.status]);

  // Full screen closes with Escape; so does the agent card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (targetRef.current) {
        targetRef.current = null;
        setTarget(null);
        setCard("idle");
      } else if (full) setFull(false);
    };
    window.addEventListener("keydown", onKey);
    if (full) document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      if (full) document.body.style.overflow = "";
    };
  }, [full]);

  const blockAt = (pos: number | null) => (pos === null ? null : (layout.blocks.find((b) => b.pos === pos) ?? null));
  const targetBlock = target ? blockAt(target.kind === "block" ? target.pos : (editor?.state.doc.resolve(Math.min(target.from, editor.state.doc.content.size)).before(1) ?? null)) : null;

  /** Open the one agent card, beside its line, with the line in the middle of the screen. */
  function open(t: Target, then?: () => void) {
    targetRef.current = t;
    setTarget(t);
    setCard("idle");
    const pos = t.kind === "block" ? t.pos : t.from;
    const dom = editor?.view.nodeDOM(t.kind === "block" ? pos : editor.state.doc.resolve(pos).before(1)) as HTMLElement | null;
    requestAnimationFrame(() => dom?.scrollIntoView?.({ behavior: "smooth", block: "center" }));
    if (then) setTimeout(then, 0);
  }
  const close = () => {
    targetRef.current = null;
    setTarget(null);
    setCard("idle");
  };
  const blockTarget = (pos: number): Target | null => {
    const node = editor?.state.doc.nodeAt(pos);
    return node ? { kind: "block", pos, type: node.type.name, level: node.type.name === "heading" ? (node.attrs.level as number) : 0, text: node.textContent } : null;
  };

  const docText = () => (editor ? draftText(editor) : "");
  const textAround = (from: number, to: number) => {
    const d = editor!.state.doc;
    return { before: d.textBetween(Math.max(0, from - 4000), from, "\n").slice(-2500), after: d.textBetween(to, Math.min(d.content.size, to + 3000), "\n").slice(0, 1500) };
  };

  /** Upload pictures to the draft's folder and put them in. The agent writes alt text for each. */
  async function upload(files: File[], at?: number) {
    if (!editor || !canEdit) return;
    for (const f of files) {
      if (f.size > 10 * 1024 * 1024) {
        setNote(`${f.name} is over 10 MB.`);
        continue;
      }
      setNote(`Uploading ${f.name}...`);
      const path = `${auth.workspaceId}/${doc.id}/${Date.now()}-${f.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-")}`;
      const { error } = await sb.storage.from("doc-images").upload(path, f, { contentType: f.type, upsert: false });
      if (error) {
        setNote(/bucket|not found/i.test(error.message) ? "Run supabase/028_doc_images.sql in Supabase to turn on images." : error.message);
        continue;
      }
      const src = sb.storage.from("doc-images").getPublicUrl(path).data.publicUrl;
      const alt = f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ");
      const pos = at ?? editor.state.selection.to;
      editor.chain().focus().insertContentAt(pos, { type: "image", attrs: { src, alt } }).run();
      setNote("");
      // Alt text from the words around the picture, in the background.
      const near = textAround(pos, pos);
      const heading = [...layout.sections].reverse().find((s) => s.pos < pos)?.heading ?? "";
      post<{ alt: string }>(auth, "/api/writer/agent", { siteId: site.id, docId: doc.id, task: "alt", file: f.name, heading, ...near })
        .then(({ alt: better }) => {
          if (!better) return;
          editor.state.doc.descendants((n, p) => {
            if (n.type.name === "image" && n.attrs.src === src) editor.view.dispatch(editor.state.tr.setNodeMarkup(p, undefined, { ...n.attrs, alt: better }));
          });
        })
        .catch(() => {});
    }
  }
  useEffect(() => {
    uploadRef.current = upload;
  });

  /** Run one agent job for the open card. Stop cancels it and nothing goes into the draft. */
  const agentStop = useRef<AbortController | null>(null);
  async function run(task: AgentTask, instruction = "") {
    const t = targetRef.current;
    if (!editor || !t) return;
    agentStop.current?.abort();
    const ctl = new AbortController();
    agentStop.current = ctl;
    setCard("busy");
    try {
      if (t.kind === "selection" || (t.kind === "block" && t.type !== "heading" && (task === "rewrite" || task === "paragraph" || task === "custom"))) {
        // A passage or a line: the agent rewrites it, or writes what belongs there. The writer reviews it before it goes in.
        const range = t.kind === "selection" ? { from: t.from, to: t.to } : { from: t.pos, to: t.pos + (editor.state.doc.nodeAt(t.pos)?.nodeSize ?? 0) };
        const passage = editor.state.doc.textBetween(range.from, range.to, "\n");
        const job: AgentTask = passage.trim() ? "rewrite" : "paragraph";
        const out = await post<{ html: string; note?: string }>(auth, "/api/writer/agent", {
          siteId: site.id,
          docId: doc.id,
          task: job,
          passage,
          instruction,
          ...textAround(range.from, range.to),
          docText: docText(),
        }, ctl.signal);
        setCard({ task: job, html: cleanHtml(out.html), note: out.note, preview: true });
        return;
      }
      // A heading: the agent works on its whole section.
      const sections = railSections(editor);
      const s = sections.find((x) => x.pos === t.pos) ?? sections.find((x) => x.heading === t.text);
      if (!s) throw new Error("This heading changed. Open it again.");
      const g = guides.get(guideKey(s.heading));
      const guide = [g?.text, ...(g?.points ?? []), ...s.notes, s.subs.length ? `This heading has sub-headings (${s.subs.join("; ")}). Write only the short lead-in that comes before them.` : ""].filter(Boolean).join("\n");
      const out = await post<WriterAgentResult>(auth, "/api/writer/agent", { siteId: site.id, docId: doc.id, task, heading: s.heading, guide, section: s.text, docText: docText(), instruction }, ctl.signal);
      setCard({ task, done: await applySection(s, out), note: "note" in out ? out.note : undefined });
    } catch (e) {
      setCard(stopped(e) ? "idle" : { error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Put a section job's result into the draft. Returns what was done. */
  async function applySection(s: RailSection, out: WriterAgentResult): Promise<string> {
    const ed = editor!;
    const body = bodyOf(ed, s);
    if (!body) throw new Error("This heading changed. Run the agent again.");
    if ("html" in out) {
      if (out.task === "write" && body.empty) ed.chain().focus().insertContentAt({ from: body.start, to: body.end }, out.html).run();
      else ed.chain().focus().insertContentAt(body.end, out.html).run();
      return out.task === "write" ? "Written into this section" : out.task === "table" ? "Table added" : out.task === "stats" ? "Stats with sources added" : "Added to this section";
    }
    if (out.task === "widget") {
      ed.chain().focus().insertContentAt(body.end, { type: "embed", attrs: { html: out.embed } }).run();
      return "Interactive element added";
    }
    if (out.task === "links") {
      for (const l of out.links) {
        const b = bodyOf(ed, s);
        if (!b) break;
        let at: { from: number; to: number } | null = null;
        ed.state.doc.nodesBetween(b.start, b.end, (n, p) => {
          if (at || !n.isText) return;
          const k = (n.text ?? "").toLowerCase().indexOf(l.anchor.toLowerCase());
          if (k >= 0) at = { from: p + k, to: p + k + l.anchor.length };
        });
        if (at) ed.chain().setTextSelection(at).setLink({ href: l.url }).run();
      }
      return out.links.length ? `Linked: ${out.links.map((l) => l.anchor).join(" · ")}` : "No matching pages found";
    }
    if (out.task === "meta") {
      await saveDocMeta(sb, doc.id, { ...(await getDocMeta(sb, doc.id)), title: out.meta.title, description: out.meta.description, slug: out.meta.slug });
      return `Meta saved: ${out.meta.title}`;
    }
    if (out.task === "alt") return "Alt text written";
    await saveDocMeta(sb, doc.id, { ...(await getDocMeta(sb, doc.id)), schema: out.schema });
    return "FAQ schema saved for publishing";
  }

  /** Put a reviewed rewrite in place, or below the line. */
  function accept(mode: "replace" | "below") {
    const t = targetRef.current;
    if (!editor || !t || typeof card !== "object" || !("html" in card) || !card.html) return;
    const range = t.kind === "selection" ? { from: t.from, to: t.to } : { from: t.pos, to: t.pos + (editor.state.doc.nodeAt(t.pos)?.nodeSize ?? 0) };
    const html = card.html;
    if (mode === "replace") {
      // A selection inside one paragraph takes inline text; a whole line takes blocks.
      const inline = t.kind === "selection" && editor.state.doc.resolve(t.from).parent === editor.state.doc.resolve(t.to).parent && /^<p>[\s\S]*<\/p>$/.test(html) && !html.slice(3, -4).includes("<p>");
      editor.chain().focus().insertContentAt(range, inline ? html.slice(3, -4) : html).run();
    } else {
      const end = t.kind === "selection" ? editor.state.doc.resolve(t.to).after(1) : range.to;
      editor.chain().focus().insertContentAt(end, html).run();
    }
    setCard({ task: card.task, done: mode === "replace" ? "Replaced" : "Added below" });
  }

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
      if (id === "image") return fileInput.current?.click();
      const pos = editor.state.doc.resolve(editor.state.selection.from).before(1);
      if (id === "write") {
        const t = blockTarget(pos);
        if (t) open(t, () => run("paragraph"));
      } else if (id === "section") {
        const h = [...railSections(editor)].reverse().find((s) => s.pos <= pos);
        if (!h) return setNote("Add a heading first. The agent writes the section under it.");
        const t = blockTarget(h.pos);
        if (t) open(t, () => run("write"));
      }
    }
  }

  const exportHtml = () => brandTables(exportClean(editor?.getHTML() ?? ""), guideline);
  const icon = (label: string, svg: React.ReactNode, onClick: () => void, pressed?: boolean) => (
    <button type="button" className="aw-iconbtn" title={label} aria-label={label} aria-pressed={pressed} onClick={onClick}>
      {svg}
    </button>
  );
  const sections = layout.sections;
  const canvasH = layout.pages * PITCH - PAGE_GAP;
  const cardTop = targetBlock ? MARGIN + targetBlock.top : MARGIN;

  return (
    <div className={`aw-docs ${full ? "is-full" : ""}`}>
      <div className="aw-docs__bar">
        {editor && canEdit ? <Toolbar editor={editor} /> : <span className="flex-1" />}
        <span className="ml-auto flex items-center gap-1.5">
          <input
            value={title}
            disabled={!canEdit}
            onChange={(e) => {
              setTitle(e.target.value);
              titleRef.current = e.target.value;
              if (editor) save(editor);
            }}
            placeholder="Untitled draft"
            aria-label="Draft title"
            className="aw-docs__title"
          />
          <span className="aw-num px-1 text-[12px] whitespace-nowrap text-muted">
            {layout.pages} {layout.pages === 1 ? "page" : "pages"} · {layout.words.toLocaleString("en-US")} words
          </span>
          <span className="flex items-center gap-1.5 px-1 text-[12px] whitespace-nowrap text-muted">
            <i className={`inline-block h-1.5 w-1.5 rounded-full ${state === "error" ? "bg-neg" : state === "saving" ? "bg-warn" : "bg-pos"}`} aria-hidden="true" />
            {note || (state === "error" ? "Not saved" : state === "saving" ? "Saving" : "Saved")}
          </span>
          {canEdit ? (
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm whitespace-nowrap" onClick={() => setKnowing(true)} title="What the agent knows about your product">
              Product knowledge
            </button>
          ) : null}
          {icon(
            "Copy HTML",
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />
            </svg>,
            () => navigator.clipboard.writeText(exportHtml()),
          )}
          {icon(
            "Download HTML",
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 20h14" />
            </svg>,
            () => {
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob([`<!doctype html><meta charset="utf-8"><title>${title}</title>\n${exportHtml()}`], { type: "text/html" }));
              a.download = `${(title || "draft").replace(/\W+/g, "-")}.html`;
              a.click();
              URL.revokeObjectURL(a.href);
            },
          )}
          {icon(
            full ? "Exit full screen (Esc)" : "Full screen",
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              {full ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
            </svg>,
            () => setFull(!full),
            full,
          )}
          {canEdit ? (
            <button type="button" className="aw-btn aw-btn--primary aw-btn--sm ml-1" onClick={() => setPublishing(true)}>
              Publish
            </button>
          ) : null}
        </span>
      </div>

      {canEdit && doc.calendar_item_id && brief.status !== "loading" ? (
        <div className="aw-docs__briefbar">
          {brief.status === "running" ? (
            <>
              <span className="flex items-center gap-2">
                <span className="aw-spin" aria-hidden="true" />
                Reading Google&apos;s top 10 and writing the brief. The agent uses it as soon as it is ready.
              </span>
              <StopButton onStop={stopBrief} />
            </>
          ) : brief.status === "done" ? (
            <>
              <span className="flex items-center gap-2">
                <Tick />
                {revertable ? "The brief is in your draft. Not what you wanted? Put your draft back." : "The brief is ready. The agent follows it in every section."}
              </span>
              <span className="flex items-center gap-2">
                {revertable ? (
                  <>
                    <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={revertImport}>
                      ↶ Revert import
                    </button>
                    <button type="button" className="aw-text-link text-[12px]" onClick={keepImport}>
                      Keep it
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="aw-btn aw-btn--secondary aw-btn--sm"
                    onClick={() => (!layout.words || confirm("Import the brief? It replaces this draft with the brief's outline. You can revert it.")) && importTheBrief()}
                  >
                    Import brief
                  </button>
                )}
              </span>
            </>
          ) : (
            <>
              <span>{brief.status === "failed" ? (brief.error === "Stopped." ? "The brief was stopped." : `The brief failed: ${brief.error ?? "try again"}`) : "No brief yet. With one, the agent knows what Google rewards for this keyword."}</span>
              <button type="button" className="aw-btn aw-btn--accent aw-btn--sm" onClick={writeBrief}>
                <AiIcon />
                {brief.status === "failed" ? "Generate brief again" : "Generate brief"}
              </button>
            </>
          )}
        </div>
      ) : null}

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

      <div className="aw-docs__desk">
        {full ? (
          <nav className="aw-docs__outline" aria-label="Outline">
            <span className="aw-label mb-2 block">Outline</span>
            {sections.length ? (
              sections.map((s) => (
                <button key={`${s.pos}:${s.heading}`} type="button" className={`aw-docs__ol aw-docs__ol--${s.level}`} onClick={() => (editor?.view.nodeDOM(s.pos) as HTMLElement | null)?.scrollIntoView({ block: "center" })}>
                  <span className="truncate">{s.heading || "Untitled"}</span>
                  {s.text.trim() ? <Tick /> : guides.has(guideKey(s.heading)) ? <span className="aw-docs__guide-dot" title="The brief has a guide for this section" /> : null}
                </button>
              ))
            ) : (
              <p className="text-[12px] text-muted">Headings show up here.</p>
            )}
          </nav>
        ) : null}

        <div ref={canvas} className="aw-docs__canvas" style={{ height: canvasH }}>
          {Array.from({ length: layout.pages }, (_, i) => (
            <div key={i} className="aw-docs__page" style={{ top: i * PITCH, height: PAGE_H }} aria-hidden="true">
              <span className="aw-docs__pageno">
                {i + 1} of {layout.pages}
              </span>
            </div>
          ))}
          {targetBlock ? <div className="aw-docs__focus" style={{ top: MARGIN + targetBlock.top - 4, height: targetBlock.h + 8 }} aria-hidden="true" /> : null}
          <div className="aw-docs__body" style={{ paddingTop: MARGIN }}>
            <EditorContent editor={editor} />
          </div>
          {editor && canEdit ? (
            <>
              <Gutter editor={editor} canvas={canvas} blocks={layout.blocks} hidden={Boolean(target)} onOpen={(pos) => { const t = blockTarget(pos); if (t) open(t); }} />
              <Bubble
                editor={editor}
                canvas={canvas}
                hidden={Boolean(target)}
                onAsk={(from, to, ask) => open({ kind: "selection", from, to, text: editor.state.doc.textBetween(from, to, "\n") }, ask ? () => run("rewrite", ask) : undefined)}
              />
              <SlashMenu editor={editor} canvas={canvas} keysRef={slashKeys} onPick={slash} />
            </>
          ) : null}
        </div>

        <aside className="aw-docs__rail" style={{ height: canvasH }} aria-label="Agent">
          {target ? (
            <div className="aw-agent" style={{ top: Math.max(0, cardTop - 8) }}>
              <AgentCard
                target={target}
                guide={target.kind === "block" && target.type === "heading" ? guides.get(guideKey(target.text)) : undefined}
                first={target.kind === "block" && target.type === "heading" && sections[0]?.pos === target.pos}
                state={card}
                onRun={run}
                onStop={() => agentStop.current?.abort()}
                onAccept={accept}
                onUndo={() => editor?.chain().focus().undo().run()}
                onClose={close}
              />
            </div>
          ) : null}
        </aside>
      </div>

      {publishing ? <PublishPanel sb={sb} auth={auth} docId={doc.id} title={title} html={exportHtml} onClose={() => setPublishing(false)} /> : null}
      {knowing ? (
        <Knowledge
          profile={profile}
          name={site.name}
          onClose={() => setKnowing(false)}
          onSave={async (k) => {
            const next = { ...site, profile: { ...profile, knowledge: k } };
            await saveSite(sb, next);
            setProfile(next.profile);
            setKnowing(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** The agent button in the left margin, beside the line under the mouse or the line with the cursor. Its own part, so moving the mouse redraws only this. */
function Gutter({ editor, canvas, blocks, hidden, onOpen }: { editor: Editor; canvas: React.RefObject<HTMLDivElement | null>; blocks: Block[]; hidden: boolean; onOpen: (pos: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const list = useRef(blocks);
  useEffect(() => {
    list.current = blocks;
  }, [blocks]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let raf = 0;
    const move = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = e.clientY - el.getBoundingClientRect().top - MARGIN;
        const b = list.current.find((x) => y >= x.top - 6 && y <= x.top + x.h + 6);
        setHover(b ? b.pos : null);
      });
    };
    const leave = () => setHover(null);
    el.addEventListener("mousemove", move);
    el.addEventListener("mouseleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("mousemove", move);
      el.removeEventListener("mouseleave", leave);
    };
  }, [canvas]);
  useEffect(() => {
    const sel = () => {
      const { from } = editor.state.selection;
      setCursor(from > 0 ? editor.state.doc.resolve(from).before(1) : null);
    };
    editor.on("selectionUpdate", sel);
    return () => {
      editor.off("selectionUpdate", sel);
    };
  }, [editor]);
  const b = hidden ? null : (blocks.find((x) => x.pos === hover) ?? blocks.find((x) => x.pos === cursor) ?? null);
  if (!b || b.type === "image" || b.type === "horizontalRule") return null;
  return (
    <button
      type="button"
      className="aw-docs__chip"
      style={{ top: MARGIN + b.top + Math.min(b.h, 28) / 2 - 13 }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onOpen(b.pos)}
      title={b.type === "heading" ? "Ask the agent to write this section" : b.text.trim() ? "Ask the agent to rewrite this line" : "Ask the agent to write this line"}
    >
      <AiIcon />
      <span className="aw-docs__chip-label">{b.type === "heading" ? "Write section" : b.text.trim() ? "Rewrite" : "Write"}</span>
    </button>
  );
}

/** The menu over selected text, or the alt text box for a selected picture. */
function Bubble({ editor, canvas, hidden, onAsk }: { editor: Editor; canvas: React.RefObject<HTMLDivElement | null>; hidden: boolean; onAsk: (from: number, to: number, ask?: string) => void }) {
  const [sel, setSel] = useState<{ from: number; to: number; x: number; y: number; image: string | null } | null>(null);
  const [alt, setAlt] = useState("");
  useEffect(() => {
    const update = () => {
      const s = editor.state.selection;
      if (s.empty || !editor.isFocused) return setSel(null);
      const box = canvas.current?.getBoundingClientRect();
      if (!box) return setSel(null);
      const c = editor.view.coordsAtPos(s.from);
      const node = s instanceof NodeSelection ? s.node : null;
      const image = node?.type.name === "image" ? String(node.attrs.alt ?? "") : null;
      setSel({ from: s.from, to: s.to, x: c.left - box.left, y: c.top - box.top, image });
      if (image !== null) setAlt(image);
    };
    const blur = () => setTimeout(() => !document.activeElement?.closest(".aw-bubble") && setSel(null), 150);
    editor.on("selectionUpdate", update);
    editor.on("blur", blur);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("blur", blur);
    };
  }, [editor, canvas]);
  if (!sel || hidden) return null;
  if (sel.image !== null)
    return (
      <form
        className="aw-bubble"
        style={{ left: Math.max(0, sel.x), top: Math.max(0, sel.y - 46) }}
        onSubmit={(e) => {
          e.preventDefault();
          editor.chain().focus().updateAttributes("image", { alt: alt.trim() }).run();
        }}
      >
        <span className="px-2 text-[12px] text-white/70">Alt text</span>
        <input value={alt} onChange={(e) => setAlt(e.target.value)} aria-label="Alt text" className="aw-bubble__input" placeholder="What the picture shows" />
        <button type="submit" className="aw-bubble__btn">
          Save
        </button>
      </form>
    );
  return (
    <div className="aw-bubble" style={{ left: Math.max(0, sel.x - 8), top: sel.y - 46 }} onMouseDown={(e) => e.preventDefault()}>
      <button type="button" className="aw-bubble__ask" onClick={() => onAsk(sel.from, sel.to)}>
        <AiIcon />
        Ask agent
      </button>
      {REWRITES.slice(0, 3).map((r) => (
        <button key={r.label} type="button" className="aw-bubble__btn" onClick={() => onAsk(sel.from, sel.to, r.ask)}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

/** Type / at the start of a line for headings, lists, images and the agent. items leaves out choices, like the agent's in the plain editor. */
export function SlashMenu({
  editor,
  canvas,
  keysRef,
  onPick,
  items = SLASH,
}: {
  editor: Editor;
  canvas: React.RefObject<HTMLDivElement | null>;
  keysRef: React.RefObject<((e: KeyboardEvent) => boolean) | null>;
  onPick: (id: string, range: { from: number; to: number }) => void;
  items?: Slash[];
}) {
  const [menu, setMenu] = useState<{ q: string; from: number; to: number; x: number; y: number } | null>(null);
  const [i, setI] = useState(0);
  const [closedAt, setClosedAt] = useState<number | null>(null);
  // Each word of a choice can start the match, so /h finds headings and /im finds Image.
  const q = menu?.q.trim().toLowerCase() ?? "";
  const list = menu ? items.filter((s) => !q || `${s.keys} ${s.label.toLowerCase()}`.split(/\s+/).some((w) => w.startsWith(q))) : [];

  useEffect(() => {
    const check = () => {
      const s = editor.state.selection;
      const $f = s.$from;
      if (!s.empty || $f.parent.type.name !== "paragraph") return setMenu(null);
      const before = $f.parent.textBetween(0, $f.parentOffset, undefined, "￼");
      const m = before.match(/^\/([a-z0-9 ]{0,20})$/i);
      if (!m || closedAt === $f.start()) return setMenu(null);
      const box = canvas.current?.getBoundingClientRect();
      const c = editor.view.coordsAtPos($f.start());
      if (!box) return;
      setMenu((old) => {
        if (old?.q !== m[1]) setI(0);
        return { q: m[1], from: $f.start(), to: $f.pos, x: c.left - box.left, y: c.bottom - box.top + 6 };
      });
    };
    editor.on("update", check);
    editor.on("selectionUpdate", check);
    return () => {
      editor.off("update", check);
      editor.off("selectionUpdate", check);
    };
  }, [editor, canvas, closedAt]);

  useEffect(() => {
    keysRef.current = (e: KeyboardEvent) => {
      if (!menu) return false;
      if (e.key === "ArrowDown") {
        setI((x) => Math.min(list.length - 1, x + 1));
        return true;
      }
      if (e.key === "ArrowUp") {
        setI((x) => Math.max(0, x - 1));
        return true;
      }
      if ((e.key === "Enter" || e.key === "Tab") && list[i]) {
        onPick(list[i].id, { from: menu.from, to: menu.to });
        setMenu(null);
        return true;
      }
      if (e.key === "Escape") {
        setClosedAt(menu.from);
        setMenu(null);
        return true;
      }
      return false;
    };
    return () => {
      keysRef.current = null;
    };
  });

  if (!menu || !list.length) return null;
  return (
    <div className="aw-slash" style={{ left: menu.x, top: menu.y }} role="listbox" aria-label="Insert" onMouseDown={(e) => e.preventDefault()}>
      {list.map((s, k) => (
        <button
          key={s.id}
          type="button"
          role="option"
          aria-selected={k === i}
          className={`aw-slash__item ${k === i ? "is-hot" : ""}`}
          onMouseEnter={() => setI(k)}
          onClick={() => {
            onPick(s.id, { from: menu.from, to: menu.to });
            setMenu(null);
          }}
        >
          <span className={`aw-slash__icon ${s.icon === "✦" ? "is-ai" : ""}`}>{s.icon}</span>
          <span className="flex min-w-0 flex-col items-start">
            <span className="text-[13px] text-ink">{s.label}</span>
            <span className="text-[11px] text-muted">{s.hint}</span>
          </span>
          <span className="ml-auto font-mono text-[11px] text-faint">/{s.keys.split(" ")[0]}</span>
        </button>
      ))}
    </div>
  );
}

const SECTION_JOBS: AgentTask[] = ["write", "table", "stats", "widget", "links", "faq", "meta"];

/** The one open agent card: what it works on, the jobs it can do, and the result to keep or throw away. */
function AgentCard({
  target,
  guide,
  first,
  state,
  onRun,
  onStop,
  onAccept,
  onUndo,
  onClose,
}: {
  target: Target;
  guide?: Guide;
  first: boolean;
  state: CardState;
  onRun: (task: AgentTask, instruction?: string) => void;
  onStop: () => void;
  onAccept: (mode: "replace" | "below") => void;
  onUndo: () => void;
  onClose: () => void;
}) {
  const [ask, setAsk] = useState("");
  const [last, setLast] = useState<{ task: AgentTask; ask: string } | null>(null);
  const heading = target.kind === "block" && target.type === "heading";
  const empty = !target.text.trim();
  const jobs = heading ? tasksFor(target.text, target.level, first).filter((t) => SECTION_JOBS.includes(t)) : [];
  const go = (task: AgentTask, instruction = "") => {
    setLast({ task, ask: instruction });
    onRun(task, instruction);
  };
  const label =
    target.kind === "selection" ? "Selected text" : heading ? `H${target.level} · ${target.text || "Untitled heading"}` : target.type === "paragraph" ? (empty ? "Empty line" : "Paragraph") : target.type === "bulletList" || target.type === "orderedList" ? "List" : "Block";
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, [target.kind]);

  return (
    <div ref={ref} className="aw-agent__card" role="dialog" aria-label="Agent">
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-ink">
          <span className="text-brand">
            <AiIcon />
          </span>
          <span className="truncate">{label}</span>
        </span>
        <button type="button" aria-label="Close (Esc)" title="Close (Esc)" onClick={onClose} className="px-1 text-[18px] leading-none text-muted hover:text-ink">
          ×
        </button>
      </div>
      {target.kind === "selection" || (!heading && !empty) ? <p className="aw-agent__quote">{target.text.slice(0, 220)}{target.text.length > 220 ? "…" : ""}</p> : null}
      {guide ? (
        <div className="aw-agent__guide">
          <span className="aw-label">From the brief</span>
          <p>{guide.text}</p>
          {guide.points?.length ? (
            <ul>
              {guide.points.slice(0, 4).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {state === "busy" ? (
        <span className="flex items-center justify-between gap-2 py-1 text-[13px] text-muted">
          <span className="flex items-center gap-2">
            <span className="aw-spin" aria-hidden="true" />
            The agent is writing...
          </span>
          <StopButton onStop={onStop} />
        </span>
      ) : typeof state === "object" && "error" in state ? (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] text-neg">{state.error}</span>
          {last ? (
            <button type="button" className="aw-text-link self-start text-[12px]" onClick={() => go(last.task, last.ask)}>
              Try again
            </button>
          ) : null}
        </div>
      ) : typeof state === "object" && state.preview && state.html ? (
        <div className="flex flex-col gap-2">
          <div className="aw-agent__preview aw-editor" dangerouslySetInnerHTML={{ __html: state.html }} />
          {state.note ? <span className="text-[12px] text-muted">{state.note}</span> : null}
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={() => onAccept("replace")}>
              {empty && target.kind === "block" ? "Insert" : "Replace"}
            </button>
            {!(empty && target.kind === "block") ? (
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => onAccept("below")}>
                Insert below
              </button>
            ) : null}
            {last ? (
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => go(last.task, last.ask)}>
                Try again
              </button>
            ) : null}
            <button type="button" className="aw-text-link text-[12px]" onClick={onClose}>
              Discard
            </button>
          </div>
        </div>
      ) : typeof state === "object" && state.done ? (
        <div className="flex flex-col gap-1.5 text-[13px]">
          <span className="flex items-center gap-2 text-ink">
            <Tick />
            {state.done}
          </span>
          {state.note ? <span className="text-[12px] text-muted">{state.note}</span> : null}
          <span className="flex gap-3">
            <button type="button" className="aw-text-link text-[12px]" onClick={onUndo}>
              Undo
            </button>
            <button type="button" className="aw-text-link text-[12px]" onClick={onClose}>
              Done
            </button>
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {heading ? (
            <>
              <button type="button" className="aw-agent__go" onClick={() => go("write")}>
                <AiIcon />
                Write this section
              </button>
              <div className="flex flex-col gap-0.5">
                {jobs
                  .filter((t) => t !== "write")
                  .map((t) => (
                    <button key={t} type="button" className="aw-agent__job" onClick={() => go(t)}>
                      <TaskIcon t={t} />
                      <span className="flex min-w-0 flex-col items-start">
                        <span className="text-[13px] text-ink">{AGENT_TASKS[t as keyof typeof AGENT_TASKS].label}</span>
                        <span className="text-[11px] text-muted">{AGENT_TASKS[t as keyof typeof AGENT_TASKS].hint}</span>
                      </span>
                    </button>
                  ))}
              </div>
            </>
          ) : empty && target.kind === "block" ? (
            <button type="button" className="aw-agent__go" onClick={() => go("paragraph")}>
              <AiIcon />
              Write this line
            </button>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {REWRITES.map((r) => (
                <button key={r.label} type="button" className="aw-chip aw-chip--btn" onClick={() => go("rewrite", r.ask)}>
                  {r.label}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!ask.trim()) return;
              go(heading ? "custom" : empty ? "paragraph" : "rewrite", ask.trim());
              setAsk("");
            }}
          >
            <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={heading ? "Tell the agent what to do here..." : "Tell the agent how to change it..."} aria-label="Tell the agent what to do" className="aw-agent__ask" />
            <button type="submit" className="aw-agent__send" aria-label="Run" disabled={!ask.trim()}>
              ↵
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/** What the agent knows about the product, and the facts the team adds for it. */
function Knowledge({ profile, name, onClose, onSave }: { profile: Site["profile"]; name: string; onClose: () => void; onSave: (k: string) => Promise<void> }) {
  const [k, setK] = useState(profile.knowledge ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const known = knowledgeText({ ...profile, knowledge: "" });
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(16,20,30,0.45)] p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Product knowledge" onClick={(e) => e.stopPropagation()} className="aw-frame flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="aw-h4">What the agent knows about {name}</h2>
            <p className="aw-small">Every agent in the writer reads this before it writes. Add the facts only your team knows, so drafts never guess.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="px-1 text-[24px] leading-none text-body hover:text-ink">
            ×
          </button>
        </div>
        {known ? (
          <div className="flex flex-col gap-1">
            <span className="aw-label">From your brand profile</span>
            <pre className="max-h-48 overflow-y-auto rounded-[6px] bg-surface-2 p-3 font-sans text-[12px] whitespace-pre-wrap text-body">{known}</pre>
          </div>
        ) : null}
        <label className="flex flex-col gap-1">
          <span className="aw-label">Facts from your team</span>
          <textarea
            value={k}
            onChange={(e) => setK(e.target.value)}
            rows={10}
            className="aw-textarea text-[14px]!"
            placeholder={"Pricing: Starter $29/mo, Pro $99/mo\nCustomers: 2,000 restaurants, including ...\nProof: cut review response time by 70% for ...\nWhat we never say: ..."}
          />
        </label>
        {error ? <p className="aw-error">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="aw-btn aw-btn--primary aw-btn--sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onSave(k.trim());
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
