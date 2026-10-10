"use client";

import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadRuns, type Run } from "@/lib/chats";
import {
  acceptInvite,
  addBrand,
  getUsage,
  getPlanUsage,
  atLeast,
  createWorkspace,
  deleteBrand,
  listBrands,
  listRuns,
  listWorkspaces,
  saveBrand,
  saveRunChats,
  siteForBrand,
  saveAnswers,
  answerRows,
  startRun as startSavedRun,
  topicsOf,
  type Brand,
  type PlanUsage,
  type SavedRun,
  type Workspace,
} from "@/lib/db";
import { PLANS, promptAllowance, type PlanId, type Track } from "@/lib/plans";
import { Glimpse } from "./Glimpse";
import { post } from "./research/shared";
import { splitPeriods, type Filter } from "@/lib/metrics";
import type { View } from "@/lib/view";
import { runAll, type RunAuth } from "@/lib/runner";
import { getSupabase, type SupaConfig } from "@/lib/supa";
import { clearStash } from "@/lib/stash";
import { AuthScreen, NewPassword } from "./AuthScreen";
import { BrandLogo } from "./BrandLogo";
import { CompetitorsPage } from "./CompetitorsPage";
import { Logo } from "./Logo";
import { MembersPage } from "./MembersPage";
import { BillingPage, choosePlan } from "./BillingPage";
import { Onboarding, type NewBrand } from "./Onboarding";
import { PromptsPage } from "./PromptsPage";
import { ResearchPage, type Tool } from "./research/ResearchPage";
import type { SeoStart } from "./research/DomainResearch";
import { SourcesPage } from "./SourcesPage";
import { TrafficPage } from "./TrafficPage";
import { ReportsPage } from "./reports/ReportsPage";
import { VisitorsPage } from "./VisitorsPage";

export type { Brand } from "@/lib/db";
type Page = "prompts" | "competitors" | "domains" | "urls" | "traffic" | "visitors" | "keywords" | "domain" | "gap" | "calendar" | "topics" | "writer" | "summary" | "members" | "billing";
const RESEARCH: Page[] = ["keywords", "domain", "gap", "calendar", "topics", "writer"];
/** Website analytics is still in testing: only this account sees it. */
const WEBSITE_TESTER = "vincent@perceptric.com";
const VISIBILITY: Page[] = ["prompts", "competitors", "domains", "urls"]; // the only pages with period, topic and model filters

