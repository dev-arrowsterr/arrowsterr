"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, Extension, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getBrief, getDocMeta, saveDoc, saveDocMeta, saveSite, type Doc, type DocMeta, type Site } from "@/lib/db";
import type { RunAuth } from "@/lib/runner";
import { briefGuides, guideKey, type Guide } from "@/lib/writer";
import { AGENT_TASKS, knowledgeText, REWRITES, tasksFor, type AgentTask, type WriterAgentResult } from "@/lib/writerAgent";
import type { BrandGuideline } from "@/lib/writerTypes";
import { AiIcon } from "../ui";
import { bodyOf, railSections, TaskIcon, type RailSection } from "./CommentRail";
import { PublishPanel } from "./PublishPanel";
import { post, Tick } from "./shared";
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

/** The writer's own draft as a Google Docs-style editor with an agent beside every line. */
export function DocsEditor({
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
  const [full, setFull] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [knowing, setKnowing] = useState(false);
  const [profile, setProfile] = useState(site.profile);
  const [guides, setGuides] = useState<Map<string, Guide>>(new Map());
  const [layout, setLayout] = useState<{ blocks: Block[]; pages: number }>({ blocks: [], pages: 1 });
  const [hover, setHover] = useState<number | null>(null); // pos of the block under the mouse
  const [cursorPos, setCursorPos] = useState<number | null>(null);
  const [sel, setSel] = useState<{ from: number; to: number; x: number; y: number } | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [card, setCard] = useState<CardState>("idle");
  const [words, setWords] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef(title);
  const targetRef = useRef<Target | null>(null);
  const canvas = useRef<HTMLDivElement | null>(null);
  const lastBreaks = useRef("");

  const save = useCallback(
    (ed: Editor) => {
      if (!canEdit) return;
      if (timer.current) clearTimeout(timer.current);
      setState("saving");
      timer.current = setTimeout(async () => {
        const w = draftText(ed).split(/\s+/).filter(Boolean).length;
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

  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : "Write, or press the ✦ in the margin to let the agent write this line") }),
      Note,
      Embed,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Pages,
    ],
    content: doc.content && Object.keys(doc.content).length ? doc.content : undefined,
    onCreate: ({ editor: ed }) => setWords(draftText(ed).split(/\s+/).filter(Boolean).length),
    onUpdate: ({ editor: ed }) => {
      setWords(draftText(ed).split(/\s+/).filter(Boolean).length);
      save(ed);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to } = ed.state.selection;
      setCursorPos(ed.state.doc.resolve(from).before(1) ?? null);
      if (from === to || !ed.isFocused) return setSel(null);
      const c = ed.view.coordsAtPos(from);
      const box = canvas.current?.getBoundingClientRect();
      if (!box) return setSel(null);
      setSel({ from, to, x: c.left - box.left, y: c.top - box.top });
    },
    onBlur: () => setTimeout(() => setSel((s) => (document.activeElement?.closest(".aw-bubble") ? s : null)), 150),
  });

  // Page breaks and block positions, after every change and on resize.
  useEffect(() => {
    if (!editor) return;
    let raf = 0;
    const run = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        const out = layOut(editor);
        setLayout({ blocks: out.blocks, pages: out.pages });
        const key = JSON.stringify(out.breaks);
        if (key !== lastBreaks.current) {
          lastBreaks.current = key;
          editor.view.dispatch(editor.state.tr.setMeta(pagesKey, out.breaks).setMeta("addToHistory", false));
        }
      });
    };
    run();
    editor.on("update", run);
    const obs = new ResizeObserver(run);
    obs.observe(editor.view.dom);
    document.fonts?.ready.then(run).catch(() => {});
    return () => {
      cancelAnimationFrame(raf);
      editor.off("update", run);
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
  const chipBlock = target ? null : (blockAt(hover) ?? blockAt(cursorPos));

  /** Open the one agent card, beside its line, with the line in the middle of the screen. */
  function open(t: Target, run?: () => void) {
    targetRef.current = t;
    setTarget(t);
    setCard("idle");
    setSel(null);
    const pos = t.kind === "block" ? t.pos : t.from;
    const dom = editor?.view.nodeDOM(t.kind === "block" ? pos : editor.state.doc.resolve(pos).before(1)) as HTMLElement | null;
    requestAnimationFrame(() => dom?.scrollIntoView?.({ behavior: "smooth", block: "center" }));
    if (run) setTimeout(run, 0);
  }
  const close = () => {
    targetRef.current = null;
    setTarget(null);
    setCard("idle");
  };

  const docText = () => (editor ? draftText(editor) : "");
  const textAround = (from: number, to: number) => {
    const d = editor!.state.doc;
    return { before: d.textBetween(Math.max(0, from - 4000), from, "\n").slice(-2500), after: d.textBetween(to, Math.min(d.content.size, to + 3000), "\n").slice(0, 1500) };
  };

  /** Run one agent job for the open card. */
  async function run(task: AgentTask, instruction = "") {
    const t = targetRef.current;
    if (!editor || !t) return;
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
        });
        setCard({ task: job, html: cleanHtml(out.html), note: out.note, preview: true });
        return;
      }
      // A heading: the agent works on its whole section, like the guide comments did.
      const sections = railSections(editor);
      const s = sections.find((x) => x.pos === t.pos) ?? sections.find((x) => x.heading === t.text);
      if (!s) throw new Error("This heading changed. Open it again.");
      const g = guides.get(guideKey(s.heading));
      const guide = [g?.text, ...(g?.points ?? []), ...s.notes, s.subs.length ? `This heading has sub-headings (${s.subs.join("; ")}). Write only the short lead-in that comes before them.` : ""].filter(Boolean).join("\n");
      const out = await post<WriterAgentResult>(auth, "/api/writer/agent", { siteId: site.id, docId: doc.id, task, heading: s.heading, guide, section: s.text, docText: docText(), instruction });
      setCard({ task, done: await applySection(s, out), note: "note" in out ? out.note : undefined });
    } catch (e) {
      setCard({ error: e instanceof Error ? e.message : String(e) });
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

  const exportHtml = () => brandTables(exportClean(editor?.getHTML() ?? ""), guideline);
  const icon = (label: string, svg: React.ReactNode, onClick: () => void, pressed?: boolean) => (
    <button type="button" className="aw-iconbtn" title={label} aria-label={label} aria-pressed={pressed} onClick={onClick}>
      {svg}
    </button>
  );
  const sections = editor ? railSections(editor) : [];
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
          <span className="flex items-center gap-1.5 px-1 text-[12px] whitespace-nowrap text-muted">
            <i className={`inline-block h-1.5 w-1.5 rounded-full ${state === "error" ? "bg-neg" : state === "saving" ? "bg-warn" : "bg-pos"}`} aria-hidden="true" />
            {state === "error" ? "Not saved" : state === "saving" ? "Saving" : "Saved"}
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

      <div className="aw-docs__desk">
        {full ? (
          <nav className="aw-docs__outline" aria-label="Outline">
            <span className="aw-label mb-2 block">Outline</span>
            {sections.length ? (
              sections.map((s) => (
                <button
                  key={`${s.pos}:${s.heading}`}
                  type="button"
                  className={`aw-docs__ol aw-docs__ol--${s.level}`}
                  onClick={() => (editor?.view.nodeDOM(s.pos) as HTMLElement | null)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                >
                  <span className="truncate">{s.heading || "Untitled"}</span>
                  {s.text.trim() ? <Tick /> : guides.has(guideKey(s.heading)) ? <span className="aw-docs__guide-dot" title="The brief has a guide for this section" /> : null}
                </button>
              ))
            ) : (
              <p className="text-[12px] text-muted">Headings show up here.</p>
            )}
          </nav>
        ) : null}

        <div ref={canvas} className="aw-docs__canvas" style={{ height: canvasH }} onMouseLeave={() => setHover(null)}>
          {Array.from({ length: layout.pages }, (_, i) => (
            <div key={i} className="aw-docs__page" style={{ top: i * PITCH, height: PAGE_H }} aria-hidden="true">
              <span className="aw-docs__pageno">
                {i + 1} of {layout.pages}
              </span>
            </div>
          ))}
          {targetBlock ? <div className="aw-docs__focus" style={{ top: MARGIN + targetBlock.top - 4, height: targetBlock.h + 8 }} aria-hidden="true" /> : null}
          <div
            className="aw-docs__body"
            style={{ paddingTop: MARGIN }}
            onMouseMove={(e) => {
              const y = e.clientY - (canvas.current?.getBoundingClientRect().top ?? 0) - MARGIN;
              const b = layout.blocks.find((x) => y >= x.top - 6 && y <= x.top + x.h + 6);
              setHover(b ? b.pos : null);
            }}
          >
            <EditorContent editor={editor} />
          </div>

          {/* The agent button for the line under the mouse, or the line with the cursor. */}
          {canEdit && chipBlock ? (
            <button
              type="button"
              className="aw-docs__chip"
              style={{ top: MARGIN + chipBlock.top + Math.min(chipBlock.h, 28) / 2 - 13 }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => open({ kind: "block", pos: chipBlock.pos, type: chipBlock.type, level: chipBlock.level, text: chipBlock.text })}
              title={chipBlock.type === "heading" ? "Ask the agent to write this section" : chipBlock.text.trim() ? "Ask the agent to rewrite this line" : "Ask the agent to write this line"}
            >
              <AiIcon />
              <span className="aw-docs__chip-label">{chipBlock.type === "heading" ? "Write section" : chipBlock.text.trim() ? "Rewrite" : "Write"}</span>
            </button>
          ) : null}

          {/* The selection menu: pick text, then ask the agent. */}
          {canEdit && sel && !target ? (
            <div className="aw-bubble" style={{ left: Math.max(0, sel.x - 8), top: sel.y - 46 }} onMouseDown={(e) => e.preventDefault()}>
              <button type="button" className="aw-bubble__ask" onClick={() => editor && open({ kind: "selection", from: sel.from, to: sel.to, text: editor.state.doc.textBetween(sel.from, sel.to, "\n") })}>
                <AiIcon />
                Ask agent
              </button>
              {REWRITES.slice(0, 3).map((r) => (
                <button
                  key={r.label}
                  type="button"
                  className="aw-bubble__btn"
                  onClick={() => editor && open({ kind: "selection", from: sel.from, to: sel.to, text: editor.state.doc.textBetween(sel.from, sel.to, "\n") }, () => run("rewrite", r.ask))}
                >
                  {r.label}
                </button>
              ))}
            </div>
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
                onAccept={accept}
                onUndo={() => editor?.chain().focus().undo().run()}
                onClose={close}
              />
            </div>
          ) : (
            <div className="aw-agent aw-agent--hint" style={{ top: MARGIN }}>
              <p className="text-[13px] font-medium text-ink">The agent works line by line</p>
              <ul className="mt-2 flex flex-col gap-1.5 text-[12px] text-body">
                <li>Press ✦ beside any line to write or rewrite it.</li>
                <li>On a heading, ✦ writes the whole section from the brief.</li>
                <li>Select any text to rewrite it, shorten it or ask for anything.</li>
              </ul>
              <p className="mt-3 text-[12px] text-muted">
                {layout.pages} {layout.pages === 1 ? "page" : "pages"} · {words.toLocaleString("en-US")} words
              </p>
            </div>
          )}
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

const SECTION_JOBS: AgentTask[] = ["write", "table", "stats", "widget", "links", "faq", "meta"];

/** The one open agent card: what it works on, the jobs it can do, and the result to keep or throw away. */
function AgentCard({
  target,
  guide,
  first,
  state,
  onRun,
  onAccept,
  onUndo,
  onClose,
}: {
  target: Target;
  guide?: Guide;
  first: boolean;
  state: CardState;
  onRun: (task: AgentTask, instruction?: string) => void;
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
        <span className="flex items-center gap-2 py-2 text-[13px] text-muted">
          <span className="aw-spin" aria-hidden="true" />
          The agent is writing...
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
