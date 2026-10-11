"use client";

import { useEffect, useRef, useState } from "react";
import { MUSINGS } from "@/lib/musings";
import { DinoGame } from "./DinoGame";
import { flatPrompts, type Brand, type Profile, type Topic } from "@/lib/db";
import { ANGLES, BUCKETS, BUSINESS_TYPES, MAX_PROMPTS, RECOMMENDED, type Angle, type PickedTopic } from "@/lib/onboarding";
import type { RunAuth } from "@/lib/runner";
import { BrandLogo } from "./BrandLogo";
import { Logo } from "./Logo";
import { Thinking } from "./ui";

export type NewBrand = Omit<Brand, "id" | "workspace_id" | "daily">;
type Step = "site" | "topics" | "prompts" | "done";
type TopicPick = PickedTopic & { on: boolean };
type PromptPick = { text: string; angle: Angle; on: boolean };
type PlanTopic = { name: string; prompts: PromptPick[] };
type Saved = { step: Step; website: string; name: string; domain: string; url: string; logo: string; profile: Profile; topics: TopicPick[]; plan: PlanTopic[] };
type PromptsReply = { topics: { name: string; prompts: { text: string; angle: Angle }[] }[] };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const angleLabel = (a: Angle) => ANGLES.find((x) => x.id === a)?.label ?? a;
const bucketLabel = (b: string) => BUCKETS.find((x) => x.id === b)?.label ?? b;
const fmt = (n: number | null) => (n === null ? "–" : n.toLocaleString("en-US"));

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

/** Tick the top 5 prompts of each tracked topic, within the plan's limit, one topic at a time in turn. */
function pick(list: { name: string; prompts: { text: string; angle: Angle }[] }[], cap: number): PlanTopic[] {
  const on = list.map((t) => t.prompts.map(() => false));
  let left = cap;
  for (let round = 0; round < RECOMMENDED && left > 0; round++)
    list.forEach((t, ti) => {
      if (left > 0 && round < t.prompts.length) {
        on[ti][round] = true;
        left--;
      }
    });
  return list.map((t, ti) => ({ name: t.name, prompts: t.prompts.map((p, pi) => ({ ...p, on: on[ti][pi] })) }));
}

