"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuditIssue, AuditResult } from "@/lib/audit";
import type { RunAuth } from "@/lib/runner";
import { Markdown } from "./Markdown";
import { Zippie } from "./Zippie";

// Zippie: a chat that does things. Chats on the right, grouped into projects. Knowledge teaches him
// about the business, and skills teach him how to do a kind of task.

type View = "chat" | "knowledge" | "skills" | "project";
type Thread = { id: string; title: string; updated_at: string; project_id: string | null; created_by?: string | null };
type Card = { kind: "changeset" | "audit"; id: string };
type Msg = { id: number | string; role: "user" | "assistant"; text: string; tools: string[]; cards: Card[]; working?: string; skill?: string };
type Project = { id: string; name: string; instructions: string; updated_at: string };
type Knowledge = { id: string; kind: "file" | "url" | "note"; name: string; source: string; chars: number; project_id: string | null; created_at: string };
type Skill = { key: string; name: string; description: string; instructions: string; builtin: boolean; enabled: boolean };
type Library = { projects: Project[]; knowledge: Knowledge[]; skills: Skill[]; setup?: string };

const ACTIONS: { verb: string; rest: string; prompt: string }[] = [
  { verb: "Audit", rest: "my website for SEO and AI readiness", prompt: "Audit my website for SEO and AI readiness." },
  { verb: "Write", rest: "meta descriptions for pages missing one", prompt: "Find the pages on my site with no meta description and write them." },
  { verb: "Add", rest: "FAQ sections to my top blog posts", prompt: "Add FAQ sections to my top blog posts, based on what buyers ask AI." },
  { verb: "Find", rest: "why AI picks my competitors over me", prompt: "How visible is my brand in AI answers this month, why do competitors beat me, and what should I fix first?" },
];
const TOOL_LABEL: Record<string, string> = {
  start_site_audit: "Started a site audit",
  get_site_audit: "Read the site audit",
  list_cms_connections: "Checked your CMS",
  get_site_content: "Read your posts and pages",
  propose_changes: "Prepared changes",
  get_change_set: "Checked a change set",
  load_skill: "Loaded a skill",
  read_knowledge: "Read your knowledge",
  list_brands: "Looked up your brands",
  get_ai_visibility: "Read AI visibility",
  get_visibility_trend: "Read the trend",
  get_prompts: "Read your prompts",
  get_prompt_answers: "Read AI answers",
  get_competitors: "Compared competitors",
  get_cited_sources: "Read cited sources",
  get_content_plan: "Read the Content Plan",
  get_topic_bank: "Read the topic bank",
};
const toolLabel = (n: string) => TOOL_LABEL[n] ?? n.replace(/_/g, " ");
const FILE_TYPES = ".txt,.md,.markdown,.csv,.json,.html,.htm,.xml,.pdf";