/** Each page's address. "/" opens Prompts. */
const SLUGS: Record<Page, string> = {
  prompts: "/prompts",
  competitors: "/competitors",
  domains: "/sources",
  urls: "/sources/urls",
  traffic: "/traffic",
  visitors: "/visitors",
  keywords: "/keywords",
  domain: "/domain-research",
  gap: "/competitive-analysis",
  calendar: "/calendar",
  topics: "/topic-bank",
  writer: "/agentic-writer",
  summary: "/reports",
  members: "/settings",
  billing: "/billing",
};
/** Older addresses still open the right page. */
const ALIASES: Record<string, Page> = {
  "/overview": "prompts",
  "/domains": "domains",
  "/urls": "urls",
  "/analytics": "traffic",
  "/keyword-research": "keywords",
  "/agentic-research": "topics",
  "/keyword-gap": "gap",
  "/ai-gap": "gap",
  "/planner": "topics",
  "/writer": "writer",
  "/inkwell": "writer",
  "/content-calendar": "calendar",
  "/reports/content": "calendar",
  "/plan": "billing",
};
const pageFromPath = (path: string): Page => {
  const p = path.replace(/\/+$/, "") || "/";
  return (Object.entries(SLUGS).find(([, slug]) => slug === p)?.[0] as Page | undefined) ?? ALIASES[p] ?? "prompts";
};
const PENDING_BRAND = "arrowsterr.brand.pending";

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
  const [promptRoom, setPromptRoom] = useState<number | undefined>(undefined); // prompts the plan still has room for, while adding a brand
  const tester = email.toLowerCase() === WEBSITE_TESTER;
  // Website pages are for the tester only: everyone else lands on Prompts.
  const allowed = useCallback((p: Page): Page => (!tester && (p === "traffic" || p === "visitors") ? "prompts" : p), [tester]);
  const [page, setPage] = useState<Page>(() => allowed(pageFromPath(window.location.pathname)));
  // Keep the address bar in step with the page, and follow the back and forward buttons.
  const go = useCallback((p: Page) => {
    setPage(p);
    if (window.location.pathname !== SLUGS[p]) window.history.pushState(null, "", SLUGS[p] + window.location.search);
  }, []);
  useEffect(() => {
    if (window.location.pathname !== SLUGS[page]) window.history.replaceState(null, "", SLUGS[page] + window.location.search);
    const back = () => setPage(allowed(pageFromPath(window.location.pathname)));
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
    // Only on first load: after that, go() moves the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [runs, setRuns] = useState<Record<string, SavedRun[]>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [engines, setEngines] = useState<string[] | null>(null);
  const [notice, setNotice] = useState("");
  const [days, setDays] = useState(30);
  const [model, setModel] = useState("All");
  const [topic, setTopic] = useState("All");
  const [focus, setFocus] = useState<string | null>(null); // competitor to open on the Competitors page
  const [focusTopic, setFocusTopic] = useState<string | null>(null); // topic to scroll to on the Prompts page
  const [seoStart, setSeoStart] = useState<SeoStart | null>(null); // a site or link from Sources to open in Domain Research
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<PlanUsage | null>(null);
  // A Starter on the SEO toolset opens on Keyword Research, the first page it has.
  const landed = useRef(false);
  useEffect(() => {
    if (!plan || landed.current) return;
    landed.current = true;
    // Moving to the first open page once the plan is known is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!plan.open.visibility && trackOf(page) === "visibility") go("keywords");
  }, [plan, page, go]);
  const [limitHit, setLimitHit] = useState<{ error: string; boost: PlanId | null; packs?: boolean } | null>(null);
  const [boosting, setBoosting] = useState(false);

  // Any API answer that hits a plan limit shows the Boost bar, wherever it came from.
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await original(...args);
      const url = typeof args[0] === "string" ? args[0] : args[0] instanceof Request ? args[0].url : String(args[0]);
      if ((res.status === 429 || res.status === 402) && url.includes("/api/")) {
        res
          .clone()
          .json()
          .then((d) => {
            if (d?.limit || d?.readOnly) setLimitHit({ error: String(d.error ?? ""), boost: (d.boost as PlanId | null) ?? null, packs: Boolean(d.packs) });
          })
          .catch(() => {});
      }
      return res;
    };
    return () => {
      window.fetch = original;
    };
  }, []);

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
  const needsRoom = Boolean(ws && (adding || brands?.length === 0));
  useEffect(() => {
    if (!ws || !needsRoom) return;
    let live = true;
    getUsage(sb, ws.id)
      .then((u) => live && setPromptRoom(Math.max(0, u.promptLimit - u.prompts)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sb, ws, needsRoom]);
  const canEdit = atLeast(ws?.role, "editor");
  const loadPlan = useCallback(() => {
    if (ws) getPlanUsage(sb, ws.id).then(setPlan).catch(() => setPlan(null));
  }, [sb, ws]);
  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  // Load brands whenever the workspace changes.
  useEffect(() => {
    if (!ws) return;
    writeLocal(`arrowsterr.ws.${userId}`, ws.id);
    let live = true;
    listBrands(sb, ws.id)
      .then((list) => {
        if (!live) return;
        setBrands(list);
        const pending = readLocal(PENDING_BRAND);
        writeLocal(PENDING_BRAND, null);
        const saved = readLocal(`arrowsterr.brand.${ws.id}`);
        setActiveId((id) => [pending, id, saved].find((x) => x && list.some((b) => b.id === x)) ?? list[0]?.id ?? null);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [sb, ws, userId]);

  const active = brands?.find((b) => b.id === activeId);
  useEffect(() => {
    if (ws && activeId) writeLocal(`arrowsterr.brand.${ws.id}`, activeId);
  }, [ws, activeId]);

  // Load a brand's run history: the chosen timeframe and the one before it, for the change numbers.
  // A longer timeframe loads more; a shorter one keeps what is already loaded.
  const loaded = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!active) return;
    const want = Math.min(plan?.limits.historyDays ?? 400, 400, Math.max(14, days * 2));
    if (runs[active.id] && (loaded.current[active.id] ?? 0) >= want) return;
    loaded.current[active.id] = want;
    listRuns(sb, active.id, want)
      .then((list) => setRuns((r) => ({ ...r, [active.id]: list })))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [sb, active, runs, days, plan]);

  async function runBrand(brand: Brand) {
    if (!engines?.length || running || !ws) return;
    // Prompts past the plan (after a downgrade, or on Free) are not checked.
    const room = plan ? (promptAllowance(brands?.some((b) => b.id === brand.id) ? brands : [...(brands ?? []), brand], plan.limits).get(brand.id) ?? brand.prompts.length) : brand.prompts.length;
    if (room <= 0) return;
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
    const finished = await runAll({ ...brand, prompts: brand.prompts.slice(0, room) }, engines, { workspaceId: ws.id, token }, (run, done, total) => {
      setRuns((r) => ({ ...r, [brand.id]: [...past, { ...run, id: runId ?? "live" }] }));
      setProgress({ done, total });
      // Save every 5 chats so a closed tab keeps most of the run.
      if (runId && done % 5 === 0) saving = saving.then(() => saveRunChats(sb, runId!, run.chats)).catch(() => {});
    });
    await saving;
    if (runId) {
      try {
        await saveRunChats(sb, runId, finished.chats);
        await saveAnswers(sb, answerRows(finished.chats, { workspace_id: ws.id, brand_id: brand.id, run_id: runId, at: finished.at }));
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
    go("prompts");
    setAdding(false);
    // The first check runs right away. After that the daily job keeps it fresh.
    void runBrand(brand);
    // Every brand gets its free Topic Bank, started as soon as the brand exists.
    void siteForBrand(sb, brand, true)
      .then((site) => site && post({ workspaceId: ws.id, token }, "/api/research/agentic", { siteId: site.id }))
      .catch(() => {});
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
        promptRoom={promptRoom}
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
  // Prompts past the plan's limits, after a downgrade. They stay, but daily checks skip them.
  const checked = active && plan ? (promptAllowance(brands, plan.limits).get(active.id) ?? active.prompts.length) : (active?.prompts.length ?? 0);
  const paused = new Set(active?.prompts.slice(checked) ?? []);
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
          go("prompts");
        }}
        onNewWorkspace={async (name) => {
          const id = await createWorkspace(sb, name);
          await loadWorkspaces();
          setWsId(id);
          setBrands(null);
        }}
        page={page}
        plan={plan}
        onPage={(p) => {
          setFocus(null);
          setFocusTopic(null);
          go(p);
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {page !== "members" && page !== "billing" ? (
          <TopBar
            visibility={VISIBILITY.includes(page)}
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
          {limitHit || (plan && plan.status === "read_only" && page !== "billing") ? (
            <div className="aw-callout aw-callout--warn mb-5 flex flex-wrap items-center justify-between gap-3">
              <span>{limitHit?.error || (plan?.plan === "trial" ? "Your free trial has ended. Your data is safe." : "This workspace is read-only. Your data is safe.")}</span>
              <span className="flex items-center gap-3">
                {limitHit?.packs ? (
                  <button
                    type="button"
                    className="aw-btn aw-btn--primary aw-btn--sm"
                    onClick={() => {
                      setLimitHit(null);
                      go("billing");
                    }}
                  >
                    Buy tasks
                  </button>
                ) : null}
                {limitHit?.boost && atLeast(ws.role, "admin") ? (
                  <button
                    type="button"
                    className="aw-btn aw-btn--primary aw-btn--sm"
                    disabled={boosting}
                    onClick={async () => {
                      setBoosting(true);
                      try {
                        const done = await choosePlan(auth, limitHit.boost!, plan?.interval ?? "month");
                        if (done) {
                          setNotice(done);
                          setLimitHit(null);
                          loadPlan();
                        }
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setBoosting(false);
                      }
                    }}
                  >
                    {boosting ? "Opening..." : `Boost to ${PLANS[limitHit.boost].name}`}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="aw-btn aw-btn--primary aw-btn--sm"
                    onClick={() => {
                      setLimitHit(null);
                      go("billing");
                    }}
                  >
                    See plans
                  </button>
                )}
                {limitHit ? (
                  <button type="button" className="aw-text-link" onClick={() => setLimitHit(null)}>
                    Close
                  </button>
                ) : null}
              </span>
            </div>
          ) : null}
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
            <MembersPage key={ws.id} sb={sb} ws={ws} userId={userId} onChanged={loadWorkspaces} auth={auth} />
          ) : page === "billing" ? (
            <BillingPage key={ws.id} sb={sb} ws={ws} auth={auth} onPlan={loadPlan} />
          ) : !view ? (
            <div className="aw-callout max-w-xl">This workspace has no brands yet. Ask an editor or admin to add one.</div>
          ) : plan && trackOf(page) && !plan.open[trackOf(page)!] ? (
            <Glimpse
              track={trackOf(page)!}
              admin={atLeast(ws.role, "admin")}
              busy={boosting}
              onBoost={async () => {
                setBoosting(true);
                try {
                  const done = await choosePlan(auth, "scale", plan.interval ?? "month");
                  if (done) {
                    setNotice(done);
                    loadPlan();
                  }
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBoosting(false);
                }
              }}
              onPlans={() => go("billing")}
            />
          ) : page === "writer" && plan && plan.limits.writer !== "full" ? (
            <Glimpse
              track="seo"
              title="Add the Agentic Writer with Pro"
              pitch="Turn every content brief into a finished, on-brand draft. AI agents write each section, build tables and interactive elements, add stats and links, then publish to your CMS."
              admin={atLeast(ws.role, "admin")}
              busy={boosting}
              onBoost={async () => {
                setBoosting(true);
                try {
                  const done = await choosePlan(auth, "scale", plan.interval ?? "month");
                  if (done) {
                    setNotice(done);
                    loadPlan();
                  }
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBoosting(false);
                }
              }}
              onPlans={() => go("billing")}
            />
          ) : RESEARCH.includes(page) ? (
            <ResearchPage key={view.brand.id} sb={sb} auth={auth} view={view} canEdit={canEdit} tool={page as Tool} onTool={(t) => go(t)} seoStart={seoStart}
              onSeoStarted={() => setSeoStart(null)}
              onSeo={(target, scope) => {
                setSeoStart({ target, scope });
                go("domain");
              }}
            />
          ) : page === "competitors" ? (
            <CompetitorsPage
              key={`${view.brand.id}-${focus ?? ""}`}
              view={view}
              auth={canEdit ? auth : null}
              initial={focus}
              limit={plan?.limits.competitors}
              onTopic={(t) => {
                setFocusTopic(t);
                go("prompts");
              }}
            />
          ) : page === "summary" ? (
            <ReportsPage key={view.brand.id} sb={sb} auth={auth} view={view} canEdit={canEdit} />
          ) : page === "visitors" ? (
            <VisitorsPage key={view.brand.id} view={view} auth={auth} />
          ) : page === "traffic" ? (
            <TrafficPage key={view.brand.id} view={view} auth={auth} canEdit={canEdit} />
          ) : page === "domains" || page === "urls" ? (
            <SourcesPage
              key={view.brand.id}
              view={view}
              auth={canEdit ? auth : null}
              reader={auth}
              onSeo={(target, scope) => {
                setSeoStart({ target, scope });
                go("domain");
              }}
            />
          ) : (
            <PromptsPage
              key={`${view.brand.id}-${focusTopic ?? ""}`}
              sb={sb}
              auth={auth}
              view={view}
              focusTopic={focusTopic}
              paused={paused}
              readOnly={!canEdit}
              onChange={update}
              onRemove={() => remove(view.brand.id)}
              onCompetitor={(name) => {
                setFocus(name);
                go("competitors");
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

// ─────────────────────────────── sidebar ───────────────────────────────

/** A menu that closes on a click outside it or on Escape. */
function useMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const ROLE_LABEL = { owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer" } as const;

/** Line icons for the page menu, drawn on a 24 × 24 grid. */
const ICONS: Record<string, string> = {
  prompts: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".9"/><circle cx="4.5" cy="12" r=".9"/><circle cx="4.5" cy="18" r=".9"/>',
  competitors: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.4 3.3-5.5 6.5-5.5s5.7 2.1 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.8 3 2.6 3.5 5.2"/>',
  sources: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  bank: '<path d="M6 4h12v16l-6-4-6 4z"/>',
  gap: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>',
  spark: '<path d="M12 3c.6 4.6 1.9 5.9 6.5 6.5-4.6.6-5.9 1.9-6.5 6.5-.6-4.6-1.9-5.9-6.5-6.5C10.1 8.9 11.4 7.6 12 3Z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  pen: '<path d="M4 20l4-1 11-11a2.1 2.1 0 0 0-3-3L5 16l-1 4z"/><path d="M14 7l3 3"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  report: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 6.2l2.1 2.1M17.7 15.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 17.8l2.1-2.1M17.7 8.3l2.1-2.1"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-6"/><circle cx="12" cy="12" r="1"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/>',
};
function NavIcon({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="aw-nav__icon" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;
}

/** The toolset a page belongs to. Starter opens one of them. */
const trackOf = (page: Page): Track | null =>
  ["prompts", "competitors", "domains", "urls"].includes(page) ? "visibility" : ["keywords", "domain", "gap", "topics", "calendar", "writer"].includes(page) ? "seo" : null;

/** The big modules of the app. Each opens to its own pages. */
const NAV: { group: string; icon: string; tester?: boolean; items: { id: Page; label: string; icon: string; also?: Page[] }[] }[] = [
  {
    group: "AI Visibility",
    icon: "radar",
    items: [
      { id: "prompts", label: "Prompts", icon: "prompts" },
      { id: "competitors", label: "Competitors", icon: "competitors" },
      { id: "domains", label: "Sources", icon: "sources", also: ["urls"] },
    ],
  },
  {
    group: "Organic Research",
    icon: "search",
    items: [
      { id: "keywords", label: "Keyword Research", icon: "search" },
      { id: "domain", label: "Domain Research", icon: "globe" },
      { id: "gap", label: "Competitive Analysis", icon: "gap" },
      { id: "topics", label: "Topic Bank", icon: "bank" },
    ],
  },
  {
    group: "Agentic Content",
    icon: "pen",
    items: [
      { id: "calendar", label: "Editorial Calendar", icon: "calendar" },
      { id: "writer", label: "Agentic Writer", icon: "pen" },
    ],
  },
  {
    group: "Website",
    icon: "trend",
    tester: true,
    items: [
      { id: "traffic", label: "Traffic", icon: "trend" },
      { id: "visitors", label: "Visitors", icon: "eye" },
    ],
  },
  {
    group: "Reports",
    icon: "report",
    items: [{ id: "summary", label: "Client report", icon: "report" }],
  },
];
const SETTINGS: { id: Page; label: string; icon: string }[] = [
  { id: "members", label: "Workspace & members", icon: "gear" },
  { id: "billing", label: "Plan & billing", icon: "card" },
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
  plan,
  onPage,
}: {
  sb: SupabaseClient;
  email: string;
  workspaces: Workspace[];
  ws: Workspace;
  onWorkspace: (id: string) => void;
  onNewWorkspace: (name: string) => Promise<void>;
  page: Page;
  plan: PlanUsage | null;
  onPage: (p: Page) => void;
}) {
  const { open, setOpen, ref } = useMenu();
  return (
    <aside className="aw-sidebar flex shrink-0 flex-col gap-5 border-b border-rule px-3 py-4 print:hidden md:sticky md:top-0 md:h-screen md:w-60 md:border-r md:border-b-0">
      <div className="px-2">
        <Logo size="sm" />
      </div>
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 rounded-aw border border-rule bg-white px-3 py-2 text-left shadow-aw-sm hover:border-brand-mist"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-ink text-[12px] font-medium text-white">{ws.name.slice(0, 1).toUpperCase()}</span>
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

      <nav className="flex flex-col gap-1" aria-label="Modules">
        {NAV.filter((g) => !g.tester || email.toLowerCase() === WEBSITE_TESTER).map((g) => {
          const on = g.items.some((item) => page === item.id || item.also?.includes(page));
          return (
            <div key={g.group} className="flex flex-col">
              <button type="button" onClick={() => !on && onPage(g.items[0].id)} aria-expanded={g.items.length > 1 ? on : undefined} className={`aw-mod ${on ? "is-on" : ""}`}>
                <NavIcon name={g.icon} />
                <span className="flex-1 text-left">{g.group}</span>
                {plan && trackOf(g.items[0].id) && !plan.open[trackOf(g.items[0].id)!] ? (
                  <span className="aw-chip px-1.5! py-0! text-[10px]!" title="On Pro">
                    Pro
                  </span>
                ) : null}
                {g.items.length > 1 ? (
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={`aw-mod__chev ${on ? "rotate-90" : ""}`}>
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                ) : null}
              </button>
              {on && g.items.length > 1 ? (
                <div className="aw-mod__items">
                  {g.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onPage(item.id)}
                      aria-current={page === item.id || item.also?.includes(page) ? "page" : undefined}
                      className={`aw-mod__item ${page === item.id || item.also?.includes(page) ? "is-on" : ""}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t border-rule-faint px-2 pt-4">
        <div className="-mx-2 flex flex-col">
          {SETTINGS.map((item) => (
            <button key={item.id} type="button" onClick={() => onPage(item.id)} aria-current={page === item.id ? "page" : undefined} className={`aw-mod aw-mod--sm ${page === item.id ? "is-on" : ""}`}>
              <NavIcon name={item.icon} />
              {item.label}
            </button>
          ))}
        </div>
        {plan && (plan.plan === "trial" || plan.status !== "active") ? (
          <button type="button" onClick={() => onPage("billing")} className="flex items-center justify-between gap-2 rounded-aw border border-brand-mist bg-brand-pale px-3 py-2 text-left text-[13px] font-medium text-brand">
            <span>{plan.status === "past_due" ? "Payment failed" : plan.trialLeft ? `${plan.trialLeft} days of trial left` : plan.plan === "trial" || plan.status !== "active" ? "Pick a plan" : plan.name}</span>
            <span aria-hidden="true">→</span>
          </button>
        ) : null}
        <span className="truncate text-[12px] text-muted" title={email}>
          {email}
        </span>
        <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm self-start" onClick={() => {
            clearStash();
            sb.auth.signOut();
          }}>
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
  visibility: boolean;
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
  const { open, setOpen, ref } = useMenu();
  const pill = "flex items-center gap-2 rounded-aw border border-rule bg-white px-3 py-1.5 text-[13px] font-medium text-ink shadow-aw-sm";
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-rule bg-white/95 print:hidden px-4 py-2.5 backdrop-blur sm:px-6">
      <div className="relative" ref={ref}>
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
      {!p.visibility ? null : (
        <>
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
        </>
      )}
      <div className="ml-auto flex items-center gap-3">
        <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => window.print()} title="Download this page as a PDF">
          Download PDF
        </button>
        {!p.visibility ? null : p.running ? (
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
            {p.hasRuns ? "Updates daily" : "First results after the next daily check"}
          </span>
        )}
      </div>
    </div>
  );
}
