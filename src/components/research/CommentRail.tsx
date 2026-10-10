"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { getDocMeta, saveDocMeta } from "@/lib/db";
import type { RunAuth } from "@/lib/runner";
import { AGENT_TASKS, type AgentTask, type WriterAgentResult } from "@/lib/writerAgent";
import { AiIcon } from "../ui";
import { post } from "./shared";

/** A part of the draft under one H1 or H2, with the brief's notes for it. */
export type RailSection = { pos: number; end: number; level: number; heading: string; text: string; notes: string[] };

/** Split a draft into sections at each H1 and H2. Notes go to the section they sit in. */
export function railSections(ed: Editor): RailSection[] {
  const out: RailSection[] = [];
  ed.state.doc.forEach((n, offset) => {
    if (n.type.name === "heading" && (n.attrs.level as number) <= 2) {
      if (out.length) out[out.length - 1].end = offset;
      out.push({ pos: offset, end: ed.state.doc.content.size, level: n.attrs.level as number, heading: n.textContent, text: "", notes: [] });
      return;
    }
    if (!out.length) out.push({ pos: 0, end: ed.state.doc.content.size, level: 1, heading: "Intro", text: "", notes: [] });
    const cur = out[out.length - 1];
    if (n.type.name === "note") {
      if (n.textContent.trim()) cur.notes.push(n.textContent.trim());
    } else cur.text += `${n.textContent}\n`;
  });
  return out;
}