/** Website, then the topics, then the prompts. The AI researches the brand on its own. */
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
      const v = JSON.parse(localStorage.getItem(saveKey) || "null") as Saved | null;
      return v && ["site", "topics", "prompts"].includes(v.step) && Array.isArray(v.topics) ? v : null;
    } catch {
      return null;
    }
  });
  const [step, setStep] = useState<Step>(saved?.step ?? "site");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [website, setWebsite] = useState(saved?.website ?? "");
  const [name, setName] = useState(saved?.name ?? "");
  const [domain, setDomain] = useState(saved?.domain ?? "");
  const [url, setUrl] = useState(saved?.url ?? "");
  const [logo, setLogo] = useState(saved?.logo ?? "");
  const [profile, setProfile] = useState<Profile>(saved?.profile ?? { country: "United States" });
  const [topics, setTopics] = useState<TopicPick[]>(saved?.topics ?? []);
  const [plan, setPlan] = useState<PlanTopic[]>(saved?.plan ?? []);
  const cap = Math.max(1, promptRoom);

  useEffect(() => {
    try {
      if (step === "done") localStorage.removeItem(saveKey);
      else if (step !== "site" || website) localStorage.setItem(saveKey, JSON.stringify({ step, website, name, domain, url, logo, profile, topics, plan } satisfies Saved));
    } catch {}
  }, [saveKey, step, website, name, domain, url, logo, profile, topics, plan]);

  const go = (s: Step) => {
    setStep(s);
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

  // Prompts for every topic start while the user reads the topics, so the next step opens at once.
  const promptsJob = useRef<{ key: string; promise: Promise<PromptsReply> } | null>(null);
  const allTopics = topics.map((t) => t.topic);
  const jobKey = JSON.stringify({ name, allTopics });
  const getPrompts = () => {
    if (promptsJob.current?.key !== jobKey) {
      const promise = call("/api/prompts", auth, { name, domain, profile, topics: allTopics }) as Promise<PromptsReply>;
      promise.catch(() => {});
      promptsJob.current = { key: jobKey, promise };
    }
    return promptsJob.current.promise;
  };
  useEffect(() => {
    if (step === "topics" && topics.length) void getPrompts();
    // Only when the step changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const finish = (final: PlanTopic[]) =>
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

  const readSite = (e: React.FormEvent) => {
    e.preventDefault();
    run("Researching your brand and finding its best topics...", async () => {
      const d = await call("/api/onboard", auth, { website });
      setName(d.name);
      setDomain(d.domain);
      setUrl(d.url);
      setLogo(d.logo);
      setProfile(d.profile);
      setTopics((d.topics as PickedTopic[]).map((t, i) => ({ ...t, on: i < RECOMMENDED })));
      if (seo) {
        // Organic Research only: no prompts to track, so the brand is ready now.
        setBusy("Setting up your brand...");
        const p = d.profile as Profile;
        await onDone({ name: d.name, domain: d.domain, url: d.url, logo: d.logo, category: BUSINESS_TYPES.find((b) => b.id === p.businessType)?.label ?? "", profile: p, topics: [], prompts: [] });
        go("done");
      } else go("topics");
    });
  };
  const loadPrompts = async () => {
    const d = await getPrompts().catch(() => {
      promptsJob.current = null; // a failed job is never reused
      return getPrompts();
    });
    const list = chosen.map((t) => d.topics.find((x) => x.name === t.topic) ?? { name: t.topic, prompts: [{ text: t.topic, angle: "head" as Angle }] });
    const next = pick(list, cap);
    setPlan(next);
    return next;
  };
  const makePrompts = () =>
    run("Writing prompts from every buyer angle...", async () => {
      await loadPrompts();
      go("prompts");
    });
  // "Looks good": track the picked topics with their recommended prompts, then finish.
  const acceptAll = () =>
    run("Setting everything up with our picks...", async () => {
      const next = await loadPrompts();
      setBusy("Setting up your brand and starting the first check...");
      await finish(next);
    });

  const steps: { id: Step; label: string }[] = [
    { id: "topics", label: "Topics" },
    { id: "prompts", label: "Prompts" },
  ];
  const at = step === "done" ? steps.length : steps.findIndex((s) => s.id === step);

  return (
    <main className="aw-onb flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-white/95 px-5 py-3 backdrop-blur">
        <Logo size="sm" />
        {step !== "site" && !seo ? (
          <ol className="aw-steps" aria-label="Steps">
            {steps.map((s, i) => (
              <li key={s.id} className={`aw-steps__item ${i === at ? "is-on" : i < at ? "is-done" : ""}`}>
                <button type="button" disabled={i > at || Boolean(busy) || step === "done" || (s.id === "prompts" && !plan.length)} onClick={() => go(s.id)} aria-current={i === at ? "step" : undefined}>
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

        {step === "site" && !busy ? <SiteStep seo={seo} website={website} setWebsite={setWebsite} onSubmit={readSite} importCount={importCount} onImport={onImport} /> : null}

        {step === "topics" && !busy ? (
          <TopicsStep
            name={name}
            logo={logo}
            topics={topics}
            setTopics={setTopics}
            onBack={() => go("site")}
            onNext={makePrompts}
            quick={chosen.length ? { label: "Looks good, set it all up", onClick: acceptAll } : undefined}
          />
        ) : null}

        {step === "prompts" && !busy ? (
          <PromptsStep plan={plan} setPlan={setPlan} used={used} cap={cap} engines={engines} checkEvery={checkEvery} onBack={() => go("topics")} onNext={() => finish(plan)} />
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

function SiteStep(p: { seo: boolean; website: string; setWebsite: (v: string) => void; onSubmit: (e: React.FormEvent) => void; importCount: number; onImport: () => Promise<void> }) {
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
          <p className="text-[16px] text-body">Our AI analyst researches your business on its own, then picks the buying topics and prompts worth tracking.</p>
          <div>
            <label className="aw-label" htmlFor="website">
              Your website
            </label>
            <input id="website" value={p.website} onChange={(e) => p.setWebsite(e.target.value)} placeholder="acme.com" required autoFocus className="aw-input aw-input--hero" />
          </div>
          <button type="submit" className="aw-btn aw-btn--accent aw-btn--lg self-start">
            Analyze my brand →
          </button>
        </div>
        {p.seo ? null : (
          <ul className="aw-onb__path aw-onb__path--3" aria-label="What happens next">
            {["Research", "Topics", "Prompts"].map((x, i) => (
              <li key={x}>
                <b>{i + 1}</b>
                {x}
              </li>
            ))}
          </ul>
        )}
      </form>
    </div>
  );
}

/** Estimated prompt volume for the topics, as one horizontal bar each. Hover a bar for its number. */
function VolumeChart({ topics }: { topics: TopicPick[] }) {
  const max = Math.max(1, ...topics.map((t) => t.volume ?? 0));
  return (
    <figure className="aw-vchart" aria-label="Estimated monthly prompt volume per topic">
      <figcaption className="aw-vchart__title">
        Estimated prompt volume
        <span>AI assistants, per month</span>
      </figcaption>
      <ol>
        {topics.map((t, i) => (
          <li key={i} className={t.on ? "" : "is-off"} tabIndex={0} data-tip={`${t.topic}: ${t.volume === null ? "no data yet" : `about ${fmt(t.volume)} prompts a month`}`}>
            <span className="aw-vchart__label">
              <b>{String(i + 1).padStart(2, "0")}</b>
              {t.topic}
            </span>
            <span className="aw-vchart__track">
              <i style={{ width: `${Math.max(2, ((t.volume ?? 0) / max) * 100)}%` }} />
            </span>
            <span className="aw-vchart__num">{fmt(t.volume)}</span>
          </li>
        ))}
      </ol>
      <table className="sr-only">
        <thead>
          <tr>
            <th>Topic</th>
            <th>Estimated prompts a month</th>
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

function TopicsStep({ name, logo, topics, setTopics, onBack, onNext, quick }: { name: string; logo: string; topics: TopicPick[]; setTopics: (t: TopicPick[]) => void; onBack: () => void; onNext: () => void; quick?: Quick }) {
  const on = topics.filter((t) => t.on).length;
  const card = (t: TopicPick, i: number) => (
    <li key={i} className={`aw-topic ${t.on ? "" : "is-off"}`}>
      <span className="aw-topic__rank">{String(i + 1).padStart(2, "0")}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <input aria-label="Topic" value={t.topic} onChange={(e) => setTopics(topics.map((x, j) => (j === i ? { ...x, topic: e.target.value } : x)))} className="aw-topic__name" />
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="aw-conv">High conversion potential</span>
          <span className="aw-chip">{bucketLabel(t.bucket)}</span>
        </span>
        {t.reason ? <p className="text-[13px] text-muted">{t.reason}</p> : null}
      </div>
      <span className="aw-topic__est" title="Estimated prompts a month on AI assistants">
        <b>{fmt(t.volume)}</b>
        <span>est. prompts / mo</span>
      </span>
      <input type="checkbox" aria-label={`Track ${t.topic}`} checked={t.on} onChange={(e) => setTopics(topics.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} className="h-5 w-5 shrink-0 accent-[#0943B0]" />
    </li>
  );
  return (
    <>
      <div className="flex items-center gap-3">
        {logo ? <BrandLogo src={logo} name={name} size={36} /> : null}
        <StepHead n={1} kicker={name || "Topics"} title="The buying topics worth tracking">
          Ranked by how much they matter to you. Tick the ones to track.
        </StepHead>
      </div>

      <div className="aw-topics">
        <div className="flex flex-col gap-3">
          <section className="flex flex-col gap-2">
            <h2 className="aw-onb__group">Highly recommended</h2>
            <ol className="flex flex-col gap-2">{topics.slice(0, RECOMMENDED).map((t, i) => card(t, i))}</ol>
          </section>
          {topics.length > RECOMMENDED ? (
            <section className="flex flex-col gap-2">
              <h2 className="aw-onb__group">Suggested</h2>
              <ol className="flex flex-col gap-2">{topics.slice(RECOMMENDED).map((t, i) => card(t, i + RECOMMENDED))}</ol>
            </section>
          ) : null}
        </div>
        <VolumeChart topics={topics} />
      </div>

      <Footer onBack={onBack} next="Write my prompts" onNext={onNext} disabled={!on} note={`${on} of ${topics.length} topics`} quick={quick} />
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
  return { left: `${prompts} prompts × ${daily.length} AI engines`, right: `${(prompts * daily.length).toLocaleString("en-US")} answers ${per}${weekly.length ? `, plus ${weekly.join(" and ")} weekly` : ""}` };
}

function PromptsStep(p: { plan: PlanTopic[]; setPlan: (v: PlanTopic[]) => void; used: number; cap: number; engines: string[]; checkEvery: number; onBack: () => void; onNext: () => void }) {
  const [edit, setEdit] = useState(false);
  const set = (ti: number, pi: number, x: Partial<PromptPick>) => p.setPlan(p.plan.map((t, i) => (i === ti ? { ...t, prompts: t.prompts.map((y, j) => (j === pi ? { ...y, ...x } : y)) } : t)));
  const cost = costLine(p.used, p.engines, p.checkEvery);
  return (
    <>
      <StepHead n={2} kicker="Prompts" title="Prompts we will ask AI">
        {edit ? "Eight prompts per topic, each from a different buyer angle. The first 5 are highly recommended." : "The highly recommended prompts for each topic."}{" "}
        <button type="button" className="aw-text-link" onClick={() => setEdit(!edit)}>
          {edit ? "Show the short list" : "Edit prompts"}
        </button>
      </StepHead>
      {cost ? (
        <div className="aw-cost">
          <b>{cost.left}</b>
          <span aria-hidden="true">=</span>
          <b className="text-brand">{cost.right}</b>
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
                  <th className="w-44">Pick</th>
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
                    <td className="text-[12px]! text-muted!">{pi < RECOMMENDED ? "Highly recommended" : "Suggested"}</td>
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
        <p className="text-[16px] text-body">Open the Content Plan and click Build to plan 12 weeks of revenue-driven content.</p>
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
        {seo ? "Open the Content Plan" : "Go to my dashboard"} →
      </button>
    </section>
  );
}
