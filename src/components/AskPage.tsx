"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditIssue, AuditResult } from "@/lib/audit";
import type { RunAuth } from "@/lib/runner";
import { Markdown } from "./Markdown";
import { MrAgent } from "./MrAgent";
import { Card, Empty, Seg, Thinking } from "./ui";

type Tab = "chat" | "audit" | "changes";
type Thread = { id: string; title: string; updated_at: string };
type Msg = { id: number | string; role: "user" | "assistant"; text: string; tools: string[]; working?: string };
type Audit = { id: string; domain: string; status: "running" | "done" | "failed"; step: string; pages: number; score: number | null; error: string | null; created_at: string; result?: AuditResult };
type SetRow = {
  id: string;
  title: string;
  play: string;
  status: string;
  step: string;
  error: string | null;
  created_at: string;
  applied_at: string | null;
  cms_connections: { name: string; kind: string } | null;
};
type Change = {
  id: number;
  url: string | null;
  label: string;
  field: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  note: string;
  status: string;
  error: string | null;
};

const STARTERS = [
  "How visible is my brand in AI answers this month, and what should I fix first?",
  "Audit my website for SEO and AI readiness.",
  "Which pages on my site are missing meta descriptions? Write them.",
  "Add FAQ sections to my top blog posts, based on what buyers ask AI.",
];
const TOOL_LABEL: Record<string, string> = {
  start_site_audit: "Started a site audit",
  get_site_audit: "Read the site audit",
  list_cms_connections: "Checked your CMS",
  get_site_content: "Read your posts and pages",
  propose_changes: "Prepared changes",
  get_change_set: "Checked a change set",
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
const STATUS_CLASS: Record<string, string> = {
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
const SEVERITY_CLASS = { high: "aw-status--missed", medium: "aw-status--warn", low: "aw-status--pending" } as const;
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const toolLabel = (n: string) => TOOL_LABEL[n] ?? n.replace(/^get_/, "Read ").replace(/_/g, " ");

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

/** Mr. Agent: chat with your data, audit your site, and review changes before they go live. */
export function AskPage({ auth, canEdit, domain }: { auth: RunAuth; canEdit: boolean; domain: string }) {
  const [tab, setTab] = useState<Tab>("chat");
  const [focusSet, setFocusSet] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <MrAgent size={44} />
          <div>
            <h1 className="aw-h2">Mr. Agent</h1>
            <p className="mt-1 text-[14px] text-muted">Your AI agent for SEO and AI visibility. He audits your site and prepares fixes. Nothing goes live until you approve it.</p>
          </div>
        </div>
        <Seg
          label="Mr. Agent"
          value={tab}
          onChange={setTab}
          options={[
            { id: "chat", label: "Chat" },
            { id: "audit", label: "Site audit" },
            { id: "changes", label: "Changes" },
          ]}
        />
      </div>
      {tab === "chat" ? (
        <Chat
          auth={auth}
          onOpen={(t, id) => {
            setTab(t);
            if (id) setFocusSet(id);
          }}
        />
      ) : tab === "audit" ? (
        <AuditTab auth={auth} canEdit={canEdit} domain={domain} />
      ) : (
        <ChangesTab auth={auth} canEdit={canEdit} focus={focusSet} />
      )}
    </div>
  );
}

// ─────────────── Chat ───────────────

function Chat({ auth, onOpen }: { auth: RunAuth; onOpen: (tab: Tab, id?: string) => void }) {
  const api = useApi(auth);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [setup, setSetup] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [links, setLinks] = useState<{ sets: { id: string; title: string }[]; audit: boolean }>({ sets: [], audit: false });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(() => {
    api<{ threads: Thread[]; setup?: string }>("/api/ask", { action: "threads" })
      .then((r) => {
        setThreads(r.threads);
        setSetup(r.setup ?? "");
      })
      .catch((e) => setError(e.message));
  }, [api]);
  useEffect(loadThreads, [loadThreads]);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages]);

  const open = async (id: string) => {
    setThreadId(id);
    setError("");
    try {
      const r = await api<{ messages: Msg[]; changeSets: { id: string; title: string }[] }>("/api/ask", { action: "thread", threadId: id });
      setMessages(r.messages);
      setLinks({ sets: r.changeSets, audit: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setError("");
    setBusy(true);
    const mine: Msg = { id: `u${Date.now()}`, role: "user", text: message, tools: [] };
    const reply: Msg = { id: `a${Date.now()}`, role: "assistant", text: "", tools: [], working: "Thinking" };
    setMessages((m) => [...m, mine, reply]);
    const patch = (f: (m: Msg) => Msg) => setMessages((all) => all.map((m) => (m.id === reply.id ? f(m) : m)));
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` },
        body: JSON.stringify({ action: "send", workspaceId: auth.workspaceId, threadId, message }),
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
            setThreads((t) => (t.some((x) => x.id === e.id) ? t : [{ id: e.id, title: e.title, updated_at: new Date().toISOString() }, ...t]));
          } else if (e.type === "text") patch((m) => ({ ...m, text: m.text + e.text, working: undefined }));
          else if (e.type === "tool") patch((m) => ({ ...m, working: e.label, text: m.text && !m.text.endsWith("\n\n") ? m.text + "\n\n" : m.text }));
          else if (e.type === "tool_done") patch((m) => ({ ...m, tools: [...m.tools, e.name], working: "Thinking" }));
          else if (e.type === "changeset") setLinks((l) => ({ ...l, sets: [...l.sets, { id: e.id, title: e.title }] }));
          else if (e.type === "audit") setLinks((l) => ({ ...l, audit: true }));
          else if (e.type === "error") setError(e.error);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      patch((m) => ({ ...m, working: undefined }));
      setBusy(false);
      loadThreads();
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this chat?")) return;
    try {
      await api("/api/ask", { action: "delete", threadId: id });
      setThreads((t) => t.filter((x) => x.id !== id));
      if (threadId === id) {
        setThreadId(null);
        setMessages([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (setup) return <Empty>{setup}</Empty>;
  return (
    <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
      <aside className="flex flex-col gap-1">
        <button
          type="button"
          className="aw-btn aw-btn--secondary aw-btn--sm mb-2 self-start"
          onClick={() => {
            setThreadId(null);
            setMessages([]);
            setLinks({ sets: [], audit: false });
          }}
        >
          + New chat
        </button>
        {threads.map((t) => (
          <div key={t.id} className={`group flex items-center gap-1 rounded-aw px-2 py-1.5 text-[13px] ${t.id === threadId ? "bg-surface-2 font-medium text-ink" : "text-body hover:bg-surface-2"}`}>
            <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => open(t.id)} title={t.title}>
              {t.title}
            </button>
            <button type="button" aria-label="Delete chat" className="text-muted opacity-0 group-hover:opacity-100" onClick={() => remove(t.id)}>
              ×
            </button>
          </div>
        ))}
      </aside>

      <section className="flex min-h-[60vh] flex-col gap-4">
        {!messages.length ? (
          <div className="flex flex-col gap-4 py-6">
            <div className="flex flex-col items-center gap-3 pb-2 text-center">
              <MrAgent size={112} mood="happy" />
              <p className="aw-h3">Hi, I&apos;m Mr. Agent. What should we work on?</p>
              <p className="max-w-md text-[14px] text-muted">I can read your Arrowsterr data, audit your website, and prepare fixes for your CMS. You approve every change.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {STARTERS.map((s) => (
                <button key={s} type="button" className="aw-frame px-4 py-3 text-left text-[14px] text-body hover:text-ink" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="ml-auto max-w-[80%] rounded-aw bg-brand-pale px-4 py-2.5 text-[14px] whitespace-pre-wrap text-ink">
                  {m.text}
                </div>
              ) : (
                <div key={m.id} className="flex max-w-[90%] gap-3">
                  <MrAgent size={32} mood={m.working ? "thinking" : "idle"} className="mt-0.5" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    {m.tools.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {m.tools.map((t, i) => (
                          <span key={i} className="aw-chip">
                            ✓ {toolLabel(t)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {m.text ? (
                      <div className="text-[14px] leading-relaxed">
                        <Markdown text={m.text} />
                      </div>
                    ) : null}
                    {m.working ? (
                      <span className="aw-agent-working text-[13px] text-muted" role="status" aria-live="polite">
                        {m.working}...
                      </span>
                    ) : null}
                  </div>
                </div>
              ),
            )}
            {links.sets.length || links.audit ? (
              <div className="flex flex-wrap gap-2">
                {links.audit ? (
                  <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => onOpen("audit")}>
                    Open the site audit →
                  </button>
                ) : null}
                {links.sets.map((s) => (
                  <button key={s.id} type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={() => onOpen("changes", s.id)}>
                    Review: {s.title} →
                  </button>
                ))}
              </div>
            ) : null}
            <div ref={end} />
          </div>
        )}
        {error ? <div className="aw-error">{error}</div> : null}
        <form
          className="sticky bottom-0 mt-auto flex items-end gap-2 pt-2 pb-1"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            className="aw-textarea min-h-[44px] flex-1 resize-y"
            rows={2}
            value={input}
            placeholder="Ask about your visibility, your site, or what to fix..."
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          <button type="submit" className="aw-btn aw-btn--primary" disabled={busy || !input.trim()}>
            {busy ? "Working..." : "Send"}
          </button>
        </form>
      </section>
    </div>
  );
}

// ─────────────── Site audit ───────────────

function AuditTab({ auth, canEdit, domain }: { auth: RunAuth; canEdit: boolean; domain: string }) {
  const api = useApi(auth);
  const [audits, setAudits] = useState<Audit[] | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [site, setSite] = useState(domain);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [setup, setSetup] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<{ audits: Audit[]; setup?: string }>("/api/ask", { action: "audits" });
      setAudits(r.audits);
      setSetup(r.setup ?? "");
      const latest = r.audits[0];
      if (latest?.status === "done") setAudit((await api<{ audit: Audit }>("/api/ask", { action: "audit", auditId: latest.id })).audit);
      else setAudit(latest ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  // Watch a running audit.
  useEffect(() => {
    if (audit?.status !== "running") return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [audit?.status, load]);

  const start = async () => {
    setError("");
    try {
      await api("/api/ask", { action: "audit_start", domain: site });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (setup) return <Empty>{setup}</Empty>;
  if (!audits) return <Thinking text="Loading..." />;
  const r = audit?.result;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <input className="aw-input max-w-xs! flex-1" value={site} onChange={(e) => setSite(e.target.value)} placeholder="example.com" disabled={!canEdit} />
        <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={start} disabled={!canEdit || audit?.status === "running"}>
          {audit?.status === "running" ? "Auditing..." : audits.length ? "Run a new audit" : "Audit my site"}
        </button>
        {!canEdit ? <span className="text-[13px] text-muted">Editors and admins can run audits.</span> : null}
      </div>
      {error ? <div className="aw-error">{error}</div> : null}
      {!audit ? (
        <Empty>
          No audit yet. Arrowsterr crawls up to 200 pages and checks what hurts you in Google and AI answers: blocked AI crawlers, missing titles, descriptions, alt text and structured data, broken
          links, slow and thin pages.
        </Empty>
      ) : audit.status === "running" ? (
        <Thinking text={`${audit.step || "Crawling"}... ${audit.pages ? `${audit.pages} pages so far` : ""}`} />
      ) : audit.status === "failed" ? (
        <div className="aw-error">
          The audit of {audit.domain} failed: {audit.error}
        </div>
      ) : r ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Score" value={`${audit.score ?? "–"}`} sub="out of 100" />
            <Stat label="Pages checked" value={`${audit.pages}`} sub={`${r.found} found`} />
            <Stat label="AI crawlers blocked" value={`${r.blockedBots.length}`} sub={r.blockedBots.join(", ") || "None"} />
            <Stat label="llms.txt" value={r.llmsTxt ? "Yes" : "No"} sub={`Checked ${when(audit.created_at)}`} />
          </div>
          <Card title={`Issues on ${audit.domain}`}>
            {!r.issues.length ? (
              <p className="px-5 py-4 text-[14px] text-body">No issues found. Nice work.</p>
            ) : (
              <div className="flex flex-col divide-y divide-rule-faint px-5">
                {r.issues.map((i: AuditIssue) => (
                  <div key={i.id} className="py-3">
                    <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setOpen(open === i.id ? null : i.id)} aria-expanded={open === i.id}>
                      <span className={`aw-status ${SEVERITY_CLASS[i.severity]}`}>{i.severity}</span>
                      <span className="flex-1 text-[14px] font-medium text-ink">{i.title}</span>
                      {i.play ? <span className="aw-chip aw-chip--brand">Fixable</span> : null}
                      <span className="font-mono text-[13px] text-muted">{i.count}</span>
                    </button>
                    {open === i.id ? (
                      <div className="mt-2 flex flex-col gap-2 pl-1 text-[13px] text-body">
                        <p>{i.why}</p>
                        {i.play ? <p className="text-muted">Mr. Agent can fix this through your CMS. Try: “Fix the {i.title.toLowerCase()}”.</p> : null}
                        <ul className="flex flex-col gap-1">
                          {i.pages.slice(0, 10).map((p) => (
                            <li key={p} className="truncate">
                              <a href={p} target="_blank" rel="noreferrer" className="aw-text-link">
                                {p}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="aw-kpi flex flex-col gap-1 p-4">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="aw-h2 font-mono">{value}</span>
      <span className="truncate text-[12px] text-muted" title={sub}>
        {sub}
      </span>
    </div>
  );
}

// ─────────────── Changes ───────────────

function ChangesTab({ auth, canEdit, focus }: { auth: RunAuth; canEdit: boolean; focus: string | null }) {
  const api = useApi(auth);
  const [sets, setSets] = useState<SetRow[] | null>(null);
  const [setup, setSetup] = useState("");
  const [openId, setOpenId] = useState<string | null>(focus);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<{ sets: SetRow[]; setup?: string }>("/api/ask/changes", { action: "list" })
      .then((r) => {
        setSets(r.sets);
        setSetup(r.setup ?? "");
      })
      .catch((e) => setError(e.message));
  }, [api]);
  useEffect(load, [load]);

  if (setup) return <Empty>{setup}</Empty>;
  if (!sets) return <Thinking text="Loading..." />;
  if (openId)
    return (
      <SetView
        auth={auth}
        canEdit={canEdit}
        id={openId}
        onBack={() => {
          setOpenId(null);
          load();
        }}
      />
    );
  return (
    <div className="flex flex-col gap-3">
      {error ? <div className="aw-error">{error}</div> : null}
      {!sets.length ? (
        <Empty>No changes yet. Connect WordPress or Ghost in Settings → Publishing, then ask Arrowsterr to fix something, like “Write meta descriptions for my blog posts”.</Empty>
      ) : (
        <div className="aw-table-wrap">
          <table className="aw-table w-full">
            <thead>
              <tr>
                <th className="text-left">Change set</th>
                <th className="text-left">Site</th>
                <th className="text-left">Status</th>
                <th className="text-left">Created</th>
              </tr>
            </thead>
            <tbody>
              {sets.map((s) => (
                <tr key={s.id} className="cursor-pointer" onClick={() => setOpenId(s.id)}>
                  <td className="font-medium text-ink">{s.title}</td>
                  <td>{s.cms_connections?.name ?? "–"}</td>
                  <td>
                    <span className={`aw-status ${STATUS_CLASS[s.status] ?? ""}`}>{s.status}</span> <span className="text-[12px] text-muted">{s.error || s.step}</span>
                  </td>
                  <td className="text-muted">{when(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SetView({ auth, canEdit, id, onBack }: { auth: RunAuth; canEdit: boolean; id: string; onBack: () => void }) {
  const api = useApi(auth);
  const [set, setSet] = useState<SetRow | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ set: SetRow; changes: Change[] }>("/api/ask/changes", { action: "get", setId: id });
      setSet(r.set);
      setChanges(r.changes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api, id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!set) return error ? <div className="aw-error">{error}</div> : <Thinking text="Loading..." />;
  const working = set.status === "preparing" || set.status === "applying";
  const open = changes.filter((c) => ["proposed", "rejected", "failed"].includes(c.status));
  const approved = changes.filter((c) => c.status === "approved");
  const live = changes.filter((c) => c.status === "applied");
  return (
    <div className="flex flex-col gap-4">
      <button type="button" className="aw-text-link self-start" onClick={onBack}>
        ← All changes
      </button>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="aw-h3">{set.title}</h2>
          <p className="text-[13px] text-muted">
            {set.cms_connections?.name ?? "CMS"} · <span className={`aw-status ${STATUS_CLASS[set.status] ?? ""}`}>{set.status}</span> {set.error || set.step}
          </p>
        </div>
        {canEdit && !working ? (
          <div className="flex flex-wrap gap-2">
            {open.length ? (
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={busy} onClick={() => act({ action: "review", approve: open.map((c) => c.id) })}>
                Approve all ({open.length})
              </button>
            ) : null}
            {approved.length ? (
              <button
                type="button"
                className="aw-btn aw-btn--primary aw-btn--sm"
                disabled={busy}
                onClick={() => act({ action: "apply" }, `Make ${approved.length} change${approved.length === 1 ? "" : "s"} live on ${set.cms_connections?.name ?? "your site"}? You can undo them.`)}
              >
                Apply {approved.length} to the site
              </button>
            ) : null}
            {live.length ? (
              <button
                type="button"
                className="aw-btn aw-btn--secondary aw-btn--sm"
                disabled={busy}
                onClick={() => act({ action: "undo" }, `Put ${live.length} page${live.length === 1 ? "" : "s"} back the way they were?`)}
              >
                Undo
              </button>
            ) : null}
            {!live.length ? (
              <button type="button" className="aw-text-link" disabled={busy} onClick={() => act({ action: "discard" }, "Discard this change set?").then(onBack)}>
                Discard
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? <div className="aw-error">{error}</div> : null}
      {working ? <Thinking text={`${set.step || "Working"}...`} /> : null}
      {!working && !changes.length ? <Empty>{set.step || "Nothing to change."}</Empty> : null}
      {changes.map((c) => (
        <Card
          key={c.id}
          title={
            <span className="flex items-center gap-2">
              <span className={`aw-status ${STATUS_CLASS[c.status] ?? ""}`}>{c.status}</span>
              <span className="truncate">{c.label || c.url}</span>
            </span>
          }
          action={
            canEdit && !working && !["applied", "undone"].includes(c.status) ? (
              <span className="flex gap-2">
                {c.status !== "approved" ? (
                  <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={busy} onClick={() => act({ action: "review", approve: [c.id] })}>
                    Approve
                  </button>
                ) : null}
                {c.status !== "rejected" ? (
                  <button type="button" className="aw-text-link" disabled={busy} onClick={() => act({ action: "review", reject: [c.id] })}>
                    Skip
                  </button>
                ) : null}
              </span>
            ) : null
          }
        >
          <div className="flex flex-col gap-2 px-5 py-4 text-[13px]">
            {c.url ? (
              <a href={c.url} target="_blank" rel="noreferrer" className="aw-text-link truncate">
                {c.url}
              </a>
            ) : null}
            <Diff c={c} />
            {c.error ? <p className="text-[#B3093C]">{c.error}</p> : null}
          </div>
        </Card>
      ))}
    </div>
  );
}

/** What the change does, shown the way it reads on the page. */
function Diff({ c }: { c: Change }) {
  const a = c.after;
  if (c.field === "meta") {
    const b = c.before ?? {};
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-aw bg-surface-2 p-3">
          <p className="mb-1 text-[11px] font-medium text-muted uppercase">Now</p>
          <p className="font-medium text-ink">{String(b.title || "No SEO title")}</p>
          <p className="text-body">{String(b.description || "No meta description")}</p>
        </div>
        <div className="rounded-aw bg-brand-pale p-3">
          <p className="mb-1 text-[11px] font-medium text-muted uppercase">Proposed</p>
          <p className="font-medium text-ink">{String(a.title ?? "")}</p>
          <p className="text-body">{String(a.description ?? "")}</p>
        </div>
      </div>
    );
  }
  if (c.field === "alt") {
    return (
      <div className="flex flex-col gap-2">
        {((a.images as { src: string; alt: string }[]) ?? []).map((img) => (
          <div key={img.src} className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.src} alt="" className="h-12 w-16 shrink-0 rounded-aw object-cover" loading="lazy" />
            <span className="text-body">“{img.alt}”</span>
          </div>
        ))}
      </div>
    );
  }
  if (c.field === "faq") {
    return (
      <div className="flex flex-col gap-2">
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
      <ul className="flex flex-col gap-1">
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
      <details>
        <summary className="cursor-pointer text-body">{c.note || "Structured data"}</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-aw bg-surface-2 p-3 font-mono text-[12px]">{pretty}</pre>
      </details>
    );
  }
  return <p className="text-body">{c.note}</p>;
}
