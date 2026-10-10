"use client";

import { useEffect, useRef, useState } from "react";
import { MUSINGS } from "@/lib/musings";
import { DinoGame } from "./DinoGame";
import { flatPrompts, type Brand, type BrandCard, type Profile, type RivalCard, type Topic } from "@/lib/db";
import { ANGLES, BUSINESS_TYPES, COUNTRIES, MAX_PROMPTS, MAX_TOPICS, type Angle, type PickedTopic } from "@/lib/onboarding";
import type { RunAuth } from "@/lib/runner";
import { BrandLogo } from "./BrandLogo";
import { Logo } from "./Logo";
import { Thinking } from "./ui";

export type NewBrand = Omit<Brand, "id" | "workspace_id" | "daily">;
type Step = "site" | "brand" | "market" | "topics" | "prompts" | "done";
type TopicPick = PickedTopic & { on: boolean; named?: Named[] };
type PromptPick = { text: string; angle: Angle; on: boolean };
type Saved = {
  step: Step;
  seen: Step[];
  website: string;
  name: string;
  domain: string;
  url: string;
  logo: string;
  profile: Profile;
  topics: TopicPick[];
  candidates: number;
  plan: { name: string; prompts: PromptPick[] }[];
};
type Named = { name: string; domain: string; you: boolean };
type TopicsReply = { topics: (PickedTopic & { named?: Named[] })[]; candidates: number; engine: string | null };
type PromptsReply = { topics: { name: string; prompts: { text: string; angle: Angle }[] }[] };