function useApi(auth: RunAuth) {
  return useCallback(
    async <T,>(path: string, body: Record<string, unknown>): Promise<T> => {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` },
        body: JSON.stringify({ ...body, workspaceId: auth.workspaceId }),
      });
      const out = await res.json().catch(() => ({ error: `The server returned ${res.status}.` }));
      if (!res.ok) throw new Error(out.error ?? `The server returned ${res.status}.`);
      return out as T;
    },
    [auth],
  );
}

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Read a file the person picked: text as text, PDFs as base64 for the server to read. */
async function readFile(f: File): Promise<{ name: string; content?: string; pdf?: string }> {
  if (f.size > 10_000_000) throw new Error(`${f.name} is over 10 MB.`);
  if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") {
    const bytes = new Uint8Array(await f.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { name: f.name, pdf: btoa(bin) };
  }
  return { name: f.name, content: await f.text() };
}

// ─────────────── Icons ───────────────

function Spark({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <path d="M12 1.5c.6 4.9 2.9 8.6 10.5 10.5-7.6 1.9-9.9 5.6-10.5 10.5-.6-4.9-2.9-8.6-10.5-10.5C9.1 10.1 11.4 6.4 12 1.5z" fill="currentColor" />
    </svg>
  );
}
const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />
);
const I = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5Z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>',
  dots: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  note: '<path d="M4 4h16v12l-4 4H4Z"/><path d="M16 20v-4h4"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M14.5 4.5v15"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>',
};

// ─────────────── Page ───────────────

export function ZippiePage({ auth, canEdit }: { auth: RunAuth; canEdit: boolean }) {
  const api = useApi(auth);
  const [view, setView] = useState<View>("chat");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [lib, setLib] = useState<Library>({ projects: [], knowledge: [], skills: [] });
  const [setup, setSetup] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState(true);
  const stopRef = useRef<AbortController | null>(null);

  const loadThreads = useCallback(() => {
    api<{ threads: Thread[]; setup?: string }>("/api/ask", { action: "threads" })
      .then((r) => {
        setThreads(r.threads);
        if (r.setup) setSetup(r.setup);
      })
      .catch((e) => setError(msgOf(e)));
  }, [api]);
  const loadLib = useCallback(() => {
    api<Library>("/api/ask/library", { action: "list" })
      .then((r) => setLib(r))
      .catch((e) => setError(msgOf(e)));
  }, [api]);
  useEffect(() => {
    loadThreads();
    loadLib();
    // Load once per workspace. auth changes identity on every app render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.workspaceId]);

  const project = lib.projects.find((p) => p.id === projectId) ?? null;

  const newChat = (inProject: string | null = null) => {
    stopRef.current?.abort();
    setThreadId(null);
    setMessages([]);
    setProjectId(inProject);
    setView("chat");
    setError("");
  };

  const openThread = async (t: Thread) => {
    stopRef.current?.abort();
    setView("chat");
    setThreadId(t.id);
    setProjectId(t.project_id);
    setError("");
    setMessages([]);
    try {
      const r = await api<{ messages: Msg[] }>("/api/ask", { action: "thread", threadId: t.id });
      setMessages(r.messages);
    } catch (e) {
      setError(msgOf(e));
    }
  };

  const send = async (text: string, skill: Skill | null, fresh = false) => {
    const message = text.trim();
    if (!message || busy) return;
    setError("");
    setBusy(true);
    setView("chat");
    const reply: Msg = { id: `a${Date.now()}`, role: "assistant", text: "", tools: [], cards: [], working: skill ? `Using ${skill.name}` : "Thinking" };
    setMessages((m) => [...(fresh ? [] : m), { id: `u${Date.now()}`, role: "user", text: message, tools: [], cards: [], skill: skill?.name }, reply]);
    const patch = (f: (m: Msg) => Msg) => setMessages((all) => all.map((m) => (m.id === reply.id ? f(m) : m)));
    const ctrl = new AbortController();
    stopRef.current = ctrl;
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` },
        body: JSON.stringify({ action: "send", workspaceId: auth.workspaceId, threadId: fresh ? null : threadId, projectId, message, skill: skill?.key }),
      });
      if (!res.ok || !res.body) {
        const out = await res.json().catch(() => ({}));
        throw new Error(out.error ?? `The server returned ${res.status}.`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (e.type === "thread") {
            setThreadId(e.id);
            setThreads((t) => (t.some((x) => x.id === e.id) ? t : [{ id: e.id, title: e.title, updated_at: new Date().toISOString(), project_id: e.projectId ?? null }, ...t]));
          } else if (e.type === "text") patch((m) => ({ ...m, text: m.text + e.text, working: undefined }));
          else if (e.type === "tool") patch((m) => ({ ...m, working: e.label, text: m.text && !m.text.endsWith("\n\n") ? m.text + "\n\n" : m.text }));
          else if (e.type === "tool_done") patch((m) => ({ ...m, tools: [...m.tools, e.name], working: "Thinking" }));
          else if (e.type === "changeset") patch((m) => ({ ...m, cards: [...m.cards, { kind: "changeset", id: e.id }] }));
          else if (e.type === "audit") patch((m) => ({ ...m, cards: [...m.cards, { kind: "audit", id: e.id }] }));
          else if (e.type === "error") setError(e.error);
        }
      }
    } catch (e) {
      if (!ctrl.signal.aborted) setError(msgOf(e));
    } finally {
      patch((m) => ({ ...m, working: undefined, text: m.text || (ctrl.signal.aborted ? "_Stopped._" : m.text) }));
      setBusy(false);
      stopRef.current = null;
      loadThreads();
    }
  };

  const threadAction = async (t: Thread, action: "rename" | "delete" | "move", extra: Record<string, unknown> = {}) => {
    try {
      await api("/api/ask", { action, threadId: t.id, ...extra });
      if (action === "delete") {
        setThreads((all) => all.filter((x) => x.id !== t.id));
        if (t.id === threadId) newChat();
      } else loadThreads();
      if (action === "move" && t.id === threadId) setProjectId((extra.projectId as string) ?? null);
    } catch (e) {
      setError(msgOf(e));
    }
  };

  const newChatWithSkill = (s: Skill) => {
    newChat(projectId);
    setPendingSkill(s);
  };

  const addFiles = async (files: File[]) => {
    for (const f of files) {
      try {
        const body = await readFile(f);
        await api("/api/ask/library", { action: "knowledge_add", kind: "file", projectId, ...body });
      } catch (e) {
        setError(msgOf(e));
      }
    }
    loadLib();
  };

  if (setup) return <div className="aw-callout m-6 max-w-xl">{setup}</div>;

  return (
    <div className="zp">
      <section className="zp-main">
        <header className="zp-head">
          <div className="flex min-w-0 items-center gap-2">
            {view === "chat" && project ? (
              <>
                <button type="button" className="zp-crumb" onClick={() => setView("project")}>
                  <Icon d={I.folder} size={15} /> {project.name}
                </button>
                <span className="text-muted">/</span>
              </>
            ) : null}
            <span className="truncate text-[15px] font-medium text-ink">
              {view === "knowledge" ? "Knowledge" : view === "skills" ? "Skills" : view === "project" ? (project?.name ?? "Project") : (threads.find((t) => t.id === threadId)?.title ?? "Zippie")}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" className="zp-icon-btn" onClick={() => newChat(view === "project" ? projectId : null)} title="New chat" aria-label="New chat">
              <Icon d={I.edit} />
            </button>
            <button type="button" className="zp-icon-btn" onClick={() => setPanel(!panel)} title={panel ? "Hide chats" : "Show chats"} aria-label={panel ? "Hide chats" : "Show chats"}>
              <Icon d={I.panel} />
            </button>
          </div>
        </header>

        {view === "knowledge" ? (
          <KnowledgeView api={api} lib={lib} canEdit={canEdit} onChange={loadLib} scope={projectId} />
        ) : view === "skills" ? (
          <SkillsView api={api} lib={lib} canEdit={canEdit} onChange={(skills) => setLib((l) => ({ ...l, skills }))} onUse={(s) => newChatWithSkill(s)} />
        ) : view === "project" && project ? (
          <ProjectView
            api={api}
            project={project}
            threads={threads.filter((t) => t.project_id === project.id)}
            knowledge={lib.knowledge.filter((k) => k.project_id === project.id)}
            canEdit={canEdit}
            skills={lib.skills}
            busy={busy}
            onOpen={openThread}
            onSend={(text, skill) => {
              setThreadId(null);
              send(text, skill, true);
            }}
            onFiles={addFiles}
            onChange={loadLib}
            onDeleted={() => {
              setProjectId(null);
              newChat();
              loadLib();
              loadThreads();
            }}
            onKnowledge={() => setView("knowledge")}
          />
        ) : (
          <ChatView
            api={api}
            messages={messages}
            busy={busy}
            error={error}
            canEdit={canEdit}
            skills={lib.skills}
            project={project}
            onSend={send}
            onStop={() => stopRef.current?.abort()}
            onError={setError}
            onKnowledgeFiles={addFiles}
          />
        )}
      </section>

      {panel ? (
        <ChatsPanel
          threads={threads}
          projects={lib.projects}
          threadId={threadId}
          projectId={projectId}
          view={view}
          canEdit={canEdit}
          onNew={() => newChat()}
          onOpen={openThread}
          onProject={(id) => {
            setProjectId(id);
            setView("project");
          }}
          onNewProject={async () => {
            const name = prompt("Name your project");
            if (!name?.trim()) return;
            try {
              const r = await api<{ project: Project }>("/api/ask/library", { action: "project_save", name });
              setLib((l) => ({ ...l, projects: [r.project, ...l.projects] }));
              setProjectId(r.project.id);
              setView("project");
            } catch (e) {
              setError(msgOf(e));
            }
          }}
          onView={(v) => {
            setView(v);
            if (v === "knowledge") setProjectId(null);
          }}
          onThread={threadAction}
          counts={{ knowledge: lib.knowledge.length, skills: lib.skills.filter((s) => s.enabled).length }}
        />
      ) : null}
    </div>
  );
}

