"use client";

import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { loadRuns, type Run } from "@/lib/chats";
import {
  acceptInvite,
  addBrand,
  atLeast,
  createWorkspace,
  deleteBrand,
  listBrands,
  listRuns,
  listWorkspaces,
  saveBrand,
  saveRunChats,
  startRun as startSavedRun,
  topicsOf,
  type Brand,
  type SavedRun,
  type Workspace,
} from "@/lib/db";
import { splitPeriods, type Filter } from "@/lib/metrics";
import type { View } from "@/lib/view";
import { runAll, type RunAuth } from "@/lib/runner";
import { getSupabase, type SupaConfig } from "@/lib/supa";
import { AuthScreen, NewPassword } from "./AuthScreen";
import { BrandLogo } from "./BrandLogo";
import { CompetitorsPage } from "./CompetitorsPage";
import { Logo } from "./Logo";
import { MembersPage } from "./MembersPage";
import { Onboarding, type NewBrand } from "./Onboarding";
import { OverviewPage } from "./OverviewPage";
import { PromptsPage } from "./PromptsPage";
import { ResearchPage, type Tool } from "./research/ResearchPage";
import { SourcesPage } from "./SourcesPage";
import { TrafficPage } from "./TrafficPage";

export type { Brand } from "@/lib/db";
type Page = "overview" | "prompts" | "competitors" | "domains" | "urls" | "traffic" | "keywords" | "agentic" | "calendar" | "members";
const RESEARCH: Page[] = ["keywords", "agentic", "calendar"];

const INVITE_KEY = "arrowsterr.invite";
const LEGACY_BRANDS = "arrowsterr.brands";

function readLocal(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked. Nothing important is lost.
  }
}

/** Sign-in gate. Everything after sign-in lives in Shell. */
export function App({ config }: { config: SupaConfig }) {
  const sb = getSupabase(config);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    // An invite link looks like /?invite=TOKEN. Keep the token until the person is signed in.
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("invite");
    if (invite) {
      writeLocal(INVITE_KEY, invite);
      params.delete("invite");
      window.history.replaceState(null, "", window.location.pathname + (params.size ? `?${params}` : ""));
    }
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, [sb]);

  if (session === undefined) return null;
  if (recovery && session) return <NewPassword sb={sb} onDone={() => setRecovery(false)} />;
  if (!session) return <AuthScreen sb={sb} invited={Boolean(readLocal(INVITE_KEY))} />;
  return <Shell sb={sb} session={session} />;
}

