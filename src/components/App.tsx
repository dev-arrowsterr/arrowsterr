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
  type Brand,
  type SavedRun,
  type Workspace,
} from "@/lib/db";
import { runAll, type RunAuth } from "@/lib/runner";
import { getSupabase, type SupaConfig } from "@/lib/supa";
import { AuthScreen, NewPassword } from "./AuthScreen";
import { BrandLogo } from "./BrandLogo";
import { CompetitorsPage } from "./CompetitorsPage";
import { DashboardPage } from "./DashboardPage";
import { Logo } from "./Logo";
import { MembersPage } from "./MembersPage";
import { PromptsPage } from "./PromptsPage";

export type { Brand } from "@/lib/db";
type Suggestion = Omit<Brand, "id" | "workspace_id" | "daily">;
type Page = "dashboard" | "competitors" | "prompts" | "members";

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
  const [page, setPage] = useState<Page>("dashboard");
  const [runs, setRuns] = useState<Record<string, SavedRun[]>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [engines, setEngines] = useState<string[] | null>(null);
  const [notice, setNotice] = useState("");
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

  async function onboard(s: Suggestion) {
    if (!ws) return;
    const brand = await addBrand(sb, { ...s, workspace_id: ws.id });
    setBrands((list) => [...(list ?? []), brand]);
    setRuns((r) => ({ ...r, [brand.id]: [] }));
    setActiveId(brand.id);
    setPage("dashboard");
    setAdding(false);
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
      const old = JSON.parse(readLocal(LEGACY_BRANDS) || "[]") as (Suggestion & { id: string })[];
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
          setPage("dashboard");
        }}
        onNewWorkspace={async (name) => {
          const id = await createWorkspace(sb, name);
          await loadWorkspaces();
          setWsId(id);
          setBrands(null);
        }}
        brands={brands}
        active={active}
        canEdit={canEdit}
        page={page}
        onPage={setPage}
        onSwitch={setActiveId}
        onAdd={() => setAdding(true)}
      />
      <main className="min-w-0 flex-1 px-4 py-8 sm:px-8">
        {notice ? (
          <div className="aw-callout mb-6 flex items-center justify-between gap-4 text-[15px]!">
            {notice}
            <button type="button" className="aw-text-link" onClick={() => setNotice("")}>
              Close
            </button>
          </div>
        ) : null}
        {error ? (
          <div className="aw-error mb-6 flex items-center justify-between gap-4">
            {error}
            <button type="button" className="aw-text-link" onClick={() => setError("")}>
              Close
            </button>
          </div>
        ) : null}
        {page === "members" ? (
          <MembersPage key={ws.id} sb={sb} ws={ws} userId={userId} onChanged={loadWorkspaces} />
        ) : !active ? (
          <div className="aw-callout max-w-xl text-[16px]!">
            This workspace has no brands yet. Ask an editor or admin to add one.
          </div>
        ) : page === "competitors" ? (
          <CompetitorsPage key={active.id} brand={active} runs={runs[active.id] ?? []} />
        ) : page === "prompts" ? (
          <PromptsPage key={active.id} brand={active} readOnly={!canEdit} onChange={update} onRemove={() => remove(active.id)} />
        ) : (
          <DashboardPage
            key={active.id}
            brand={active}
            runs={runs[active.id] ?? []}
            running={running === active.id}
            progress={progress}
            canRun={
              !canEdit
                ? "Viewers can see results. Ask an admin for editor access to run checks."
                : engines === null
                  ? "Loading engines..."
                  : !engines.length
                    ? "No engine keys are set on Render. Add OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY or PERPLEXITY_API_KEY."
                    : !active.prompts.length
                      ? "Add prompts on the Prompts page first."
                      : running && running !== active.id
                        ? "Another brand is running. Wait for it to finish."
                        : null
            }
            onRun={() => runBrand(active)}
          />
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────── sidebar ───────────────────────────────

const ROLE_LABEL = { owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer" } as const;

function Sidebar({
  sb,
  email,
  workspaces,
  ws,
  onWorkspace,
  onNewWorkspace,
  brands,
  active,
  canEdit,
  page,
  onPage,
  onSwitch,
  onAdd,
}: {
  sb: SupabaseClient;
  email: string;
  workspaces: Workspace[];
  ws: Workspace;
  onWorkspace: (id: string) => void;
  onNewWorkspace: (name: string) => Promise<void>;
  brands: Brand[];
  active: Brand | undefined;
  canEdit: boolean;
  page: Page;
  onPage: (p: Page) => void;
  onSwitch: (id: string) => void;
  onAdd: () => void;
}) {
  const [wsOpen, setWsOpen] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
  const nav: { group: string; items: { id: Page; label: string }[] }[] = [
    { group: "General", items: [{ id: "dashboard", label: "Dashboard" }, { id: "competitors", label: "Competitors" }, { id: "prompts", label: "Prompts" }] },
    { group: "Settings", items: [{ id: "members", label: "Workspace & members" }] },
  ];
  return (
    <aside className="flex shrink-0 flex-col gap-5 border-b-2 border-line bg-white px-4 py-5 md:min-h-screen md:w-64 md:border-r-2 md:border-b-0">
      <Logo size="md" />

      <div className="relative">
        <span className="text-[12px] text-g500">Workspace</span>
        <button
          type="button"
          onClick={() => setWsOpen(!wsOpen)}
          className="mt-1 flex w-full items-center gap-2 rounded-aw border border-border bg-white px-3 py-2 text-left hover:border-line"
        >
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{ws.name}</span>
          <span className="aw-tag">{ROLE_LABEL[ws.role]}</span>
          <span aria-hidden="true">▾</span>
        </button>
        {wsOpen ? (
          <div className="absolute z-20 mt-2 w-full rounded-aw border-2 border-line bg-white shadow-aw-sm">
            {workspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => {
                  onWorkspace(w.id);
                  setWsOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[14px] hover:bg-brand-pale"
              >
                <span className="truncate">{w.name}</span>
                <span className="text-[12px] text-g500">{ROLE_LABEL[w.role]}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={async () => {
                const name = prompt("Name your new workspace");
                if (name?.trim()) await onNewWorkspace(name.trim());
                setWsOpen(false);
              }}
              className="w-full border-t border-border px-3 py-2 text-left text-[14px] font-medium text-brand hover:bg-brand-pale"
            >
              + New workspace
            </button>
          </div>
        ) : null}
      </div>

      {active ? (
        <div className="relative">
          <span className="text-[12px] text-g500">Brand</span>
          <button
            type="button"
            onClick={() => setBrandOpen(!brandOpen)}
            className="mt-1 flex w-full items-center gap-3 rounded-aw border-2 border-line bg-white px-3 py-2 text-left"
          >
            <BrandLogo src={active.logo} name={active.name} />
            <span className="min-w-0 flex-1 truncate font-medium text-ink">{active.name}</span>
            <span aria-hidden="true">▾</span>
          </button>
          {brandOpen ? (
            <div className="absolute z-10 mt-2 w-full rounded-aw border-2 border-line bg-white shadow-aw-sm">
              {brands.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    onSwitch(b.id);
                    setBrandOpen(false);
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-brand-pale"
                >
                  <BrandLogo src={b.logo} name={b.name} size={22} />
                  <span className="truncate text-[15px]">{b.name}</span>
                </button>
              ))}
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    setBrandOpen(false);
                    onAdd();
                  }}
                  className="w-full border-t border-border px-3 py-2 text-left text-[15px] font-medium text-brand hover:bg-brand-pale"
                >
                  + Add a brand
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <nav className="flex flex-row flex-wrap gap-x-6 gap-y-4 md:flex-col">
        {nav.map((g) => (
          <div key={g.group} className="flex flex-col gap-1">
            <span className="text-[12px] text-g500">{g.group}</span>
            {g.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onPage(item.id)}
                className={`rounded-aw px-3 py-2 text-left text-[15px] font-medium ${
                  page === item.id ? "bg-brand text-white" : "text-ink-2 hover:bg-brand-pale"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
        <span className="truncate text-[13px] text-g600" title={email}>
          {email}
        </span>
        <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm self-start" onClick={() => sb.auth.signOut()}>
          Sign out
        </button>
      </div>
    </aside>
  );
}

// ─────────────────────────────── onboarding ───────────────────────────────

function Onboarding({
  onDone,
  onCancel,
  auth,
  importCount,
  onImport,
}: {
  onDone: (b: Suggestion) => Promise<void>;
  onCancel?: () => void;
  auth: RunAuth;
  importCount: number;
  onImport: () => Promise<void>;
}) {
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [found, setFound] = useState<Suggestion | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState("");

  async function lookUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` },
        body: JSON.stringify({ website, workspaceId: auth.workspaceId }),
      });
      const data = await res.json().catch(() => ({ error: `The server returned ${res.status}.` }));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setFound(data);
      setPicked(new Set(data.prompts));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function toggle(p: string) {
    const next = new Set(picked);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setPicked(next);
  }

  function addCustom() {
    const p = custom.trim();
    if (!p || !found) return;
    if (!found.prompts.includes(p)) setFound({ ...found, prompts: [...found.prompts, p] });
    setPicked(new Set([...picked, p]));
    setCustom("");
  }

  return (
    <main className="aw-dotgrid flex min-h-screen justify-center px-4 py-10">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <Logo size="md" />
          {onCancel ? (
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
        </div>

        {importCount ? (
          <div className="aw-callout flex flex-wrap items-center justify-between gap-3 text-[15px]!">
            This browser has {importCount} brands from before accounts existed.
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onImport}>
              Import them
            </button>
          </div>
        ) : null}
        {!found ? (
          <form onSubmit={lookUp} className="aw-frame aw-frame--shadow">
            <div className="aw-frame__body flex flex-col gap-6">
              <h1 className="aw-h2 mb-0!">Track your brand in AI search</h1>
              <div>
                <label className="aw-label" htmlFor="website">
                  Your website
                </label>
                <input
                  id="website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="acme.com"
                  required
                  autoFocus
                  className="aw-input aw-input--hero"
                />
              </div>
              {error ? <p className="aw-error">{error}</p> : null}
              <div>
                <button type="submit" className="aw-btn aw-btn--primary aw-btn--lg" disabled={busy}>
                  {busy ? "Reading your site (about 30 seconds)..." : "Continue"}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="aw-frame aw-frame--shadow">
            <div className="aw-frame__head">
              <BrandLogo src={found.logo} name={found.name} size={36} />
              <div className="min-w-0">
                <div className="aw-h4">{found.name}</div>
                <div className="aw-small">{found.domain}</div>
              </div>
            </div>
            <div className="aw-frame__body flex flex-col gap-6">
              <h1 className="aw-h3">Suggested prompts</h1>
              {found.category ? <p className="aw-small">{found.category}</p> : null}
              <ul className="flex flex-col divide-y divide-border rounded-aw border border-border">
                {found.prompts.map((p) => (
                  <li key={p}>
                    <label className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-brand-pale">
                      <input
                        type="checkbox"
                        checked={picked.has(p)}
                        onChange={() => toggle(p)}
                        className="mt-1 h-4 w-4 accent-[#1E7A4D]"
                      />
                      <span className="text-[15px] text-ink-2">{p}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex gap-3">
                <input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustom();
                    }
                  }}
                  placeholder="Add your own prompt"
                  className="aw-input"
                />
                <button type="button" className="aw-btn aw-btn--secondary" onClick={addCustom}>
                  Add
                </button>
              </div>
              {error ? <p className="aw-error">{error}</p> : null}
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  className="aw-btn aw-btn--primary aw-btn--lg"
                  disabled={!picked.size}
                  onClick={() =>
                    onDone({ ...found, prompts: found.prompts.filter((p) => picked.has(p)) }).catch((err) =>
                      setError(err instanceof Error ? err.message : String(err)),
                    )
                  }
                >
                  Start tracking {picked.size} prompts
                </button>
                <button type="button" className="aw-text-link" onClick={() => setFound(null)}>
                  Use a different website
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