// A skill picked from the Skills page waits here until the composer takes it.
let pending: Skill | null = null;
const listeners = new Set<(s: Skill | null) => void>();
function setPendingSkill(s: Skill | null) {
  pending = s;
  listeners.forEach((l) => l(s));
}
function usePendingSkill(): [Skill | null, (s: Skill | null) => void] {
  const [s, setS] = useState<Skill | null>(pending);
  useEffect(() => {
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return [s, setPendingSkill];
}

// ─────────────── Chat ───────────────

function ChatView(p: {
  api: ReturnType<typeof useApi>;
  messages: Msg[];
  busy: boolean;
  error: string;
  canEdit: boolean;
  skills: Skill[];
  project: Project | null;
  onSend: (text: string, skill: Skill | null) => void;
  onStop: () => void;
  onError: (e: string) => void;
  onKnowledgeFiles: (files: File[]) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  const last = p.messages[p.messages.length - 1];
  // Newer Chrome returns a Promise from scrollIntoView. An effect must return nothing or a cleanup function, so keep the braces.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [p.messages.length, last?.text.length, last?.working]);

  if (!p.messages.length) {
    return (
      <div className="zp-scroll">
        <div className="zp-empty">
          <Zippie size={96} mood="happy" />
          <h1 className="zp-hello">{p.project ? `What should we do in ${p.project.name}?` : "What should Zippie do?"}</h1>
          <p className="max-w-md text-center text-[14px] text-muted">He reads your Arrowsterr data, audits your site and prepares fixes for your CMS. You approve every change.</p>
          <div className="w-full">
            <Composer {...p} big />
          </div>
          <div className="zp-actions">
            {ACTIONS.map((a) => (
              <button key={a.verb} type="button" className="zp-action" onClick={() => p.onSend(a.prompt, null)} disabled={p.busy}>
                <span className="zp-action__verb">
                  <Spark size={13} /> {a.verb}
                </span>
                <span className="zp-action__rest">{a.rest}</span>
              </button>
            ))}
          </div>
          {p.error ? <div className="aw-error w-full">{p.error}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="zp-scroll">
        <div className="zp-thread">
          {p.messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex flex-col items-end gap-1">
                {m.skill ? (
                  <span className="zp-skill-tag">
                    <Spark size={11} /> {m.skill}
                  </span>
                ) : null}
                <div className="zp-user">{m.text}</div>
              </div>
            ) : (
              <Reply key={m.id} m={m} api={p.api} canEdit={p.canEdit} />
            ),
          )}
          {p.error ? <div className="aw-error">{p.error}</div> : null}
          <div ref={end} />
        </div>
      </div>
      <div className="zp-dock">
        <Composer {...p} />
      </div>
    </>
  );
}

function Reply({ m, api, canEdit }: { m: Msg; api: ReturnType<typeof useApi>; canEdit: boolean }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <div className="zp-reply">
      <Zippie size={30} mood={m.working ? "thinking" : "idle"} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        {m.tools.length ? (
          <div>
            <button type="button" className="zp-steps" onClick={() => setOpen(!open)} aria-expanded={open}>
              <Spark size={12} /> Did {m.tools.length} step{m.tools.length === 1 ? "" : "s"}
              <span className={`transition-transform ${open ? "rotate-90" : ""}`}>
                <Icon d={I.chev} size={13} />
              </span>
            </button>
            {open ? (
              <ul className="zp-steps__list">
                {m.tools.map((t, i) => (
                  <li key={i}>
                    <Icon d={I.check} size={13} /> {toolLabel(t)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {m.text ? <Markdown text={m.text} /> : null}
        {m.cards.map((c) => (c.kind === "changeset" ? <ChangeSetCard key={c.id} id={c.id} api={api} canEdit={canEdit} /> : <AuditCard key={c.id} id={c.id} api={api} />))}
        {m.working ? (
          <span className="aw-agent-working text-[13px]" role="status" aria-live="polite">
            {m.working}...
          </span>
        ) : m.text ? (
          <div className="flex gap-1">
            <button
              type="button"
              className="zp-icon-btn zp-icon-btn--sm"
              title={copied ? "Copied" : "Copy"}
              aria-label="Copy"
              onClick={() => {
                navigator.clipboard.writeText(m.text).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              <Icon d={copied ? I.check : I.copy} size={14} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Composer(p: { busy: boolean; canEdit: boolean; skills: Skill[]; onSend: (text: string, skill: Skill | null) => void; onStop: () => void; onKnowledgeFiles: (files: File[]) => void; big?: boolean }) {
  const [text, setText] = useState("");
  const [skill, setSkill] = usePendingSkill();
  const [menu, setMenu] = useState<"" | "main" | "skills">("");
  const box = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = box.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 220)}px`;
  }, [text]);
  useEffect(() => {
    if (skill) box.current?.focus();
  }, [skill]);
  const go = () => {
    if (!text.trim() || p.busy) return;
    p.onSend(text, skill);
    setText("");
    setSkill(null);
  };
  const on = p.skills.filter((s) => s.enabled);
  return (
    <div className={`zp-composer ${p.big ? "zp-composer--big" : ""}`}>
      {skill ? (
        <div className="px-3 pt-2.5">
          <span className="zp-skill-chip">
            <Spark size={11} /> {skill.name}
            <button type="button" aria-label="Remove skill" onClick={() => setSkill(null)}>
              <Icon d={I.x} size={12} />
            </button>
          </span>
        </div>
      ) : null}
      <textarea
        ref={box}
        rows={1}
        value={text}
        placeholder={skill ? `Tell Zippie what to do with ${skill.name}...` : "Ask Zippie to do something..."}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            go();
          }
        }}
        className="zp-input"
      />
      <div className="flex items-center justify-between px-2 pb-2">
        <div className="relative">
          <button type="button" className="zp-icon-btn" aria-label="Add files or use a skill" title="Add files or use a skill" onClick={() => setMenu(menu ? "" : "main")}>
            <Icon d={I.plus} size={18} />
          </button>
          {menu ? (
            <div className="zp-menu" onMouseLeave={() => setMenu("")}>
              {menu === "main" ? (
                <>
                  <button type="button" disabled={!p.canEdit} onClick={() => files.current?.click()} title={p.canEdit ? "" : "Editors and admins can add knowledge"}>
                    <Icon d={I.file} /> Add files to Knowledge
                  </button>
                  <button type="button" onClick={() => setMenu("skills")}>
                    <Icon d={I.bolt} /> Use a skill
                    <span className="ml-auto">
                      <Icon d={I.chev} size={13} />
                    </span>
                  </button>
                </>
              ) : (
                on.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => {
                      setSkill(s);
                      setMenu("");
                    }}
                  >
                    <Spark size={12} className="text-brand" />
                    <span className="flex min-w-0 flex-col text-left">
                      <span className="truncate">{s.name}</span>
                      <span className="truncate text-[11px] text-muted">{s.description}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}
          <input
            ref={files}
            type="file"
            multiple
            accept={FILE_TYPES}
            className="hidden"
            onChange={(e) => {
              const list = [...(e.target.files ?? [])];
              e.target.value = "";
              setMenu("");
              if (list.length) p.onKnowledgeFiles(list);
            }}
          />
        </div>
        {p.busy ? (
          <button type="button" className="zp-send" onClick={p.onStop} aria-label="Stop" title="Stop">
            <Icon d={I.stop} size={14} />
          </button>
        ) : (
          <button type="button" className="zp-send" onClick={go} disabled={!text.trim()} aria-label="Send" title="Send">
            <Icon d={I.up} size={17} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────── Cards in the chat ───────────────

type SetRow = { id: string; title: string; status: string; step: string; error: string | null; cms_connections: { name: string; kind: string } | null };
type Change = { id: number; url: string | null; label: string; field: string; before: Record<string, unknown> | null; after: Record<string, unknown>; note: string; status: string; error: string | null };
const STATUS: Record<string, string> = {
  ready: "aw-status--warn",
  proposed: "aw-status--warn",
  approved: "aw-status--pending",
  applied: "aw-status--ranked",
  undone: "aw-status--pending",
  rejected: "aw-status--pending",
  failed: "aw-status--missed",
  partly: "aw-status--warn",
  preparing: "aw-status--pending",
  applying: "aw-status--pending",
  running: "aw-status--pending",
  done: "aw-status--ranked",
};

/** A change set Zippie prepared: review each change, approve, apply to the site, or undo. */
function ChangeSetCard({ id, api, canEdit }: { id: string; api: ReturnType<typeof useApi>; canEdit: boolean }) {
  const [set, setSet] = useState<SetRow | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await api<{ set: SetRow; changes: Change[] }>("/api/ask/changes", { action: "get", setId: id });
      setSet(r.set);
      setChanges(r.changes);
    } catch (e) {
      setError(msgOf(e));
    }
  }, [api, id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (set?.status !== "preparing" && set?.status !== "applying") return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [set?.status, load]);
  const act = async (body: Record<string, unknown>, ask?: string) => {
    if (ask && !confirm(ask)) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/ask/changes", { ...body, setId: id });
      await load();
    } catch (e) {
      setError(msgOf(e));
    } finally {
      setBusy(false);
    }
  };
  if (!set) return <div className="zp-card text-[13px] text-muted">{error || "Loading changes..."}</div>;
  const working = set.status === "preparing" || set.status === "applying";
  const open = changes.filter((c) => ["proposed", "rejected", "failed"].includes(c.status));
  const approved = changes.filter((c) => c.status === "approved");
  const live = changes.filter((c) => c.status === "applied");
  const shown = all ? changes : changes.slice(0, 3);
  return (
    <div className="zp-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="zp-card__icon">
            <Spark size={13} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium text-ink">{set.title}</p>
            <p className="text-[12px] text-muted">
              {set.cms_connections?.name ?? "CMS"} · <span className={`aw-status ${STATUS[set.status] ?? ""}`}>{set.status}</span> {set.error || set.step}
            </p>
          </div>
        </div>
        {canEdit && !working ? (
          <div className="flex flex-wrap gap-2">
            {open.length ? (
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={busy} onClick={() => act({ action: "review", approve: open.map((c) => c.id) })}>
                Approve all ({open.length})
              </button>
            ) : null}
            {approved.length ? (
              <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" disabled={busy} onClick={() => act({ action: "apply" }, `Make ${approved.length} change${approved.length === 1 ? "" : "s"} live on ${set.cms_connections?.name ?? "your site"}? You can undo them.`)}>
                Apply {approved.length} to the site
              </button>
            ) : null}
            {live.length ? (
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={busy} onClick={() => act({ action: "undo" }, `Put ${live.length} page${live.length === 1 ? "" : "s"} back the way they were?`)}>
                Undo
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {working ? <span className="aw-agent-working text-[13px]">{set.step || "Working"}...</span> : null}
      {error ? <p className="aw-error">{error}</p> : null}
      {shown.length ? (
        <div className="flex flex-col divide-y divide-rule-faint">
          {shown.map((c) => (
            <div key={c.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`aw-status ${STATUS[c.status] ?? ""}`}>{c.status}</span>
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noreferrer" className="truncate text-[13px] font-medium text-ink hover:underline">
                      {c.label || c.url}
                    </a>
                  ) : (
                    <span className="truncate text-[13px] font-medium text-ink">{c.label}</span>
                  )}
                </span>
                {canEdit && !working && !["applied", "undone"].includes(c.status) ? (
                  <span className="flex shrink-0 gap-2">
                    {c.status !== "approved" ? (
                      <button type="button" className="aw-text-link text-[13px]" disabled={busy} onClick={() => act({ action: "review", approve: [c.id] })}>
                        Approve
                      </button>
                    ) : null}
                    {c.status !== "rejected" ? (
                      <button type="button" className="aw-text-link text-[13px] text-muted!" disabled={busy} onClick={() => act({ action: "review", reject: [c.id] })}>
                        Skip
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </div>
              <Diff c={c} />
              {c.error ? <p className="text-[12px] text-[#B3093C]">{c.error}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      {changes.length > 3 ? (
        <button type="button" className="aw-text-link self-start text-[13px]" onClick={() => setAll(!all)}>
          {all ? "Show less" : `Show all ${changes.length} changes`}
        </button>
      ) : null}
    </div>
  );
}

/** What a change does, shown the way it reads on the page. */
function Diff({ c }: { c: Change }) {
  const a = c.after;
  if (c.field === "meta") {
    const b = c.before ?? {};
    return (
      <div className="grid gap-2 text-[13px] sm:grid-cols-2">
        <div className="rounded-lg bg-surface-2 p-3">
          <p className="mb-1 text-[11px] font-medium text-muted uppercase">Now</p>
          <p className="font-medium text-ink">{String(b.title || "No SEO title")}</p>
          <p className="text-body">{String(b.description || "No meta description")}</p>
        </div>
        <div className="rounded-lg bg-brand-pale p-3">
          <p className="mb-1 text-[11px] font-medium text-brand uppercase">Zippie&apos;s version</p>
          <p className="font-medium text-ink">{String(a.title ?? "")}</p>
          <p className="text-body">{String(a.description ?? "")}</p>
        </div>
      </div>
    );
  }
  if (c.field === "alt") {
    return (
      <div className="flex flex-col gap-2 text-[13px]">
        {((a.images as { src: string; alt: string }[]) ?? []).map((img) => (
          <div key={img.src} className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.src} alt="" className="h-12 w-16 shrink-0 rounded-md object-cover" loading="lazy" />
            <span className="text-body">“{img.alt}”</span>
          </div>
        ))}
      </div>
    );
  }
  if (c.field === "faq") {
    return (
      <div className="flex flex-col gap-2 text-[13px]">
        {((a.items as { q: string; a: string }[]) ?? []).map((f) => (
          <div key={f.q}>
            <p className="font-medium text-ink">{f.q}</p>
            <p className="text-body">{f.a}</p>
          </div>
        ))}
      </div>
    );
  }
  if (c.field === "links") {
    return (
      <ul className="flex flex-col gap-1 text-[13px]">
        {((a.links as { anchor: string; url: string }[]) ?? []).map((l) => (
          <li key={l.url + l.anchor} className="text-body">
            “{l.anchor}” → <span className="text-ink">{l.url}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (c.field === "schema") {
    let pretty = String(a.json ?? "");
    try {
      pretty = JSON.stringify(JSON.parse(pretty), null, 2);
    } catch {}
    return (
      <details className="text-[13px]">
        <summary className="cursor-pointer text-body">{c.note || "Structured data"}</summary>
        <pre className="aw-md-code mt-2 max-h-72">{pretty}</pre>
      </details>
    );
  }
  return <p className="text-[13px] text-body">{c.note}</p>;
}

type Audit = { id: string; domain: string; status: "running" | "done" | "failed"; step: string; pages: number; score: number | null; error: string | null; result?: AuditResult };
const SEVERITY = { high: "aw-status--missed", medium: "aw-status--warn", low: "aw-status--pending" } as const;

/** A site audit Zippie started: progress while it runs, then the score and the top issues. */
function AuditCard({ id, api }: { id: string; api: ReturnType<typeof useApi> }) {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [all, setAll] = useState(false);
  const load = useCallback(() => {
    api<{ audit: Audit }>("/api/ask", { action: "audit", auditId: id })
      .then((r) => setAudit(r.audit))
      .catch(() => {});
  }, [api, id]);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (audit && audit.status !== "running") return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [audit, load]);
  if (!audit) return <div className="zp-card text-[13px] text-muted">Loading the audit...</div>;
  const r = audit.result;
  const issues: AuditIssue[] = r?.issues ?? [];
  const score = audit.score ?? 0;
  const tone = score >= 80 ? "#05690D" : score >= 60 ? "#8A4B00" : "#B3093C";
  return (
    <div className="zp-card">
      <div className="flex items-center gap-3">
        {audit.status === "done" ? (
          <div className="zp-score" style={{ background: `conic-gradient(${tone} ${score * 3.6}deg, #E6EAF2 0deg)` }}>
            <span style={{ color: tone }}>{score}</span>
          </div>
        ) : (
          <span className="zp-card__icon">
            <Spark size={13} />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium text-ink">Site audit of {audit.domain}</p>
          <p className="text-[12px] text-muted">
            {audit.status === "running" ? (
              <span className="aw-agent-working">
                {audit.step || "Crawling"}... {audit.pages ? `${audit.pages} pages so far` : ""}
              </span>
            ) : audit.status === "failed" ? (
              `Failed: ${audit.error}`
            ) : (
              `Score ${score} of 100 · ${audit.pages} pages checked · ${issues.length} issue${issues.length === 1 ? "" : "s"}${r?.blockedBots.length ? ` · blocks ${r.blockedBots.join(", ")}` : ""}`
            )}
          </p>
        </div>
      </div>
      {issues.length ? (
        <ul className="flex flex-col gap-1.5">
          {(all ? issues : issues.slice(0, 5)).map((i) => (
            <li key={i.id} className="flex items-center gap-2 text-[13px]">
              <span className={`aw-status ${SEVERITY[i.severity]}`}>{i.severity}</span>
              <span className="min-w-0 flex-1 truncate text-ink" title={i.why}>
                {i.title}
              </span>
              <span className="font-mono text-[12px] text-muted">{i.count}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {issues.length > 5 ? (
        <button type="button" className="aw-text-link self-start text-[13px]" onClick={() => setAll(!all)}>
          {all ? "Show less" : `Show all ${issues.length} issues`}
        </button>
      ) : null}
    </div>
  );
}

// ─────────────── Right panel: chats and projects ───────────────

function ChatsPanel(p: {
  threads: Thread[];
  projects: Project[];
  threadId: string | null;
  projectId: string | null;
  view: View;
  canEdit: boolean;
  counts: { knowledge: number; skills: number };
  onNew: () => void;
  onOpen: (t: Thread) => void;
  onProject: (id: string) => void;
  onNewProject: () => void;
  onView: (v: View) => void;
  onThread: (t: Thread, action: "rename" | "delete" | "move", extra?: Record<string, unknown>) => void;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const loose = p.threads.filter((t) => !t.project_id && (!q || t.title.toLowerCase().includes(q.toLowerCase())));
  const [now] = useState(() => Date.now());
  const groups = useMemo(() => {
    const out: { label: string; items: Thread[] }[] = [];
    const push = (label: string, t: Thread) => {
      const g = out.find((x) => x.label === label);
      if (g) g.items.push(t);
      else out.push({ label, items: [t] });
    };
    for (const t of loose) {
      const days = (now - Date.parse(t.updated_at)) / 86_400_000;
      push(days < 1 ? "Today" : days < 2 ? "Yesterday" : days < 7 ? "Previous 7 days" : days < 30 ? "Previous 30 days" : "Older", t);
    }
    return out;
  }, [loose, now]);

  const row = (t: Thread) => (
    <div key={t.id} className={`zp-row group ${t.id === p.threadId && p.view === "chat" ? "is-on" : ""}`}>
      <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => p.onOpen(t)} title={t.title}>
        {t.title}
      </button>
      <div className="relative">
        <button type="button" className="zp-row__more" aria-label="Chat options" onClick={() => setMenu(menu === t.id ? null : t.id)}>
          <Icon d={I.dots} size={15} />
        </button>
        {menu === t.id ? (
          <div className="zp-menu zp-menu--right" onMouseLeave={() => setMenu(null)}>
            <button
              type="button"
              onClick={() => {
                setMenu(null);
                const title = prompt("Rename chat", t.title);
                if (title?.trim()) p.onThread(t, "rename", { title });
              }}
            >
              <Icon d={I.edit} /> Rename
            </button>
            {p.projects.length ? <p className="zp-menu__label">Move to project</p> : null}
            {p.projects.map((pr) => (
              <button
                key={pr.id}
                type="button"
                disabled={t.project_id === pr.id}
                onClick={() => {
                  setMenu(null);
                  p.onThread(t, "move", { projectId: pr.id });
                }}
              >
                <Icon d={I.folder} /> {pr.name}
              </button>
            ))}
            {t.project_id ? (
              <button
                type="button"
                onClick={() => {
                  setMenu(null);
                  p.onThread(t, "move", { projectId: null });
                }}
              >
                <Icon d={I.x} /> Remove from project
              </button>
            ) : null}
            <button
              type="button"
              className="text-[#B3093C]!"
              onClick={() => {
                setMenu(null);
                if (confirm("Delete this chat?")) p.onThread(t, "delete");
              }}
            >
              <Icon d={I.x} /> Delete
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <aside className="zp-side">
      <button type="button" className="zp-new" onClick={p.onNew}>
        <Icon d={I.edit} /> New chat
      </button>
      <div className="flex flex-col gap-0.5">
        <button type="button" className={`zp-row ${p.view === "knowledge" ? "is-on" : ""}`} onClick={() => p.onView("knowledge")}>
          <Icon d={I.book} /> <span className="flex-1 text-left">Knowledge</span>
          <span className="zp-count">{p.counts.knowledge}</span>
        </button>
        <button type="button" className={`zp-row ${p.view === "skills" ? "is-on" : ""}`} onClick={() => p.onView("skills")}>
          <Icon d={I.bolt} /> <span className="flex-1 text-left">Skills</span>
          <span className="zp-count">{p.counts.skills}</span>
        </button>
      </div>

      <div className="flex flex-col gap-0.5">
        <div className="zp-label">
          Projects
          {p.canEdit ? (
            <button type="button" className="zp-icon-btn zp-icon-btn--sm" onClick={p.onNewProject} aria-label="New project" title="New project">
              <Icon d={I.plus} size={14} />
            </button>
          ) : null}
        </div>
        {!p.projects.length ? <p className="px-2 text-[12px] text-muted">Group chats into a project, and Zippie learns from all of them.</p> : null}
        {p.projects.map((pr) => {
          const inside = p.threads.filter((t) => t.project_id === pr.id);
          const on = p.projectId === pr.id;
          return (
            <div key={pr.id} className="flex flex-col gap-0.5">
              <button type="button" className={`zp-row ${on && p.view === "project" ? "is-on" : ""}`} onClick={() => p.onProject(pr.id)}>
                <Icon d={I.folder} /> <span className="flex-1 truncate text-left">{pr.name}</span>
                <span className="zp-count">{inside.length}</span>
              </button>
              {on ? <div className="ml-4 flex flex-col gap-0.5 border-l border-rule-faint pl-2">{inside.slice(0, 8).map(row)}</div> : null}
            </div>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5">
        <input className="zp-search" placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {!loose.length ? <p className="px-2 py-1 text-[12px] text-muted">{q ? "No chats match." : "Your chats show up here."}</p> : null}
          {groups.map((g) => (
            <div key={g.label} className="flex flex-col gap-0.5">
              <p className="zp-label">{g.label}</p>
              {g.items.map(row)}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

// ─────────────── Project ───────────────

function ProjectView(p: {
  api: ReturnType<typeof useApi>;
  project: Project;
  threads: Thread[];
  knowledge: Knowledge[];
  canEdit: boolean;
  skills: Skill[];
  busy: boolean;
  onOpen: (t: Thread) => void;
  onSend: (text: string, skill: Skill | null) => void;
  onChange: () => void;
  onDeleted: () => void;
  onKnowledge: () => void;
  onFiles: (files: File[]) => void;
}) {
  const [instructions, setInstructions] = useState(p.project.instructions);
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState("");
  const save = async () => {
    try {
      await p.api("/api/ask/library", { action: "project_save", id: p.project.id, name: p.project.name, instructions });
      setSaved(true);
      p.onChange();
    } catch (e) {
      setError(msgOf(e));
    }
  };
  return (
    <div className="zp-scroll">
      <div className="zp-page">
        <div className="flex items-center justify-between gap-3">
          <h1 className="zp-title">
            <Icon d={I.folder} size={22} /> {p.project.name}
          </h1>
          {p.canEdit ? (
            <div className="flex gap-2">
              <button
                type="button"
                className="aw-btn aw-btn--secondary aw-btn--sm"
                onClick={async () => {
                  const name = prompt("Rename project", p.project.name);
                  if (!name?.trim()) return;
                  await p.api("/api/ask/library", { action: "project_save", id: p.project.id, name, instructions }).catch((e) => setError(msgOf(e)));
                  p.onChange();
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="aw-btn aw-btn--secondary aw-btn--sm"
                onClick={async () => {
                  if (!confirm(`Delete ${p.project.name}? Its chats stay, outside the project. Its knowledge is deleted.`)) return;
                  await p.api("/api/ask/library", { action: "project_delete", id: p.project.id }).catch((e) => setError(msgOf(e)));
                  p.onDeleted();
                }}
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
        <Composer busy={p.busy} canEdit={p.canEdit} skills={p.skills} onSend={p.onSend} onStop={() => {}} onKnowledgeFiles={p.onFiles} big />
        {error ? <div className="aw-error">{error}</div> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="zp-box">
            <p className="text-[14px] font-medium text-ink">Instructions</p>
            <p className="text-[12px] text-muted">Zippie follows these in every chat in this project.</p>
            <textarea
              className="aw-textarea min-h-28 text-[14px]"
              value={instructions}
              disabled={!p.canEdit}
              placeholder="Example: This is for our UK store. Write in British English and focus on the summer launch."
              onChange={(e) => {
                setInstructions(e.target.value);
                setSaved(false);
              }}
            />
            {p.canEdit ? (
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm self-start" onClick={save} disabled={saved}>
                {saved ? "Saved" : "Save"}
              </button>
            ) : null}
          </div>
          <div className="zp-box">
            <p className="text-[14px] font-medium text-ink">Project knowledge</p>
            <p className="text-[12px] text-muted">Files, pages and notes only this project uses. Workspace knowledge applies too.</p>
            {p.knowledge.length ? (
              <ul className="flex flex-col gap-1 text-[13px]">
                {p.knowledge.slice(0, 6).map((k) => (
                  <li key={k.id} className="flex items-center gap-2 truncate text-body">
                    <Icon d={k.kind === "url" ? I.link : k.kind === "note" ? I.note : I.file} size={14} /> {k.name}
                  </li>
                ))}
              </ul>
            ) : null}
            <button type="button" className="aw-text-link self-start text-[13px]" onClick={p.onKnowledge}>
              {p.knowledge.length ? "Manage knowledge" : "Add knowledge"} →
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <p className="zp-label">Chats in this project</p>
          {!p.threads.length ? <p className="text-[13px] text-muted">No chats yet. Start one above. Zippie remembers what you worked on in each chat here.</p> : null}
          {p.threads.map((t) => (
            <button key={t.id} type="button" className="zp-thread-row" onClick={() => p.onOpen(t)}>
              <Icon d={I.chat} size={15} />
              <span className="flex-1 truncate text-left">{t.title}</span>
              <span className="text-[12px] text-muted">{new Date(t.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────── Knowledge ───────────────

function KnowledgeView(p: { api: ReturnType<typeof useApi>; lib: Library; canEdit: boolean; onChange: () => void; scope: string | null }) {
  const [scope, setScope] = useState<string>(p.scope ?? "");
  const [mode, setMode] = useState<"" | "url" | "note">("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState({ name: "", content: "" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const files = useRef<HTMLInputElement>(null);
  const add = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    setError("");
    try {
      await p.api("/api/ask/library", { action: "knowledge_add", projectId: scope || null, ...body });
      p.onChange();
      return true;
    } catch (e) {
      setError(msgOf(e));
      return false;
    } finally {
      setBusy("");
    }
  };
  const projectName = (id: string | null) => p.lib.projects.find((x) => x.id === id)?.name;
  return (
    <div className="zp-scroll">
      <div className="zp-page">
        <div>
          <h1 className="zp-title">
            <Icon d={I.book} size={22} /> Knowledge
          </h1>
          <p className="mt-1 text-[14px] text-muted">Teach Zippie about your business: brand guides, product docs, pricing, sales notes, past posts. He reads these before he answers.</p>
        </div>
        {p.canEdit ? (
          <div className="zp-box">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" disabled={Boolean(busy)} onClick={() => files.current?.click()}>
                <Icon d={I.file} size={14} /> Upload files
              </button>
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setMode(mode === "url" ? "" : "url")}>
                <Icon d={I.link} size={14} /> Add a web page
              </button>
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setMode(mode === "note" ? "" : "note")}>
                <Icon d={I.note} size={14} /> Write a note
              </button>
              <label className="ml-auto flex items-center gap-2 text-[13px] text-muted">
                For
                <select className="aw-select py-1! text-[13px]!" value={scope} onChange={(e) => setScope(e.target.value)}>
                  <option value="">Whole workspace</option>
                  {p.lib.projects.map((x) => (
                    <option key={x.id} value={x.id}>
                      Project: {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <input
                ref={files}
                type="file"
                multiple
                accept={FILE_TYPES}
                className="hidden"
                onChange={async (e) => {
                  const list = [...(e.target.files ?? [])];
                  e.target.value = "";
                  for (const f of list) {
                    try {
                      await add({ kind: "file", ...(await readFile(f)) }, `Reading ${f.name}`);
                    } catch (err) {
                      setError(msgOf(err));
                    }
                  }
                }}
              />
            </div>
            <p className="text-[12px] text-muted">PDF, text, Markdown, CSV, JSON or HTML, up to 10 MB each.</p>
            {mode === "url" ? (
              <form
                className="flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await add({ kind: "url", url }, "Reading the page")) {
                    setUrl("");
                    setMode("");
                  }
                }}
              >
                <input className="aw-input flex-1" placeholder="https://example.com/pricing" value={url} onChange={(e) => setUrl(e.target.value)} />
                <button type="submit" className="aw-btn aw-btn--primary aw-btn--sm" disabled={!url.trim() || Boolean(busy)}>
                  Add
                </button>
              </form>
            ) : null}
            {mode === "note" ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await add({ kind: "note", ...note }, "Saving")) {
                    setNote({ name: "", content: "" });
                    setMode("");
                  }
                }}
              >
                <input className="aw-input" placeholder="Title, like Brand voice" value={note.name} onChange={(e) => setNote({ ...note, name: e.target.value })} />
                <textarea className="aw-textarea min-h-32 text-[14px]" placeholder="What should Zippie know?" value={note.content} onChange={(e) => setNote({ ...note, content: e.target.value })} />
                <button type="submit" className="aw-btn aw-btn--primary aw-btn--sm self-start" disabled={!note.content.trim() || Boolean(busy)}>
                  Save note
                </button>
              </form>
            ) : null}
            {busy ? <span className="aw-agent-working text-[13px]">{busy}...</span> : null}
            {error ? <p className="aw-error">{error}</p> : null}
          </div>
        ) : (
          <p className="text-[13px] text-muted">Editors and admins can add knowledge.</p>
        )}
        <div className="flex flex-col gap-1">
          {!p.lib.knowledge.length ? <div className="aw-callout">Nothing here yet. Upload a brand guide or a product doc to start.</div> : null}
          {p.lib.knowledge.map((k) => (
            <div key={k.id} className="zp-thread-row">
              <Icon d={k.kind === "url" ? I.link : k.kind === "note" ? I.note : I.file} size={15} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-ink">{k.name}</span>
                <span className="truncate text-[12px] text-muted">
                  {k.project_id ? `Project: ${projectName(k.project_id) ?? "–"}` : "Whole workspace"} · {Math.max(1, Math.round(k.chars / 1000))}k characters{k.kind === "url" ? ` · ${k.source}` : ""}
                </span>
              </span>
              {p.canEdit ? (
                <button
                  type="button"
                  className="zp-icon-btn zp-icon-btn--sm"
                  aria-label={`Delete ${k.name}`}
                  onClick={async () => {
                    if (!confirm(`Delete ${k.name}?`)) return;
                    await p.api("/api/ask/library", { action: "knowledge_delete", id: k.id }).catch((e) => setError(msgOf(e)));
                    p.onChange();
                  }}
                >
                  <Icon d={I.x} size={14} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────── Skills ───────────────

function SkillsView(p: { api: ReturnType<typeof useApi>; lib: Library; canEdit: boolean; onChange: (skills: Skill[]) => void; onUse: (s: Skill) => void }) {
  const [edit, setEdit] = useState<Partial<Skill> | null>(null);
  const [error, setError] = useState("");
  const call = async (body: Record<string, unknown>) => {
    setError("");
    try {
      const r = await p.api<{ skills: Skill[] }>("/api/ask/library", body);
      p.onChange(r.skills);
      return true;
    } catch (e) {
      setError(msgOf(e));
      return false;
    }
  };
  return (
    <div className="zp-scroll">
      <div className="zp-page">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="zp-title">
              <Icon d={I.bolt} size={22} /> Skills
            </h1>
            <p className="mt-1 text-[14px] text-muted">Teach Zippie how to do a kind of task. He picks the right skill on his own, or you pick one with + in the chat.</p>
          </div>
          {p.canEdit ? (
            <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={() => setEdit({ name: "", description: "", instructions: "" })}>
              <Icon d={I.plus} size={14} /> New skill
            </button>
          ) : null}
        </div>
        {error ? <p className="aw-error">{error}</p> : null}
        {edit ? (
          <form
            className="zp-box"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await call({ action: "skill_save", id: edit.builtin ? undefined : edit.key, name: edit.name, description: edit.description, instructions: edit.instructions })) setEdit(null);
            }}
          >
            <p className="text-[14px] font-medium text-ink">{edit.key ? "Edit skill" : "New skill"}</p>
            <input className="aw-input" placeholder="Name, like Product launch post" value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <input className="aw-input" placeholder="When to use it, in one line" value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            <textarea
              className="aw-textarea min-h-40 text-[14px]"
              placeholder={"Step by step, how Zippie should do it.\nExample: 1. Read the Content Plan. 2. Pick the 3 topics with the most volume. 3. Write a 5-line outline for each."}
              value={edit.instructions ?? ""}
              onChange={(e) => setEdit({ ...edit, instructions: e.target.value })}
            />
            <div className="flex gap-2">
              <button type="submit" className="aw-btn aw-btn--primary aw-btn--sm" disabled={!edit.name?.trim() || !edit.instructions?.trim()}>
                Save skill
              </button>
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setEdit(null)}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {p.lib.skills.map((s) => (
            <div key={s.key} className={`zp-skill ${s.enabled ? "" : "is-off"}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="zp-card__icon">
                  <Spark size={13} />
                </span>
                {p.canEdit ? (
                  <label className="zp-switch" title={s.enabled ? "Turn off" : "Turn on"}>
                    <input type="checkbox" checked={s.enabled} onChange={(e) => call({ action: "skill_toggle", key: s.key, enabled: e.target.checked })} />
                    <span />
                  </label>
                ) : null}
              </div>
              <p className="text-[14px] font-medium text-ink">{s.name}</p>
              <p className="flex-1 text-[13px] text-body">{s.description}</p>
              <div className="flex items-center gap-3">
                <span className="aw-chip">{s.builtin ? "Built in" : "Yours"}</span>
                <button type="button" className="aw-text-link text-[13px]" disabled={!s.enabled} onClick={() => p.onUse(s)}>
                  Use
                </button>
                {p.canEdit && !s.builtin ? (
                  <>
                    <button type="button" className="aw-text-link text-[13px]" onClick={() => setEdit(s)}>
                      Edit
                    </button>
                    <button type="button" className="aw-text-link text-[13px] text-muted!" onClick={() => confirm(`Delete ${s.name}?`) && call({ action: "skill_delete", id: s.key })}>
                      Delete
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