/** The comments in the side panel: one per section of the draft. The brief's notes are read-only; each comment has agents for jobs around the writing. */
export function SectionComments({
  sb,
  auth,
  siteId,
  docId,
  editor,
  sections,
  docText,
  canEdit,
  cursor,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  siteId: string;
  docId: string;
  editor: Editor;
  sections: RailSection[];
  docText: string;
  canEdit: boolean;
  cursor: number;
}) {
  const [results, setResults] = useState<Record<string, WriterAgentResult | { error: string } | "busy">>({});
  const refs = useRef<Map<number, HTMLDivElement>>(new Map());
  const active = sections.findIndex((s) => cursor >= s.pos && cursor < s.end);

  // The comment for the section being written follows the cursor.
  useEffect(() => {
    if (active >= 0) refs.current.get(active)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  async function run(i: number, task: AgentTask) {
    const s = sections[i];
    const key = `${s.heading}:${task}`;
    setResults((r) => ({ ...r, [key]: "busy" }));
    try {
      const out = await post<WriterAgentResult>(auth, "/api/writer/agent", { siteId, docId, task, heading: s.heading, section: s.text, docText });
      setResults((r) => ({ ...r, [key]: out }));
    } catch (e) {
      setResults((r) => ({ ...r, [key]: { error: e instanceof Error ? e.message : String(e) } }));
    }
  }
  const jump = (s: RailSection) => {
    const dom = editor.view.nodeDOM(s.pos) as HTMLElement | null;
    dom?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    editor.chain().focus().setTextSelection(Math.min(s.pos + 1, editor.state.doc.content.size)).run();
  };

  if (!sections.length) return <p className="aw-small p-4">Add a heading to start a section.</p>;
  return (
    <div className="flex flex-col gap-2.5 p-3">
      {sections.map((s, i) => (
        <div
          key={`${i}:${s.heading}`}
          ref={(el) => {
            if (el) refs.current.set(i, el);
            else refs.current.delete(i);
          }}
        >
          <Comment
            section={s}
            first={i === 0}
            active={i === active}
            canEdit={canEdit}
            results={results}
            onRun={(t) => run(i, t)}
            onJump={() => jump(s)}
            editor={editor}
            onSaveMeta={async (m) => saveDocMeta(sb, docId, { ...(await getDocMeta(sb, docId)), ...m })}
          />
        </div>
      ))}
    </div>
  );
}

const TASK_ICON: Record<AgentTask, React.ReactNode> = {
  table: <path d="M4 5h16v14H4zM4 10h16M10 5v14" />,
  stats: <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />,
  links: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  faq: <path d="M8 4 3 12l5 8M16 4l5 8-5 8" />,
  meta: <path d="M3 12V4h8l10 10-8 8zM7.5 8.5h.01" />,
};
const TaskIcon = ({ t }: { t: AgentTask }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
    {TASK_ICON[t]}
  </svg>
);

function Comment({
  section,
  first,
  active,
  canEdit,
  results,
  onRun,
  onJump,
  editor,
  onSaveMeta,
}: {
  section: RailSection;
  first: boolean;
  active: boolean;
  canEdit: boolean;
  results: Record<string, WriterAgentResult | { error: string } | "busy">;
  onRun: (t: AgentTask) => void;
  onJump: () => void;
  editor: Editor;
  onSaveMeta: (m: Record<string, string>) => Promise<void>;
}) {
  const [menu, setMenu] = useState(false);
  const tasks = AGENT_TASKS.filter((t) => !t.first || first);
  const mine = tasks.map((t) => ({ t, r: results[`${section.heading}:${t.id}`] })).filter((x) => x.r);
  return (
    <div className={`aw-comment ${active ? "is-active" : ""}`}>
      <button type="button" className="aw-comment__head" onClick={onJump} title="Go to this section">
        <span className="aw-comment__lvl">{section.heading === "Intro" ? "¶" : `H${section.level}`}</span>
        <span className="min-w-0 flex-1 truncate">{section.heading || "Untitled section"}</span>
        {section.notes.length ? <span className="aw-comment__badge">{section.notes.length}</span> : null}
      </button>
      {section.notes.length ? (
        <div className="flex flex-col gap-1.5">
          {section.notes.map((n, k) => (
            <p key={k} className="aw-comment__note">
              {n}
            </p>
          ))}
        </div>
      ) : null}
      {canEdit ? (
        <div className="relative">
          <button type="button" className="aw-comment__agent" onClick={() => setMenu(!menu)} aria-expanded={menu}>
            <AiIcon />
            AI agent
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={menu ? "rotate-180" : ""}>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {menu ? (
            <ul className="mt-1.5 flex flex-col gap-0.5" role="menu">
              {tasks.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    role="menuitem"
                    className="aw-comment__task"
                    onClick={() => {
                      setMenu(false);
                      onRun(t.id);
                    }}
                  >
                    <TaskIcon t={t.id} />
                    <span className="flex min-w-0 flex-col items-start">
                      <span className="text-[13px] text-ink">{t.label}</span>
                      <span className="text-[11px] text-muted">{t.hint}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {mine.map(({ t, r }) => (
        <div key={t.id} className="aw-comment__result">
          <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
            <TaskIcon t={t.id} />
            {t.label}
          </span>
          {r === "busy" ? (
            <span className="flex items-center gap-2 text-muted">
              <span className="aw-spin" aria-hidden="true" />
              Working...
            </span>
          ) : "error" in r! ? (
            <span className="text-neg">{r.error}</span>
          ) : (
            <Result r={r!} section={section} editor={editor} onSaveMeta={onSaveMeta} />
          )}
        </div>
      ))}
    </div>
  );
}

/** Where a section ends now, found again by its heading since the draft may have changed. */
function endOf(editor: Editor, section: RailSection) {
  let start = -1;
  let end = editor.state.doc.content.size;
  editor.state.doc.forEach((n, offset) => {
    if (n.type.name !== "heading" || (n.attrs.level as number) > 2) return;
    if (start < 0 && n.textContent === section.heading) start = offset;
    else if (start >= 0 && offset > start && end === editor.state.doc.content.size) end = offset;
  });
  return { start: Math.max(0, start), end };
}

const cell = (type: "tableHeader" | "tableCell", t: string) => ({ type, content: [{ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] }] });

function Result({ r, section, editor, onSaveMeta }: { r: WriterAgentResult; section: RailSection; editor: Editor; onSaveMeta: (m: Record<string, string>) => Promise<void> }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState("");
  const mark = (k: string) => setDone((d) => new Set(d).add(k));
  const insert = (content: unknown) => editor.chain().focus().insertContentAt(endOf(editor, section).end, content as never).run();
  const btn = "aw-btn aw-btn--secondary aw-btn--sm px-2! py-0.5! text-[12px]!";
  const save = async (m: Record<string, string>) => {
    try {
      await onSaveMeta(m);
      setSaved("Saved for publishing");
    } catch (e) {
      setSaved(e instanceof Error ? e.message : String(e));
    }
  };

  if (r.task === "table")
    return (
      <>
        <div className="max-h-48 overflow-auto border border-rule-faint">
          <table className="w-full text-[11px]">
            <thead>
              <tr>
                {r.table.head.map((h, i) => (
                  <th key={i} className="bg-surface-2 px-1.5 py-1 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((c, j) => (
                    <td key={j} className="border-t border-rule-faint px-1.5 py-1">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className={`${btn} self-start`}
          disabled={done.has("t")}
          onClick={() => {
            insert({ type: "table", content: [{ type: "tableRow", content: r.table.head.map((h) => cell("tableHeader", h)) }, ...r.table.rows.map((row) => ({ type: "tableRow", content: r.table.head.map((_, j) => cell("tableCell", row[j] ?? "")) }))] });
            mark("t");
          }}
        >
          {done.has("t") ? "Inserted" : "Insert table"}
        </button>
      </>
    );

  if (r.task === "stats")
    return (
      <ul className="flex flex-col gap-2">
        {r.stats.map((s, i) => (
          <li key={i} className="flex flex-col gap-1">
            <span className="text-body">{s.stat}</span>
            <span className="flex items-center justify-between gap-2">
              <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-[11px]">
                {s.source}
                {s.year ? `, ${s.year}` : ""}
              </a>
              <button
                type="button"
                className={btn}
                disabled={done.has(String(i))}
                onClick={() => {
                  insert({ type: "paragraph", content: [{ type: "text", text: `${s.stat} (` }, { type: "text", text: s.source || "source", marks: [{ type: "link", attrs: { href: s.url } }] }, { type: "text", text: ")" }] });
                  mark(String(i));
                }}
              >
                {done.has(String(i)) ? "Inserted" : "Insert"}
              </button>
            </span>
          </li>
        ))}
        {!r.stats.length ? <li className="text-muted">No stats with a source found.</li> : null}
      </ul>
    );

  if (r.task === "faq")
    return (
      <>
        <span className="text-body">{r.faq.length} questions in FAQPage schema.</span>
        <pre className="max-h-40 overflow-auto bg-surface-2 p-2 text-[10px]">{r.schema}</pre>
        <span className="flex flex-wrap gap-1.5">
          <button type="button" className={btn} onClick={() => navigator.clipboard.writeText(`<script type="application/ld+json">\n${r.schema}\n</script>`)}>
            Copy
          </button>
          <button type="button" className={btn} onClick={() => save({ schema: r.schema })}>
            Save for publishing
          </button>
        </span>
        {saved ? <span className="text-[11px] text-muted">{saved}</span> : null}
      </>
    );

  if (r.task === "meta")
    return (
      <>
        {[
          ["Meta title", r.meta.title, 60],
          ["Meta description", r.meta.description, 155],
          ["Slug", r.meta.slug, 0],
        ].map(([lab, v, max]) => (
          <span key={lab as string} className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted">
              {lab}
              {max ? ` · ${(v as string).length}/${max}` : ""}
            </span>
            <span className="text-ink">{v}</span>
          </span>
        ))}
        <button type="button" className={`${btn} self-start`} onClick={() => save({ title: r.meta.title, description: r.meta.description, slug: r.meta.slug })}>
          Save for publishing
        </button>
        {saved ? <span className="text-[11px] text-muted">{saved}</span> : null}
      </>
    );

  // Internal links: find the anchor words in the section and link them.
  const apply = (anchor: string, url: string) => {
    const { start, end } = endOf(editor, section);
    let at: { from: number; to: number } | null = null;
    editor.state.doc.nodesBetween(start, end, (n, pos) => {
      if (at || !n.isText) return;
      const k = (n.text ?? "").toLowerCase().indexOf(anchor.toLowerCase());
      if (k >= 0) at = { from: pos + k, to: pos + k + anchor.length };
    });
    if (!at) return false;
    editor.chain().focus().setTextSelection(at).setLink({ href: url }).run();
    return true;
  };
  return (
    <ul className="flex flex-col gap-2">
      {r.links.map((l) => (
        <li key={l.url} className="flex flex-col gap-1">
          <span className="text-ink">&ldquo;{l.anchor}&rdquo;</span>
          <span className="flex items-center justify-between gap-2">
            <a href={l.url} target="_blank" rel="noopener noreferrer" className="truncate text-[11px]" title={l.url}>
              {l.url.replace(/^https?:\/\/(www\.)?[^/]+/, "") || "/"}
            </a>
            <button type="button" className={btn} disabled={done.has(l.url)} onClick={() => (apply(l.anchor, l.url) ? mark(l.url) : alert(`"${l.anchor}" is no longer in this section.`))}>
              {done.has(l.url) ? "Linked" : "Link it"}
            </button>
          </span>
        </li>
      ))}
      {!r.links.length ? <li className="text-muted">No matching pages found.</li> : null}
    </ul>
  );
}
