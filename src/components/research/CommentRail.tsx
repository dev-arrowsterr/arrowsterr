"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Editor } from "@tiptap/react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getDocMeta, saveDocMeta } from "@/lib/db";
import type { RunAuth } from "@/lib/runner";
import { guideKey, type Guide } from "@/lib/writer";
import { AGENT_TASKS, tasksFor, type AgentTask, type WriterAgentResult } from "@/lib/writerAgent";
import { AiIcon } from "../ui";
import { post } from "./shared";

/** A heading of the draft and what sits under it. */
export type RailSection = { pos: number; level: number; heading: string; text: string; subs: string[]; notes: string[] };

/** Every H1, H2 and H3 of a draft, with the text under it (up to the next heading of the same or a higher level). */
export function railSections(ed: Editor): RailSection[] {
  const nodes: { pos: number; type: string; level: number; text: string }[] = [];
  ed.state.doc.forEach((n, offset) => nodes.push({ pos: offset, type: n.type.name, level: n.type.name === "heading" ? (n.attrs.level as number) : 0, text: n.textContent }));
  const out: RailSection[] = [];
  nodes.forEach((n, i) => {
    if (n.type !== "heading" || n.level > 3) return;
    const s: RailSection = { pos: n.pos, level: n.level, heading: n.text, text: "", subs: [], notes: [] };
    for (let j = i + 1; j < nodes.length; j++) {
      const m = nodes[j];
      if (m.type === "heading" && m.level <= n.level) break;
      if (m.type === "heading") s.subs.push(m.text);
      else if (m.type === "note") {
        if (m.text.trim()) s.notes.push(m.text.trim());
      } else s.text += `${m.text}\n`;
    }
    out.push(s);
  });
  return out;
}

/** Where a section's own text starts and ends now: after its heading, up to the next heading of any level. Found again by the heading's text, since the draft changes. */
function bodyOf(editor: Editor, s: RailSection) {
  let start = -1;
  let end = editor.state.doc.content.size;
  let empty = true;
  editor.state.doc.forEach((n, offset) => {
    if (start >= 0 && end === editor.state.doc.content.size) {
      if (n.type.name === "heading") end = offset;
      else if (n.type.name !== "note" && (n.textContent.trim() || n.type.name !== "paragraph")) empty = false;
      return;
    }
    if (start < 0 && n.type.name === "heading" && n.attrs.level === s.level && n.textContent === s.heading) start = offset + n.nodeSize;
  });
  return start < 0 ? null : { start, end, empty };
}

type State = WriterAgentResult | { error: string } | "busy";
const GAP = 10;