const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const favicon = (domain: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;

async function call(path: string, auth: RunAuth, body: Record<string, unknown>) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` },
    body: JSON.stringify({ ...body, workspaceId: auth.workspaceId }),
  });
  const data = await res.json().catch(() => ({ error: `The server returned ${res.status}.` }));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

const QUADRANTS: { k: keyof BrandCard; label: string; ask: string; glyph: string }[] = [
  { k: "who", label: "Who", ask: "What it is and who uses it", glyph: "●" },
  { k: "whereTo", label: "Where-to", ask: "The outcome it helps them reach", glyph: "➚" },
  { k: "howTo", label: "How-to", ask: "How it delivers, and the features that matter", glyph: "⚙" },
  { k: "whySo", label: "Why-so", ask: "What it believes, and the problem it fights", glyph: "✦" },
];

const angleLabel = (a: Angle) => ANGLES.find((x) => x.id === a)?.label ?? a;
const PRICES = ["budget", "mid", "premium"] as const;

/** Website, then the Brand Card, the market, the topics and the prompts. */
/** Website, then the Brand Card, the market, the topics and the prompts. */
export function Onboarding({
  auth,
  onDone,
  onExit,
  onCancel,
  importCount,
  onImport,
  promptRoom = MAX_PROMPTS,
  engines = [],
  checkEvery = 1,
  seo = false,
}: {
  seo?: boolean; // Starter on Organic Research: no prompts to set up
  promptRoom?: number; // prompts the workspace's plan still has room for
  engines?: string[]; // AI engines the first check runs on
  checkEvery?: number; // days between checks on this plan
  auth: RunAuth;
  onDone: (b: NewBrand) => Promise<void>;
  onExit: () => void; // leave the finish screen
  onCancel?: () => void;
  importCount: number;
  onImport: () => Promise<void>;
}) {
  // Progress is saved in this browser, so a refresh or a closed tab picks up where it left off.
  const saveKey = `arrowsterr.onboarding.${auth.workspaceId}`;
  const [saved] = useState<Saved | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(saveKey) || "null") as Saved | null;
    } catch {
      return null;
    }
  });
  const [step, setStep] = useState<Step>(saved?.step ?? "site");
  const [seen, setSeen] = useState<Set<Step>>(new Set(saved?.seen ?? ["site"]));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [website, setWebsite] = useState(saved?.website ?? "");
  const [name, setName] = useState(saved?.name ?? "");
  const [domain, setDomain] = useState(saved?.domain ?? "");
  const [url, setUrl] = useState(saved?.url ?? "");
  const [logo, setLogo] = useState(saved?.logo ?? "");
  const [profile, setProfile] = useState<Profile>(saved?.profile ?? { businessType: undefined, country: "United States" });
  const [topics, setTopics] = useState<TopicPick[]>(saved?.topics ?? []);
  const [candidates, setCandidates] = useState(saved?.candidates ?? 0);
  const [plan, setPlan] = useState<{ name: string; prompts: PromptPick[] }[]>(saved?.plan ?? []);
  const [fresh, setFresh] = useState(false); // the research just finished: reveal the Brand Card
  const cap = Math.max(1, Math.min(MAX_PROMPTS, promptRoom));

  useEffect(() => {
    try {
      if (step === "done") localStorage.removeItem(saveKey);
      else if (step !== "site" || website) localStorage.setItem(saveKey, JSON.stringify({ step, seen: [...seen], website, name, domain, url, logo, profile, topics, candidates, plan } satisfies Saved));
    } catch {}
  }, [saveKey, step, seen, website, name, domain, url, logo, profile, topics, candidates, plan]);

  const go = (s: Step) => {
    setStep(s);
    setSeen((x) => new Set(x).add(s));
    window.scrollTo({ top: 0 });
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  };
  const chosen = topics.filter((t) => t.on);
  const used = plan.reduce((n, t) => n + t.prompts.filter((p) => p.on).length, 0);

  // Work ahead: topics start while the user reads the Brand Card, and prompts while they read the topics.
  // Each job is keyed on what it was asked, so an edit starts a fresh one.
  const brandKey = JSON.stringify({ name, domain, profile });
  const topicsJob = useRef<{ key: string; promise: Promise<TopicsReply> } | null>(null);
  const promptsJob = useRef<{ key: string; topics: string[]; promise: Promise<PromptsReply> } | null>(null);
  const getTopics = () => {
    if (topicsJob.current?.key !== brandKey) {
      const promise = call("/api/topics", auth, { name, domain, profile }) as Promise<TopicsReply>;
      promise.catch(() => {});
      topicsJob.current = { key: brandKey, promise };
    }
    return topicsJob.current.promise;
  };
  const getPrompts = (want: string[]) => {
    const job = promptsJob.current;
    if (job?.key === brandKey && want.every((t) => job.topics.includes(t))) return job.promise;
    const promise = call("/api/prompts", auth, { name, domain, profile, topics: want }) as Promise<PromptsReply>;
    promise.catch(() => {});
    promptsJob.current = { key: brandKey, topics: want, promise };
    return promise;
  };
  const ready = Boolean(name.trim() && domain.trim() && profile.businessType);
  useEffect(() => {
    if (seo || !ready) return;
    if (step === "brand" || step === "market") void getTopics();
    if (step === "topics" && topics.length) void getPrompts(topics.map((t) => t.topic));
    // Only when the step changes: edits on a step are picked up when the user moves on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const readSite = (e: React.FormEvent) => {
    e.preventDefault();
    run("Researching your brand and its market...", async () => {
      const d = await call("/api/onboard", auth, { website });
      setName(d.name);
      setDomain(d.domain);
      setUrl(d.url);
      setLogo(d.logo);
      setProfile(d.profile);
      setFresh(true);
      go("brand");
    });
  };
  const loadTopics = async () => {
    const d = await getTopics().catch(() => {
      topicsJob.current = null; // a failed job is never reused
      return getTopics();
    });
    const list = d.topics.map((t) => ({ ...t, on: true }));
    setTopics(list);
    setCandidates(d.candidates ?? 0);
    return list;
  };
  const loadPrompts = async (want: string[]) => {
    const d = await getPrompts(want).catch(() => {
      promptsJob.current = null;
      return getPrompts(want);
    });
    const list = want.map((t) => d.topics.find((x) => x.name === t) ?? { name: t, prompts: [{ text: t, angle: "head" as Angle }] });
    // Track the top 5 of each topic, within the plan's limit, taking one from each topic in turn.
    const on = list.map((t) => t.prompts.map(() => false));
    let left = cap;
    for (let round = 0; round < 5 && left > 0; round++)
      list.forEach((t, ti) => {
        if (left > 0 && round < t.prompts.length) {
          on[ti][round] = true;
          left--;
        }
      });
    const next = list.map((t, ti) => ({ name: t.name, prompts: t.prompts.map((p, pi) => ({ ...p, on: on[ti][pi] })) }));
    setPlan(next);
    return next;
  };
  const makeTopics = () =>
    run("Scoring 50 topics and checking who AI names for each...", async () => {
      await loadTopics();
      go("topics");
    });
  const makePrompts = () =>
    run("Writing prompts from every angle...", async () => {
      await loadPrompts(chosen.map((t) => t.topic));
      go("prompts");
    });
  const finish = (final = plan) =>
    run(seo ? "Setting up your brand..." : "Setting up your brand and starting the first check...", async () => {
      const kept: Topic[] = final.map((t) => ({ name: t.name, prompts: t.prompts.filter((p) => p.on).map((p) => p.text) })).filter((t) => t.prompts.length);
      const site = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
      await onDone({
        name: name.trim(),
        domain: site,
        url: url || `https://${site}`,
        logo: logo || `https://www.google.com/s2/favicons?domain=${site}&sz=128`,
        category: BUSINESS_TYPES.find((b) => b.id === profile.businessType)?.label ?? "",
        profile,
        topics: kept,
        prompts: flatPrompts(kept),
      });
      go("done");
    });
  // "Looks good": take the AI's picks for every step that is left, then finish.
  const acceptAll = () =>
    run("Setting everything up with our picks...", async () => {
      if (seo) return finish();
      const list = step === "topics" ? chosen : (await loadTopics()).filter((t) => t.on);
      const next = await loadPrompts(list.map((t) => t.topic));
      setBusy("Setting up your brand and starting the first check...");
      await finish(next);
    });

  const steps: { id: Step; label: string }[] = [
    { id: "brand", label: "Brand" },
    { id: "market", label: "Market" },
    ...(seo
      ? []
      : ([
          { id: "topics", label: "Topics" },
          { id: "prompts", label: "Prompts" },
        ] as const)),
  ];
  const at = step === "done" ? steps.length : steps.findIndex((s) => s.id === step);
  const quick = { label: "Looks good, set it all up", onClick: acceptAll };

  return (
    <main className="aw-onb flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-white/95 px-5 py-3 backdrop-blur">
        <Logo size="sm" />
        {step !== "site" ? (
          <ol className="aw-steps" aria-label="Steps">
            {steps.map((s, i) => (
              <li key={s.id} className={`aw-steps__item ${i === at ? "is-on" : i < at ? "is-done" : ""}`}>
                <button type="button" disabled={!seen.has(s.id) || Boolean(busy) || step === "done"} onClick={() => go(s.id)} aria-current={i === at ? "step" : undefined}>
                  <span className="aw-steps__dot">{i < at ? "✓" : i + 1}</span>
                  <span className="aw-steps__label">{s.label}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : null}
        <div className="flex items-center gap-3">
          {onCancel && step !== "done" ? (
            <button
              type="button"
              className="aw-btn aw-btn--secondary aw-btn--sm"
              onClick={() => {
                try {
                  localStorage.removeItem(saveKey);
                } catch {}
                onCancel();
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6">
        {error ? <p className="aw-error">{error}</p> : null}
        {busy ? (
          <div className="mx-auto w-full max-w-2xl">
            <Thinking text={busy}>
              <Musing />
              <DinoGame />
              <p className="aw-small">This takes about a minute. Keep this tab open.</p>
            </Thinking>
          </div>
        ) : null}

        {step === "site" && !busy ? (
          <SiteStep seo={seo} website={website} setWebsite={setWebsite} onSubmit={readSite} importCount={importCount} onImport={onImport} onManual={() => go("brand")} />
        ) : null}

        {step === "brand" && !busy ? (
          <BrandStep
            name={name}
            setName={setName}
            domain={domain}
            setDomain={setDomain}
            logo={logo}
            profile={profile}
            setProfile={setProfile}
            reveal={fresh}
            onNext={() => {
              setFresh(false);
              go("market");
            }}
            quick={ready ? quick : undefined}
          />
        ) : null}

        {step === "market" && !busy ? (
          <MarketStep
            name={name}
            logo={logo}
            profile={profile}
            setProfile={setProfile}
            onBack={() => go("brand")}
            next={seo ? "Finish setup" : "Find my topics"}
            onNext={seo ? () => finish() : makeTopics}
            quick={seo ? undefined : quick}
          />
        ) : null}

        {step === "topics" && !busy ? (
          <TopicsStep topics={topics} setTopics={setTopics} candidates={candidates} brand={name} onBack={() => go("market")} onNext={makePrompts} quick={chosen.length ? quick : undefined} />
        ) : null}

        {step === "prompts" && !busy ? (
          <PromptsStep plan={plan} setPlan={setPlan} used={used} cap={cap} engines={engines} checkEvery={checkEvery} onBack={() => go("topics")} onNext={() => finish()} />
        ) : null}

        {step === "done" && !busy ? <DoneStep name={name} logo={logo} seo={seo} engines={engines} prompts={used} onExit={onExit} /> : null}
      </div>
    </main>
  );
}


/** A rotating status line under the loading bar, in random order with no repeats until all have shown. */
function Musing() {
  const [order] = useState(() => [...MUSINGS].sort(() => Math.random() - 0.5));
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % order.length), 2400);
    return () => clearInterval(t);
  }, [order.length]);
  return (
    <p key={i} className="aw-musing" aria-live="off">
      {order[i]}
    </p>
  );
}

// ─────────────────────────────── steps ───────────────────────────────

function StepHead({ n, kicker, title, children }: { n?: number; kicker: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="aw-onb__kicker">
        {n ? <b>{String(n).padStart(2, "0")}</b> : null}
        {kicker}
      </span>
      <h1 className="aw-onb__title">{title}</h1>
      {children ? <p className="max-w-2xl text-[15px] text-body">{children}</p> : null}
    </div>
  );
}

type Quick = { label: string; onClick: () => void };
function Footer({ onBack, next, onNext, disabled, note, quick }: { onBack?: () => void; next: string; onNext: () => void; disabled?: boolean; note?: React.ReactNode; quick?: Quick }) {
  return (
    <div className="aw-onb__foot">
      {onBack ? (
        <button type="button" className="aw-text-link text-muted!" onClick={onBack}>
          ← Back
        </button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-4">
        {note ? <span className="aw-small">{note}</span> : null}
        {quick ? (
          <button type="button" className="aw-text-link text-[14px]" onClick={quick.onClick}>
            {quick.label}
          </button>
        ) : null}
        <button type="button" className="aw-btn aw-btn--accent aw-btn--lg" disabled={disabled} onClick={onNext}>
          {next} →
        </button>
      </div>
    </div>
  );
}

function SiteStep(p: { seo: boolean; website: string; setWebsite: (v: string) => void; onSubmit: (e: React.FormEvent) => void; importCount: number; onImport: () => Promise<void>; onManual: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 pt-6">
      {p.importCount ? (
        <div className="aw-callout flex flex-wrap items-center justify-between gap-3">
          This browser has {p.importCount} brands from before accounts existed.
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={p.onImport}>
            Import them
          </button>
        </div>
      ) : null}
      <form onSubmit={p.onSubmit} className="aw-frame aw-onb__hero">
        <div className="flex flex-col gap-6 p-7 sm:p-10">
          <span className="aw-onb__kicker">Brand setup</span>
          <h1 className="aw-h2 mb-0!">{p.seo ? "Find the keywords that bring you buyers" : "Track your brand in AI search"}</h1>
          <p className="text-[16px] text-body">Our AI analyst reads your site, maps your market and closest competitors, then picks the topics and prompts worth tracking.</p>
          <div>
            <label className="aw-label" htmlFor="website">
              Your website
            </label>
            <input id="website" value={p.website} onChange={(e) => p.setWebsite(e.target.value)} placeholder="acme.com" required autoFocus className="aw-input aw-input--hero" />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" className="aw-btn aw-btn--accent aw-btn--lg">
              Analyze my brand →
            </button>
            <button type="button" className="aw-text-link" onClick={p.onManual}>
              Fill in the details by hand
            </button>
          </div>
        </div>
        <ul className="aw-onb__path" aria-label="What happens next">
          {["Brand Card", "Market map", "Topics", "Prompts"].map((x, i) => (
            <li key={x}>
              <b>{i + 1}</b>
              {x}
            </li>
          ))}
        </ul>
      </form>
    </div>
  );
}

/** Grow a text box to fit its text, so nothing hides behind a scroll bar. */
const fit = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + 2}px`;
};

/** A titled bullet list. Click the list to edit it as text, one point per line. Click away to save. */
function Bullets({ label, ask, glyph, items, onChange, className = "" }: { label: string; ask?: string; glyph?: string; items: string[]; onChange: (v: string[]) => void; className?: string }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState("");
  const open = () => {
    setDraft(items.join("\n"));
    setEdit(true);
  };
  const save = () => {
    onChange(draft.split("\n").map((x) => x.replace(/^[-•*]\s*/, "").trim()).filter(Boolean));
    setEdit(false);
  };
  return (
    <section className={`aw-quad ${className}`}>
      <header className="min-w-0">
        <span className="aw-quad__label">
          {glyph ? <i aria-hidden="true">{glyph}</i> : null}
          {label}
        </span>
        {ask ? <p className="aw-quad__ask">{ask}</p> : null}
      </header>
      {edit ? (
        <textarea
          autoFocus
          rows={Math.max(3, items.length + 1)}
          value={draft}
          ref={fit}
          onChange={(e) => {
            setDraft(e.target.value);
            fit(e.target);
          }}
          onBlur={save}
          onKeyDown={(e) => e.key === "Escape" && setEdit(false)}
          className="aw-textarea text-[14px]!"
          aria-label={`${label}, one point per line`}
        />
      ) : (
        <button type="button" className="aw-quad__edit" onClick={open} title="Click to edit" aria-label={`Edit ${label}`}>
          {items.length ? (
            <ul className="aw-quad__list">
              {items.map((x, i) => (
                <li key={i}>{x.charAt(0).toUpperCase() + x.slice(1)}</li>
              ))}
            </ul>
          ) : (
            <span className="text-[13px] text-muted">Click to add points</span>
          )}
        </button>
      )}
    </section>
  );
}

const splitList = (v?: string) => (v ?? "").split(/[,\n;]/).map((x) => x.trim()).filter(Boolean);

function BrandStep(p: {
  name: string;
  setName: (v: string) => void;
  domain: string;
  setDomain: (v: string) => void;
  logo: string;
  profile: Profile;
  setProfile: (v: Profile) => void;
  reveal: boolean;
  onNext: () => void;
  quick?: Quick;
}) {
  const card: BrandCard = p.profile.card ?? { who: [], whereTo: [], howTo: [], whySo: [] };
  const ok = Boolean(p.name.trim() && p.domain.trim() && p.profile.businessType);
  return (
    <>
      <StepHead n={1} kicker="Brand Card" title="Here is how we read your brand">
        Click any list to edit it. Topics and prompts build on this.
      </StepHead>

      <div className="aw-frame aw-onb__id">
        {p.logo ? <BrandLogo src={p.logo} name={p.name || "?"} size={40} /> : <span className="aw-onb__mono">{(p.name || "?").slice(0, 1).toUpperCase()}</span>}
        <label className="aw-onb__field">
          <span>Brand</span>
          <input value={p.name} onChange={(e) => p.setName(e.target.value)} placeholder="eg. Poedit" required />
        </label>
        <label className="aw-onb__field">
          <span>Website</span>
          <input value={p.domain} onChange={(e) => p.setDomain(e.target.value)} placeholder="eg. poedit.net" required />
        </label>
        <label className="aw-onb__field">
          <span>Business type</span>
          <select value={p.profile.businessType ?? ""} onChange={(e) => p.setProfile({ ...p.profile, businessType: e.target.value as Profile["businessType"] })}>
            <option value="" disabled>
              Pick one
            </option>
            {BUSINESS_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="aw-onb__field">
          <span>Market</span>
          <select value={p.profile.country ?? "United States"} onChange={(e) => p.setProfile({ ...p.profile, country: e.target.value })}>
            {COUNTRIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      <div className={`aw-board ${p.reveal ? "is-reveal" : ""}`}>
        <div className="aw-quads">
          {QUADRANTS.map((q) => (
            <Bullets key={q.k} className={`aw-quad--${q.k}`} label={q.label} ask={q.ask} glyph={q.glyph} items={card[q.k]} onChange={(v) => p.setProfile({ ...p.profile, card: { ...card, [q.k]: v } })} />
          ))}
          <span className="aw-quads__core" aria-hidden="true">
            {p.logo ? <BrandLogo src={p.logo} name={p.name || "?"} size={28} /> : "✦"}
          </span>
        </div>
        <aside className="aw-facts">
          {(
            [
              { k: "products", label: "Products", ask: "What you sell" },
              { k: "customers", label: "Customers", ask: "Who buys it" },
              { k: "features", label: "Key features", ask: "What sets it apart" },
            ] as const
          ).map((f) => (
            <Bullets key={f.k} label={f.label} ask={f.ask} items={splitList(p.profile[f.k])} onChange={(v) => p.setProfile({ ...p.profile, [f.k]: v.join(", ") })} />
          ))}
        </aside>
      </div>

      <Footer next="See my market" onNext={p.onNext} disabled={!ok} note={!p.profile.businessType ? "Pick a business type first" : undefined} quick={p.quick} />
    </>
  );
}

function MarketStep(p: { name: string; logo: string; profile: Profile; setProfile: (v: Profile) => void; onBack: () => void; next: string; onNext: () => void; quick?: Quick }) {
  const rivals = p.profile.competitors ?? [];
  const pos = p.profile.position ?? { price: "mid" as const, size: "", region: "", summary: [] };
  const [add, setAdd] = useState("");
  const setRivals = (r: RivalCard[]) => p.setProfile({ ...p.profile, competitors: r });
  const setPos = (x: Partial<typeof pos>) => p.setProfile({ ...p.profile, position: { ...pos, ...x } });
  return (
    <>
      <StepHead n={2} kicker="Market map" title={`Where ${p.name || "your brand"} sits in its category`}>
        Your closest competitors and how you differ. The differences steer which topics we pick for you.
      </StepHead>

      <div className="aw-pos">
        <div className="aw-pos__tile">
          <span className="aw-label mb-0!">Price level</span>
          <div className="aw-pos__scale" role="radiogroup" aria-label="Price level">
            {PRICES.map((x) => (
              <button key={x} type="button" role="radio" aria-checked={pos.price === x} className={pos.price === x ? "is-on" : ""} onClick={() => setPos({ price: x })}>
                {x[0].toUpperCase() + x.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <label className="aw-pos__tile">
          <span className="aw-label mb-0!">Company size served</span>
          <input value={pos.size} onChange={(e) => setPos({ size: e.target.value })} placeholder="eg. Solo–SMB" className="aw-pos__input" />
        </label>
        <label className="aw-pos__tile">
          <span className="aw-label mb-0!">Region</span>
          <input value={pos.region} onChange={(e) => setPos({ region: e.target.value })} placeholder="eg. Global, English-speaking" className="aw-pos__input" />
        </label>
      </div>

      {pos.summary.length ? (
        <section className="aw-frame aw-onb__verdict">
          <span className="aw-onb__kicker">Where you stand</span>
          <ul>
            {pos.summary.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="aw-table-wrap rounded-aw-lg">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3.5">
          <span className="aw-h4">Closest competitors</span>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = add.trim();
              if (!v) return;
              const dom = /\.[a-z]{2,}$/i.test(v) ? v.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") : "";
              setRivals([...rivals, { name: dom ? dom.split(".")[0].replace(/^./, (c) => c.toUpperCase()) : v, domain: dom, who: "", howTo: "", price: "", difference: "" }]);
              setAdd("");
            }}
          >
            <input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Add a competitor's website" aria-label="Add a competitor" className="aw-input w-60! py-1.5! text-[13px]!" />
            <button type="submit" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={!add.trim()}>
              Add
            </button>
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="aw-table aw-onb__rivals">
            <thead>
              <tr>
                <th>Brand</th>
                <th>Who</th>
                <th>How-to</th>
                <th>Price</th>
                <th>Difference vs. {p.name || "you"}</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              <tr className="is-you">
                <td>
                  <span className="aw-table__name">
                    {p.logo ? <BrandLogo src={p.logo} name={p.name} size={20} /> : null}
                    {p.name || "You"}
                    <span className="aw-chip aw-chip--brand">You</span>
                  </span>
                </td>
                <td>{p.profile.card?.who[0] ?? "–"}</td>
                <td>{p.profile.card?.howTo[0] ?? "–"}</td>
                <td>
                  <PriceTag price={pos.price} />
                </td>
                <td className="text-muted!">Your baseline</td>
                <td />
              </tr>
              {rivals.map((r, i) => (
                <tr key={`${r.name}-${i}`}>
                  <td>
                    <span className="aw-table__name flex-nowrap!">
                      {r.domain ? <BrandLogo src={favicon(r.domain)} name={r.name} size={20} /> : null}
                      <span className="flex min-w-0 flex-col">
                        {r.name}
                        {r.domain ? <span className="text-[12px] font-normal text-muted">{r.domain}</span> : null}
                      </span>
                    </span>
                  </td>
                  <td>{r.who || "–"}</td>
                  <td>{r.howTo || "–"}</td>
                  <td>{r.price ? <PriceTag price={r.price} /> : "–"}</td>
                  <td>
                    <textarea
                      rows={1}
                      value={r.difference}
                      ref={fit}
                      onChange={(e) => { fit(e.target); setRivals(rivals.map((x, j) => (j === i ? { ...x, difference: e.target.value } : x)))}}
                      placeholder="How they differ from you"
                      aria-label={`How ${r.name} differs`}
                      className="aw-onb__cell resize-none"
                    />
                  </td>
                  <td>
                    <button type="button" aria-label={`Remove ${r.name}`} className="px-1 text-muted hover:text-neg" onClick={() => setRivals(rivals.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Footer onBack={p.onBack} next={p.next} onNext={p.onNext} quick={p.quick} />
    </>
  );
}

function PriceTag({ price }: { price: string }) {
  const level = /premium/i.test(price) ? 3 : /mid/i.test(price) ? 2 : 1;
  return (
    <span className="aw-price" title={price}>
      <span className="aw-price__bars" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <i key={n} className={n <= level ? "is-on" : ""} />
        ))}
      </span>
      {price[0]?.toUpperCase() + price.slice(1)}
    </span>
  );
}


/** Monthly searches for the picked topics, as one horizontal bar each. Hover a bar for its numbers. */
function VolumeChart({ topics }: { topics: TopicPick[] }) {
  const max = Math.max(1, ...topics.map((t) => t.volume ?? 0));
  return (
    <figure className="aw-vchart" aria-label="Monthly Google searches per topic">
      <figcaption className="aw-vchart__title">
        Monthly searches
        <span>Google, your market</span>
      </figcaption>
      <ol>
        {topics.map((t, i) => (
          <li key={i} className={t.on ? "" : "is-off"} tabIndex={0} data-tip={`${t.topic}: ${t.volume === null ? "no data" : `${t.volume.toLocaleString("en-US")} searches a month`}`}>
            <span className="aw-vchart__label">
              <b>{String(i + 1).padStart(2, "0")}</b>
              {t.topic}
            </span>
            <span className="aw-vchart__track">
              <i style={{ width: `${Math.max(2, ((t.volume ?? 0) / max) * 100)}%` }} />
            </span>
            <span className="aw-vchart__num">{t.volume === null ? "–" : t.volume.toLocaleString("en-US")}</span>
          </li>
        ))}
      </ol>
      <table className="sr-only">
        <thead>
          <tr>
            <th>Topic</th>
            <th>Monthly searches</th>
          </tr>
        </thead>
        <tbody>
          {topics.map((t, i) => (
            <tr key={i}>
              <td>{t.topic}</td>
              <td>{t.volume ?? "No data"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Logos of the brands AI names for a topic today, and whether the user is one of them. */
function NamedNow({ named }: { named?: Named[] }) {
  if (!named) return null;
  const you = named.some((n) => n.you);
  const rivals = named.filter((n) => !n.you).slice(0, 5);
  return (
    <span className="aw-named">
      <span className={`aw-named__you ${you ? "is-yes" : ""}`}>{you ? "AI names you" : "Not named yet"}</span>
      {rivals.length ? (
        <span className="aw-named__logos" title={`AI names: ${rivals.map((r) => r.name).join(", ")}`}>
          {rivals.map((r) => (
            <span key={r.name} className="aw-named__logo">
              {r.domain ? <BrandLogo src={favicon(r.domain)} name={r.name} size={18} /> : <span className="aw-named__mono">{r.name.slice(0, 1).toUpperCase()}</span>}
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function TopicsStep({ topics, setTopics, candidates, brand, onBack, onNext, quick }: { topics: TopicPick[]; setTopics: (t: TopicPick[]) => void; candidates: number; brand: string; onBack: () => void; onNext: () => void; quick?: Quick }) {
  const on = topics.filter((t) => t.on).length;
  return (
    <>
      <StepHead n={3} kicker="Topics" title="The 5 topics worth tracking">
        {candidates ? `We wrote ${candidates} buying categories and kept 5 that score best on volume, relevance and diversity. No two serve the same buyer.` : "The buying categories your customers ask AI about."}
      </StepHead>

      <div className="aw-topics">
        <ol className="flex flex-col gap-2.5">
          {topics.map((t, i) => (
            <li key={i} className={`aw-topic ${t.on ? "" : "is-off"}`}>
              <span className="aw-topic__rank">{String(i + 1).padStart(2, "0")}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <input aria-label="Topic" value={t.topic} onChange={(e) => setTopics(topics.map((x, j) => (j === i ? { ...x, topic: e.target.value } : x)))} className="aw-topic__name" />
                <p className="text-[13px] text-muted">
                  {t.buyer ? <b className="font-medium text-body">{t.buyer}</b> : null}
                  {t.buyer && t.reason ? " · " : null}
                  {t.reason}
                </p>
                <NamedNow named={t.named} />
              </div>
              <input
                type="checkbox"
                aria-label={`Track ${t.topic}`}
                checked={t.on}
                onChange={(e) => setTopics(topics.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))}
                className="h-5 w-5 shrink-0 accent-[#0943B0]"
              />
            </li>
          ))}
        </ol>
        <VolumeChart topics={topics} />
      </div>
      {topics.some((t) => t.named) ? <p className="aw-small">Logos show the brands ChatGPT names for each topic today. Track a topic to see when {brand || "you"} joins them.</p> : null}

      <Footer onBack={onBack} next="Write my prompts" onNext={onNext} disabled={!on || on > MAX_TOPICS} note={`${on} of ${MAX_TOPICS} topics`} quick={quick} />
    </>
  );
}

const WEEKLY = ["Claude", "Perplexity"]; // engines the daily job checks once a week

/** "25 prompts × 4 AI engines = 100 answers a day", from the plan's schedule. */
function costLine(prompts: number, engines: string[], checkEvery: number) {
  const daily = checkEvery === 1 ? engines.filter((e) => !WEEKLY.includes(e)) : engines;
  const weekly = checkEvery === 1 ? engines.filter((e) => WEEKLY.includes(e)) : [];
  if (!daily.length) return null;
  const per = checkEvery === 1 ? "a day" : checkEvery === 7 ? "a week" : `every ${checkEvery} days`;
  return `${prompts} prompts × ${daily.length} AI engines = ${(prompts * daily.length).toLocaleString("en-US")} answers ${per}${weekly.length ? `, plus ${weekly.join(" and ")} weekly` : ""}`;
}

function PromptsStep(p: {
  plan: { name: string; prompts: PromptPick[] }[];
  setPlan: (v: { name: string; prompts: PromptPick[] }[]) => void;
  used: number;
  cap: number;
  engines: string[];
  checkEvery: number;
  onBack: () => void;
  onNext: () => void;
}) {
  const [edit, setEdit] = useState(false);
  const set = (ti: number, pi: number, x: Partial<PromptPick>) => p.setPlan(p.plan.map((t, i) => (i === ti ? { ...t, prompts: t.prompts.map((y, j) => (j === pi ? { ...y, ...x } : y)) } : t)));
  const cost = costLine(p.used, p.engines, p.checkEvery);
  return (
    <>
      <StepHead n={4} kicker="Prompts" title="Prompts we will ask AI">
        {edit ? "Ten recommended prompts per topic, each from a different angle. Tick the ones to track." : "The top 5 per topic, each from a different angle."}{" "}
        <button type="button" className="aw-text-link" onClick={() => setEdit(!edit)}>
          {edit ? "Show the short list" : "Edit prompts"}
        </button>
      </StepHead>
      {cost ? (
        <div className="aw-cost">
          <b>{cost.split(" = ")[0]}</b>
          <span aria-hidden="true">=</span>
          <b className="text-brand">{cost.split(" = ")[1]}</b>
        </div>
      ) : null}
      {p.used > p.cap ? <p className="aw-error">You picked {p.used} prompts. Your plan allows {p.cap}. Untick some to continue.</p> : null}

      {edit ? (
        p.plan.map((t, ti) => (
          <section key={t.name} className="aw-table-wrap rounded-aw-lg">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-surface-2 px-5 py-3">
              <span className="flex items-center gap-3">
                <span className="aw-topic__rank aw-topic__rank--sm">{String(ti + 1).padStart(2, "0")}</span>
                <span className="aw-h4">{t.name}</span>
              </span>
              <span className="aw-small">{t.prompts.filter((x) => x.on).length} tracked</span>
            </div>
            <table className="aw-table aw-table--compact">
              <thead>
                <tr>
                  <th className="w-10" aria-label="Track" />
                  <th>Prompt</th>
                  <th className="w-36">Angle</th>
                </tr>
              </thead>
              <tbody>
                {t.prompts.map((x, pi) => (
                  <tr key={pi} className={x.on ? "is-you" : ""}>
                    <td>
                      <input type="checkbox" aria-label={`Track: ${x.text}`} checked={x.on} onChange={(e) => set(ti, pi, { on: e.target.checked })} className="h-4 w-4 accent-[#0943B0]" />
                    </td>
                    <td>
                      <input value={x.text} onChange={(e) => set(ti, pi, { text: e.target.value })} aria-label="Prompt" className="aw-onb__cell text-ink!" />
                    </td>
                    <td>
                      <span className="aw-chip">{angleLabel(x.angle)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      ) : (
        <div className="aw-plist">
          {p.plan.map((t, ti) => (
            <section key={t.name} className="aw-plist__card">
              <header>
                <span className="aw-topic__rank aw-topic__rank--sm">{String(ti + 1).padStart(2, "0")}</span>
                <span className="aw-plist__topic">{t.name}</span>
              </header>
              <ul>
                {t.prompts
                  .filter((x) => x.on)
                  .map((x, i) => (
                    <li key={i}>
                      <span>{x.text}</span>
                      <em>{angleLabel(x.angle)}</em>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Footer onBack={p.onBack} next="Start tracking" onNext={p.onNext} disabled={!p.used || p.used > p.cap} note={`${p.used} of ${p.cap} prompts`} />
    </>
  );
}

/** The last page: what happens now, and the way into the app. */
function DoneStep({ name, logo, seo, engines, prompts, onExit }: { name: string; logo: string; seo: boolean; engines: string[]; prompts: number; onExit: () => void }) {
  const daily = engines.filter((e) => !WEEKLY.includes(e));
  return (
    <section className="aw-frame aw-onb__done">
      <span className="aw-onb__seal">{logo ? <BrandLogo src={logo} name={name} size={40} /> : "✓"}</span>
      <span className="aw-onb__kicker">All set</span>
      <h1 className="aw-onb__title">{seo ? `${name || "Your brand"} is ready` : `Your first check is running`}</h1>
      {seo ? (
        <p className="text-[16px] text-body">Open the Topic Bank and click Generate to build your revenue-driven keyword list.</p>
      ) : (
        <>
          <p className="text-[16px] text-body">
            We are asking {prompts} prompts on {daily.length ? daily.join(", ") : "every AI engine"} right now. Results in about 10 minutes. You can leave this page while it runs.
          </p>
          {engines.length ? (
            <ul className="aw-onb__engines">
              {engines.map((e) => (
                <li key={e}>
                  <i aria-hidden="true" />
                  {e}
                  <span>{WEEKLY.includes(e) ? "weekly" : "running"}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      <button type="button" className="aw-btn aw-btn--accent aw-btn--lg" onClick={onExit}>
        {seo ? "Open the Topic Bank" : "Go to my dashboard"} →
      </button>
    </section>
  );
}