function Shell({ sb, session }: { sb: SupabaseClient; session: Session }) {
  const userId = session.user.id;
  const email = session.user.email ?? "";
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [wsId, setWsId] = useState<string | null>(() => readLocal(`arrowsterr.ws.${userId}`));
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState<Page>("overview");
  const [runs, setRuns] = useState<Record<string, SavedRun[]>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [engines, setEngines] = useState<string[] | null>(null);
  const [notice, setNotice] = useState("");
  const [days, setDays] = useState(30);
  const [model, setModel] = useState("All");
  const [topic, setTopic] = useState("All");
  const [focus, setFocus] = useState<string | null>(null); // competitor to open on the Competitors page
  const [error, setError] = useState("");

  const token = useCallback(async () => (await sb.auth.getSession()).data.session?.access_token ?? "", [sb]);

  // Load workspaces. Accept a pending invite first, and make a workspace for brand-new users.
  const loadWorkspaces = useCallback(async () => {
    try {
      const invite = readLocal(INVITE_KEY);
      if (invite) {
        writeLocal(INVITE_KEY, null);
        try {
          const joined = await acceptInvite(sb, invite);
          setWsId(joined);
          setNotice("You joined the workspace.");
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
      let list = await listWorkspaces(sb, userId);
      if (!list.length) {
        await createWorkspace(sb, `${email.split("@")[0] || "My"}'s workspace`);
        list = await listWorkspaces(sb, userId);
      }
      setWorkspaces(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setWorkspaces([]);
    }
  }, [sb, userId, email]);

  useEffect(() => {
    // Loading from Supabase on first render is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadWorkspaces();
    fetch("/api/engines")
      .then((r) => r.json())
      .then((d) => setEngines(d.engines ?? []))
      .catch(() => setEngines([]));
  }, [loadWorkspaces]);

  const ws = workspaces?.find((w) => w.id === wsId) ?? workspaces?.[0];
  const canEdit = atLeast(ws?.role, "editor");

  // Load brands whenever the workspace changes.
  useEffect(() => {
    if (!ws) return;
    writeLocal(`arrowsterr.ws.${userId}`, ws.id);
    let live = true;
    listBrands(sb, ws.id)
      .then((list) => {
        if (!live) return;
        setBrands(list);
        setActiveId((id) => (list.some((b) => b.id === id) ? id : (list[0]?.id ?? null)));
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [sb, ws, userId]);

  const active = brands?.find((b) => b.id === activeId);

  // Load a brand's run history the first time it is opened.
  useEffect(() => {
    if (!active || runs[active.id]) return;
    listRuns(sb, active.id)
      .then((list) => setRuns((r) => ({ ...r, [active.id]: list })))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [sb, active, runs]);

  async function runBrand(brand: Brand) {
    if (!engines?.length || running || !ws) return;
    setRunning(brand.id);
    setError("");
    setProgress({ done: 0, total: engines.length * brand.prompts.length });
    const past = runs[brand.id] ?? [];
    let runId: string | null = null;
    let saving = Promise.resolve();
    try {
      runId = await startSavedRun(sb, ws.id, brand.id, userId, { at: new Date().toISOString(), engines, chats: [] });
    } catch (e) {
      setError(`Could not save this run: ${e instanceof Error ? e.message : String(e)}`);
    }
    const finished = await runAll(brand, engines, { workspaceId: ws.id, token }, (run, done, total) => {
      setRuns((r) => ({ ...r, [brand.id]: [...past, { ...run, id: runId ?? "live" }] }));
      setProgress({ done, total });
      // Save every 5 chats so a closed tab keeps most of the run.
      if (runId && done % 5 === 0) saving = saving.then(() => saveRunChats(sb, runId!, run.chats)).catch(() => {});
    });
    await saving;
    if (runId) {
      try {
        await saveRunChats(sb, runId, finished.chats);
      } catch (e) {
        setError(`Could not save this run: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const { limited, ...done } = finished;
    if (limited) setError("Daily limit reached. This workspace used all its AI answers for today, so the run stopped early. It resets at midnight UTC.");
    setRuns((r) => ({ ...r, [brand.id]: [...past, { ...done, id: runId ?? "unsaved" }] }));
    setRunning(null);
  }

  async function onboard(s: NewBrand) {
    if (!ws) return;
    const brand = await addBrand(sb, { ...s, workspace_id: ws.id });
    setBrands((list) => [...(list ?? []), brand]);
    setRuns((r) => ({ ...r, [brand.id]: [] }));
    setActiveId(brand.id);
    setPage("overview");
    setAdding(false);
    // The first check runs right away. After that the daily job keeps it fresh.
    void runBrand(brand);
  }

  async function update(brand: Brand) {
    const before = brands?.find((b) => b.id === brand.id);
    setBrands((list) => list?.map((b) => (b.id === brand.id ? brand : b)) ?? null);
    try {
      await saveBrand(sb, brand);
    } catch (e) {
      // Put the brand back the way it was, like when a limit blocks the change.
      if (before) setBrands((list) => list?.map((b) => (b.id === brand.id ? before : b)) ?? null);
      setError(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function remove(id: string) {
    try {
      await deleteBrand(sb, id);
      const next = (brands ?? []).filter((b) => b.id !== id);
      setBrands(next);
      setActiveId(next[0]?.id ?? null);
    } catch (e) {
      setError(`Could not remove: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Brands and runs saved in this browser before accounts existed.
  async function importLocal() {
    if (!ws) return;
    try {
      const old = JSON.parse(readLocal(LEGACY_BRANDS) || "[]") as { id: string; url: string; domain: string; name: string; logo: string; category?: string; prompts?: string[] }[];
      for (const b of old) {
        const saved = await addBrand(sb, {
          workspace_id: ws.id,
          url: b.url,
          domain: b.domain,
          name: b.name,
          logo: b.logo,
          category: b.category ?? "",
          prompts: b.prompts ?? [],
        });
        for (const run of loadRuns(b.id) as Run[]) {
          const id = await startSavedRun(sb, ws.id, saved.id, userId, run);
          await saveRunChats(sb, id, run.chats);
        }
      }
      writeLocal(LEGACY_BRANDS, null);
      setNotice(`Imported ${old.length} brands from this browser.`);
      setRuns({});
      setBrands(await listBrands(sb, ws.id));
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const legacyCount = (() => {
    try {
      return (JSON.parse(readLocal(LEGACY_BRANDS) || "[]") as unknown[]).length;
    } catch {
      return 0;
    }
  })();

  if (!workspaces || !ws || brands === null) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        {error ? <p className="aw-error max-w-lg">{error}</p> : <p className="aw-small">Loading your workspace...</p>}
      </main>
    );
  }

  const auth: RunAuth = { workspaceId: ws.id, token };
  if (canEdit && (adding || !brands.length)) {
    return (
      <Onboarding
        auth={auth}
        onDone={onboard}
        onCancel={brands.length ? () => setAdding(false) : undefined}
        importCount={!brands.length ? legacyCount : 0}
        onImport={importLocal}
      />
    );
  }

  // Filters from the top bar, applied to every results page.
  const brandRuns = active ? (runs[active.id] ?? []) : [];
  const allTopics = active ? topicsOf(active) : [];
  const topicList = topic === "All" ? allTopics : allTopics.filter((t) => t.name === topic);
  const topicPrompts = new Set(topicList.flatMap((t) => t.prompts));
  const runEngines = [...new Set(brandRuns.flatMap((r) => r.chats.map((c) => c.engine)))];
  const modelList = [...new Set([...(engines ?? []), ...runEngines])];
  const filter: Filter = (c) => (model === "All" || c.engine === model) && (topic === "All" || topicPrompts.has(c.prompt));
  const { current, previous } = splitPeriods(brandRuns, days);
  const view: View | null = active
    ? { brand: active, current, previous, filter, topics: topicList, engines: model === "All" ? modelList : [model], days }
    : null;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar
        sb={sb}
        email={email}
        workspaces={workspaces}
        ws={ws}
        onWorkspace={(id) => {
          setWsId(id);
          setBrands(null);
          setTopic("All");
          setPage("overview");
        }}
        onNewWorkspace={async (name) => {
          const id = await createWorkspace(sb, name);
          await loadWorkspaces();
          setWsId(id);
          setBrands(null);
        }}
        page={page}
        onPage={(p) => {
          setFocus(null);
          setPage(p);
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {page !== "members" && !RESEARCH.includes(page) ? (
          <TopBar
            brands={brands}
            active={active}
            canEdit={canEdit}
            onSwitch={(id) => {
              setActiveId(id);
              setTopic("All");
            }}
            onAdd={() => setAdding(true)}
            days={days}
            onDays={setDays}
            topics={allTopics.map((t) => t.name)}
            topic={topic}
            onTopic={setTopic}
            models={modelList}
            model={model}
            onModel={setModel}
            running={running === active?.id}
            progress={progress}
            hasRuns={brandRuns.length > 0}
          />
        ) : null}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">
          {notice ? (
            <div className="aw-callout mb-5 flex items-center justify-between gap-4">
              {notice}
              <button type="button" className="aw-text-link" onClick={() => setNotice("")}>
                Close
              </button>
            </div>
          ) : null}
          {error ? (
            <div className="aw-error mb-5 flex items-center justify-between gap-4">
              {error}
              <button type="button" className="aw-text-link" onClick={() => setError("")}>
                Close
              </button>
            </div>
          ) : null}
          {page === "members" ? (
            <MembersPage key={ws.id} sb={sb} ws={ws} userId={userId} onChanged={loadWorkspaces} />
          ) : RESEARCH.includes(page) ? (
            <ResearchPage
              key={ws.id}
              sb={sb}
              auth={auth}
              brands={brands}
              activeBrandId={active?.id ?? null}
              canEdit={canEdit}
              tool={page as Tool}
              onTool={(t) => setPage(t)}
            />
          ) : !view ? (
            <div className="aw-callout max-w-xl">This workspace has no brands yet. Ask an editor or admin to add one.</div>
          ) : page === "prompts" ? (
            <PromptsPage
              key={view.brand.id}
              view={view}
              readOnly={!canEdit}
              onChange={update}
              onRemove={() => remove(view.brand.id)}
              onCompetitor={(name) => {
                setFocus(name);
                setPage("competitors");
              }}
            />
          ) : page === "competitors" ? (
            <CompetitorsPage key={`${view.brand.id}-${focus ?? ""}`} view={view} initial={focus} />
          ) : page === "traffic" ? (
            <TrafficPage key={view.brand.id} view={view} auth={auth} canEdit={canEdit} />
          ) : page === "domains" || page === "urls" ? (
            <SourcesPage key={`${view.brand.id}-${page}`} view={view} mode={page} auth={canEdit ? auth : null} />
          ) : (
            <OverviewPage
              key={view.brand.id}
              view={view}
              onOpen={(p, name) => {
                setFocus(name ?? null);
                setPage(p);
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

// ─────────────────────────────── sidebar ───────────────────────────────

const ROLE_LABEL = { owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer" } as const;

const NAV: { group: string; items: { id: Page; label: string; icon: string }[] }[] = [
  {
    group: "General",
    items: [
      { id: "overview", label: "Overview", icon: "◰" },
      { id: "prompts", label: "Prompts", icon: "☰" },
      { id: "competitors", label: "Competitors", icon: "⇅" },
    ],
  },
  {
    group: "Sources",
    items: [
      { id: "domains", label: "Domains", icon: "◍" },
      { id: "urls", label: "URLs", icon: "⛓" },
    ],
  },
  { group: "Website", items: [{ id: "traffic", label: "Analytics", icon: "↗" }] },
  {
    group: "Research",
    items: [
      { id: "keywords", label: "Keyword research", icon: "⌕" },
      { id: "agentic", label: "Agentic research", icon: "✦" },
      { id: "calendar", label: "Content calendar", icon: "▦" },
    ],
  },
  { group: "Settings", items: [{ id: "members", label: "Workspace & members", icon: "⚙" }] },
];

/** The workspace switcher and the page menu. */
function Sidebar({
  sb,
  email,
  workspaces,
  ws,
  onWorkspace,
  onNewWorkspace,
  page,
  onPage,
}: {
  sb: SupabaseClient;
  email: string;
  workspaces: Workspace[];
  ws: Workspace;
  onWorkspace: (id: string) => void;
  onNewWorkspace: (name: string) => Promise<void>;
  page: Page;
  onPage: (p: Page) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <aside className="flex shrink-0 flex-col gap-5 border-b border-rule bg-white px-3 py-4 md:sticky md:top-0 md:h-screen md:w-60 md:border-r md:border-b-0">
      <div className="px-2">
        <Logo size="sm" />
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 rounded-aw border border-rule bg-white px-3 py-2 text-left shadow-aw-sm hover:border-brand-mist"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center bg-ink text-[12px] font-medium text-white">{ws.name.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium text-ink">{ws.name}</span>
            <span className="block text-[11px] text-muted">{ROLE_LABEL[ws.role]}</span>
          </span>
          <span aria-hidden="true" className="text-muted">
            ▾
          </span>
        </button>
        {open ? (
          <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-aw border border-rule bg-white shadow-aw-lg">
            {workspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => {
                  onWorkspace(w.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-none px-3 py-2 text-left text-[14px] hover:bg-surface-2 ${w.id === ws.id ? "text-brand" : "text-ink"}`}
              >
                <span className="truncate">{w.name}</span>
                <span className="text-[12px] text-muted">{ROLE_LABEL[w.role]}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={async () => {
                const name = prompt("Name your new workspace");
                if (name?.trim()) await onNewWorkspace(name.trim());
                setOpen(false);
              }}
              className="w-full rounded-none border-t border-rule-faint px-3 py-2 text-left text-[14px] font-medium text-brand hover:bg-surface-2"
            >
              + New workspace
            </button>
          </div>
        ) : null}
      </div>

      <nav className="flex flex-row flex-wrap gap-x-5 gap-y-3 md:flex-col">
        {NAV.map((g) => (
          <div key={g.group} className="flex flex-col gap-0.5">
            <span className="aw-label px-3 pb-1">{g.group}</span>
            {g.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onPage(item.id)}
                aria-current={page === item.id ? "page" : undefined}
                className={`flex items-center gap-2.5 px-3 py-1.5 text-left text-[14px] font-medium ${page === item.id ? "bg-surface-2 text-ink shadow-[inset_2px_0_0_var(--aw-brand)]" : "text-body hover:bg-surface-2"}`}
              >
                <span aria-hidden="true" className="w-4 text-center text-[13px] opacity-70">
                  {item.icon}
                </span>
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t border-rule-faint px-2 pt-4">
        <span className="truncate text-[12px] text-muted" title={email}>
          {email}
        </span>
        <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm self-start" onClick={() => sb.auth.signOut()}>
          Sign out
        </button>
      </div>
    </aside>
  );
}

// ─────────────────────────────── top bar ───────────────────────────────

const TIMEFRAMES = [7, 30, 60, 90];

/** Brand, period, topic and model pickers, and the Run button. */
function TopBar(p: {
  brands: Brand[];
  active: Brand | undefined;
  canEdit: boolean;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  days: number;
  onDays: (d: number) => void;
  topics: string[];
  topic: string;
  onTopic: (t: string) => void;
  models: string[];
  model: string;
  onModel: (m: string) => void;
  running: boolean;
  progress: { done: number; total: number };
  hasRuns: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pill = "flex items-center gap-2 rounded-aw border border-rule bg-white px-3 py-1.5 text-[13px] font-medium text-ink shadow-aw-sm";
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-rule bg-white/95 px-4 py-2.5 backdrop-blur sm:px-6">
      <div className="relative">
        <button type="button" className={pill} onClick={() => setOpen(!open)} aria-expanded={open}>
          {p.active ? <BrandLogo src={p.active.logo} name={p.active.name} size={18} /> : null}
          <span className="max-w-40 truncate">{p.active?.name ?? "Pick a brand"}</span>
          <span aria-hidden="true" className="text-muted">
            ▾
          </span>
        </button>
        {open ? (
          <div className="absolute z-30 mt-2 w-64 overflow-hidden rounded-aw border border-rule bg-white shadow-aw-lg">
            {p.brands.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  p.onSwitch(b.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-none px-3 py-2 text-left text-[14px] hover:bg-surface-2 ${b.id === p.active?.id ? "text-brand" : "text-ink"}`}
              >
                <BrandLogo src={b.logo} name={b.name} size={18} />
                <span className="truncate">{b.name}</span>
                <span className="ml-auto text-[12px] text-muted">{b.domain}</span>
              </button>
            ))}
            {p.canEdit ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  p.onAdd();
                }}
                className="w-full rounded-none border-t border-rule-faint px-3 py-2 text-left text-[14px] font-medium text-brand hover:bg-surface-2"
              >
                + Add a brand
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <select aria-label="Time period" value={p.days} onChange={(e) => p.onDays(Number(e.target.value))} className={`${pill} pr-7`}>
        {TIMEFRAMES.map((d) => (
          <option key={d} value={d}>
            Last {d} days
          </option>
        ))}
      </select>
      <select aria-label="Topic" value={p.topic} onChange={(e) => p.onTopic(e.target.value)} className={`${pill} max-w-56 pr-7`}>
        <option value="All">All topics</option>
        {p.topics.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <select aria-label="Model" value={p.model} onChange={(e) => p.onModel(e.target.value)} className={`${pill} pr-7`}>
        <option value="All">All models</option>
        {p.models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <div className="ml-auto flex items-center gap-3">
        {p.running ? (
          <span className="flex items-center gap-3">
            <span className="aw-label aw-label--brand">First check running</span>
            <span className="aw-progress w-32">
              <span className="aw-progress__fill block" style={{ width: `${(p.progress.done / Math.max(p.progress.total, 1)) * 100}%` }} />
            </span>
            <span className="aw-num text-[12px] text-muted">
              {p.progress.done}/{p.progress.total}
            </span>
          </span>
        ) : (
          <span className="aw-live" title="The daily job checks every prompt on every model">
            {p.hasRuns ? "Updates daily at 06:00 UTC" : "First results after the next daily check"}
          </span>
        )}
      </div>
    </div>
  );
}