/** The guide comments beside the draft, like comments in Google Docs: each one sits next to its heading and moves with it. */
export function GuideRail({
  sb,
  auth,
  siteId,
  docId,
  editor,
  sections,
  guides,
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
  guides: Map<string, Guide>;
  docText: string;
  canEdit: boolean;
  cursor: number;
}) {
  const rail = useRef<HTMLDivElement | null>(null);
  const cards = useRef<Map<number, HTMLDivElement>>(new Map());
  const [tops, setTops] = useState<number[]>([]);
  const [state, setState] = useState<Record<string, State>>({});

  const shown = useMemo(() => sections.filter((s) => guides.has(guideKey(s.heading)) || s.notes.length || s.level <= 2), [sections, guides]);
  const active = (() => {
    let a = -1;
    shown.forEach((s, i) => {
      if (s.pos <= cursor) a = i;
    });
    return a;
  })();

  // Line each comment up with its heading. The active one sits right beside it; the others make room above and below.
  const place = useCallback(() => {
    const box = rail.current?.getBoundingClientRect();
    if (!box) return;
    const want = shown.map((s) => {
      const dom = editor.view.nodeDOM(s.pos) as HTMLElement | null;
      return dom?.getBoundingClientRect ? Math.round(dom.getBoundingClientRect().top - box.top) : 0;
    });
    const h = shown.map((_, i) => cards.current.get(i)?.offsetHeight ?? 120);
    const top = [...want];
    const pin = active >= 0 ? active : 0;
    for (let i = pin + 1; i < top.length; i++) top[i] = Math.max(want[i], top[i - 1] + h[i - 1] + GAP);
    for (let i = pin - 1; i >= 0; i--) top[i] = Math.min(want[i], top[i + 1] - h[i] - GAP);
    // Never above the top of the rail.
    const lift = Math.min(0, ...top.slice(0, 1));
    const next = top.map((t) => t - lift);
    setTops((prev) => (prev.length === next.length && prev.every((t, i) => t === next[i]) ? prev : next));
  }, [shown, editor, active]);

  useLayoutEffect(() => {
    place();
  });
  useLayoutEffect(() => {
    const obs = new ResizeObserver(place);
    obs.observe(editor.view.dom);
    window.addEventListener("resize", place);
    return () => {
      obs.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [place, editor]);

  async function run(s: RailSection, task: AgentTask, instruction = "") {
    const key = `${s.pos}:${s.heading}`;
    setState((r) => ({ ...r, [key]: "busy" }));
    const g = guides.get(guideKey(s.heading));
    const guide = [g?.text, ...(g?.points ?? []), ...s.notes, s.subs.length ? `This heading has sub-headings (${s.subs.join("; ")}). Write only the short lead-in that comes before them.` : ""].filter(Boolean).join("\n");
    try {
      const out = await post<WriterAgentResult & { replace?: boolean }>(auth, "/api/writer/agent", { siteId, docId, task, heading: s.heading, guide, section: s.text, docText, instruction });
      // Done for you: the result goes straight into the section.
      const body = bodyOf(editor, s);
      if (!body) throw new Error("This heading changed. Run the agent again.");
      if ("html" in out) {
        if (out.task === "write" && body.empty) editor.chain().focus().insertContentAt({ from: body.start, to: body.end }, out.html).run();
        else editor.chain().focus().insertContentAt(body.end, out.html).run();
      } else if (out.task === "widget") editor.chain().focus().insertContentAt(body.end, { type: "embed", attrs: { html: out.embed } }).run();
      else if (out.task === "links") {
        for (const l of out.links) {
          const b = bodyOf(editor, s);
          if (!b) break;
          let at: { from: number; to: number } | null = null;
          editor.state.doc.nodesBetween(b.start, b.end, (n, p) => {
            if (at || !n.isText) return;
            const k = (n.text ?? "").toLowerCase().indexOf(l.anchor.toLowerCase());
            if (k >= 0) at = { from: p + k, to: p + k + l.anchor.length };
          });
          if (at) editor.chain().setTextSelection(at).setLink({ href: l.url }).run();
        }
      } else if (out.task === "meta") await saveDocMeta(sb, docId, { ...(await getDocMeta(sb, docId)), title: out.meta.title, description: out.meta.description, slug: out.meta.slug });
      else if (out.task === "faq") await saveDocMeta(sb, docId, { ...(await getDocMeta(sb, docId)), schema: out.schema });
      setState((r) => ({ ...r, [key]: out }));
    } catch (e) {
      setState((r) => ({ ...r, [key]: { error: e instanceof Error ? e.message : String(e) } }));
    }
  }

  const jump = (s: RailSection) => {
    const dom = editor.view.nodeDOM(s.pos) as HTMLElement | null;
    dom?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    editor.chain().focus().setTextSelection(Math.min(s.pos + 1, editor.state.doc.content.size)).run();
  };

  const last = tops.length ? tops[tops.length - 1] + (cards.current.get(tops.length - 1)?.offsetHeight ?? 0) : 0;
  return (
    <div ref={rail} className="relative" style={{ minHeight: last }} aria-label="Guide comments">
      {shown.map((s, i) => (
        <div
          key={`${s.pos}:${s.heading}`}
          ref={(el) => {
            if (el) cards.current.set(i, el);
            else cards.current.delete(i);
          }}
          className="absolute right-0 left-0 transition-[top] duration-200 ease-out"
          style={{ top: tops[i] ?? 0 }}
        >
          <GuideCard
            s={s}
            guide={guides.get(guideKey(s.heading))}
            first={i === 0}
            active={i === active}
            canEdit={canEdit}
            state={state[`${s.pos}:${s.heading}`]}
            onRun={(t, x) => run(s, t, x)}
            onJump={() => jump(s)}
            onUndo={() => editor.chain().focus().undo().run()}
          />
        </div>
      ))}
    </div>
  );
}

const TASK_ICON: Record<AgentTask, React.ReactNode> = {
  write: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  table: <path d="M4 5h16v14H4zM4 10h16M10 5v14" />,
  widget: <path d="M8 8 4 12l4 4M16 8l4 4-4 4M13.5 5l-3 14" />,
  stats: <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />,
  links: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  faq: <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />,
  meta: <path d="M3 12V4h8l10 10-8 8zM7.5 8.5h.01" />,
  custom: <path d="M12 3l2 5.5 5.5 2-5.5 2L12 18l-2-5.5-5.5-2 5.5-2z" />,
};
const TaskIcon = ({ t }: { t: AgentTask }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
    {TASK_ICON[t]}
  </svg>
);

const DONE: Record<AgentTask, string> = {
  write: "Written into this section",
  table: "Table added to this section",
  widget: "Interactive element added",
  stats: "Stats added to this section",
  links: "Links added",
  faq: "FAQ schema saved for publishing",
  meta: "Meta saved for publishing",
  custom: "Added to this section",
};

function GuideCard({
  s,
  guide,
  first,
  active,
  canEdit,
  state,
  onRun,
  onJump,
  onUndo,
}: {
  s: RailSection;
  guide?: Guide;
  first: boolean;
  active: boolean;
  canEdit: boolean;
  state?: State;
  onRun: (t: AgentTask, instruction?: string) => void;
  onJump: () => void;
  onUndo: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [ask, setAsk] = useState("");
  const tasks = tasksFor(s.heading, s.level, first);
  const busy = state === "busy";
  return (
    <div className={`aw-guide ${active ? "is-active" : ""}`}>
      <button type="button" className="aw-guide__head" onClick={onJump} title="Go to this heading">
        <span className="aw-guide__lvl">H{s.level}</span>
        <span className="min-w-0 flex-1 truncate">{s.heading || "Untitled"}</span>
      </button>
      {guide ? <p className="aw-guide__text">{guide.text}</p> : null}
      {guide?.points?.length ? (
        <ul className="aw-guide__points">
          {guide.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      {s.notes.map((n) => (
        <p key={n} className="aw-guide__text">
          {n}
        </p>
      ))}

      {canEdit ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <button type="button" className="aw-guide__go" disabled={busy} onClick={() => onRun(tasks[0])}>
              <AiIcon />
              {busy ? "Working..." : AGENT_TASKS[tasks[0]].label}
            </button>
            <button type="button" className="aw-guide__more" aria-label="More agent jobs" aria-expanded={menu} onClick={() => setMenu(!menu)} disabled={busy}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={menu ? "rotate-180" : ""}>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>
          {menu ? (
            <div className="flex flex-col gap-0.5">
              {tasks.slice(1).map((t) => (
                <button
                  key={t}
                  type="button"
                  className="aw-guide__task"
                  onClick={() => {
                    setMenu(false);
                    onRun(t);
                  }}
                >
                  <TaskIcon t={t} />
                  <span className="flex min-w-0 flex-col items-start">
                    <span className="text-[13px] text-ink">{AGENT_TASKS[t].label}</span>
                    <span className="text-[11px] text-muted">{AGENT_TASKS[t].hint}</span>
                  </span>
                </button>
              ))}
              <form
                className="mt-1 flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!ask.trim()) return;
                  setMenu(false);
                  onRun("custom", ask.trim());
                  setAsk("");
                }}
              >
                <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Or tell the agent what to do..." aria-label="Tell the agent what to do" className="aw-guide__ask" />
                <button type="submit" className="aw-guide__more" aria-label="Run" disabled={!ask.trim()}>
                  <TaskIcon t="custom" />
                </button>
              </form>
            </div>
          ) : null}
        </div>
      ) : null}

      {busy ? (
        <span className="flex items-center gap-2 text-[12px] text-muted">
          <span className="aw-spin" aria-hidden="true" />
          The agent is working on this section...
        </span>
      ) : state && "error" in state ? (
        <span className="text-[12px] text-neg">{state.error}</span>
      ) : state ? (
        <div className="aw-guide__done">
          <span className="flex items-center gap-1.5">
            <span className="text-pos">✓</span>
            {DONE[state.task]}
          </span>
          {"note" in state && state.note ? <span className="text-muted">{state.note}</span> : null}
          {state.task === "meta" ? (
            <span className="flex flex-col gap-0.5 text-ink">
              <span>{state.meta.title}</span>
              <span className="text-muted">{state.meta.description}</span>
            </span>
          ) : null}
          {state.task === "links" ? <span className="text-muted">{state.links.map((l) => l.anchor).join(" · ") || "No matching pages found."}</span> : null}
          {["write", "table", "widget", "stats", "custom", "links"].includes(state.task) ? (
            <button type="button" className="aw-text-link self-start text-[12px]" onClick={onUndo}>
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
