"use client";

import { useState } from "react";
import { flatPrompts, type Brand, type Profile, type Topic } from "@/lib/db";
import { BUSINESS_TYPES, COUNTRIES, MAX_PROMPTS, MAX_TOPICS } from "@/lib/onboarding";
import type { RunAuth } from "@/lib/runner";
import { BrandLogo } from "./BrandLogo";
import { Logo } from "./Logo";
import { Thinking } from "./ui";

export type NewBrand = Omit<Brand, "id" | "workspace_id" | "daily">;
type Step = "site" | "details" | "topics" | "prompts";
type Pick = { text: string; on: boolean };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

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

/** Website, then business questions, then topics, then prompts. */
export function Onboarding({
  auth,
  onDone,
  onCancel,
  importCount,
  onImport,
  promptRoom = MAX_PROMPTS,
  seo = false,
}: {
  seo?: boolean; // Starter on Organic Research: no prompts to set up, the Topic Bank starts instead
  promptRoom?: number; // prompts the workspace's plan still has room for
  auth: RunAuth;
  onDone: (b: NewBrand) => Promise<void>;
  onCancel?: () => void;
  importCount: number;
  onImport: () => Promise<void>;
}) {
  const [step, setStep] = useState<Step>("site");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [website, setWebsite] = useState("");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [url, setUrl] = useState("");
  const [logo, setLogo] = useState("");
  const [profile, setProfile] = useState<Profile>({ businessType: undefined, country: "United States" });
  const [topics, setTopics] = useState<Pick[]>([]);
  const [newTopic, setNewTopic] = useState("");
  const [plan, setPlan] = useState<{ name: string; prompts: Pick[] }[]>([]);
  const cap = Math.max(1, Math.min(MAX_PROMPTS, promptRoom));
  const [drafts, setDrafts] = useState<Record<number, string>>({});

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
  const brandBody = () => ({ name, domain, profile });
  const chosenTopics = topics.filter((t) => t.on).map((t) => t.text);
  const usedPrompts = plan.reduce((n, t) => n + t.prompts.filter((p) => p.on).length, 0);

  const readSite = (e: React.FormEvent) => {
    e.preventDefault();
    run("Learning about your brand...", async () => {
      const d = await call("/api/onboard", auth, { website });
      setName(d.name);
      setDomain(d.domain);
      setUrl(d.url);
      setLogo(d.logo);
      setProfile(d.profile);
      setStep("details");
    });
  };
  const makeTopics = () =>
    run("Finding the best topics for you...", async () => {
      const d = await call("/api/topics", auth, brandBody());
      setTopics((d.topics as string[]).map((text) => ({ text, on: true })));
      setStep("topics");
    });
  const makePrompts = () =>
    run("Writing prompts for each topic...", async () => {
      const d = await call("/api/prompts", auth, { ...brandBody(), topics: chosenTopics });
      // Keep within the plan's prompt limit, taking prompts from every topic in turn so each topic is covered.
      const list = d.topics as Topic[];
      const on = list.map((t) => t.prompts.map(() => false));
      let left = cap;
      for (let round = 0; left > 0 && list.some((t) => t.prompts.length > round); round++)
        list.forEach((t, ti) => {
          if (left > 0 && round < t.prompts.length) {
            on[ti][round] = true;
            left--;
          }
        });
      setPlan(list.map((t, ti) => ({ name: t.name, prompts: t.prompts.map((text, pi) => ({ text, on: on[ti][pi] })) })));
      setStep("prompts");
    });
  const finish = () =>
    run(seo ? "Setting up your brand and starting your Topic Bank..." : "Setting up your brand...", async () => {
      const final: Topic[] = plan.map((t) => ({ name: t.name, prompts: t.prompts.filter((p) => p.on).map((p) => p.text) })).filter((t) => t.prompts.length);
      const site = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
      await onDone({
        name: name.trim(),
        domain: site,
        url: url || `https://${site}`,
        logo: logo || `https://www.google.com/s2/favicons?domain=${site}&sz=128`,
        category: BUSINESS_TYPES.find((b) => b.id === profile.businessType)?.label ?? "",
        profile,
        topics: final,
        prompts: flatPrompts(final),
      });
    });

  const crumbs: { id: Step; label: string }[] = seo
    ? [{ id: "details", label: name || "Your brand" }]
    : [
        { id: "details", label: name || "Your brand" },
        { id: "topics", label: "Add topics" },
        { id: "prompts", label: "Generate prompts" },
      ];
  const back: Record<Step, Step | null> = { site: null, details: "site", topics: "details", prompts: "topics" };

  return (
    <main className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-white px-5 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <Logo size="sm" />
          {step !== "site" ? (
            <nav aria-label="Steps" className="flex min-w-0 items-center gap-2 text-[14px]">
              <button type="button" className="aw-text-link text-muted!" onClick={() => setStep(back[step]!)}>
                ← Back
              </button>
              {crumbs.map((c, i) => (
                <span key={c.id} className="flex items-center gap-2 whitespace-nowrap">
                  {i ? <span className="text-faint">›</span> : <span className="text-faint">|</span>}
                  <span className={c.id === step ? "font-medium text-ink" : "text-muted"}>{c.label}</span>
                </span>
              ))}
            </nav>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {step === "topics" && !busy ? (
            <>
              <span className="aw-small">
                {chosenTopics.length} of {MAX_TOPICS} topics
              </span>
              <button type="button" className="aw-btn aw-btn--accent" disabled={!chosenTopics.length || Boolean(busy)} onClick={makePrompts}>
                Add prompts
              </button>
            </>
          ) : step === "prompts" ? (
            <>
              <span className="aw-small">
                {usedPrompts} of {cap} prompts used
              </span>
              <button type="button" className="aw-btn aw-btn--accent" disabled={!usedPrompts || usedPrompts > cap || Boolean(busy)} onClick={finish}>
                Start tracking
              </button>
            </>
          ) : null}
          {onCancel ? (
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-8">
        {error ? <p className="aw-error">{error}</p> : null}
        {busy ? <Thinking text={busy} /> : null}

        {step === "site" && !busy ? (
          <>
            {importCount ? (
              <div className="aw-callout flex flex-wrap items-center justify-between gap-3">
                This browser has {importCount} brands from before accounts existed.
                <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onImport}>
                  Import them
                </button>
              </div>
            ) : null}
            <form onSubmit={readSite} className="aw-frame">
              <div className="aw-frame__body flex flex-col gap-5">
                <h1 className="aw-h2">{seo ? "Find the keywords that bring you buyers" : "Track your brand in AI search"}</h1>
                <div>
                  <label className="aw-label" htmlFor="website">
                    Your website
                  </label>
                  <input id="website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="acme.com" required autoFocus className="aw-input aw-input--hero" />
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <button type="submit" className="aw-btn aw-btn--accent aw-btn--lg" disabled={Boolean(busy)}>
                    Continue
                  </button>
                  <button type="button" className="aw-text-link" onClick={() => setStep("details")}>
                    Fill in the details by hand
                  </button>
                </div>
              </div>
            </form>
          </>
        ) : null}

        {step === "details" && !busy ? (
          <form
            className="aw-frame"
            onSubmit={(e) => {
              e.preventDefault();
              if (seo) finish();
              else makeTopics();
            }}
          >
            <div className="aw-frame__body flex flex-col gap-6">
              <div className="flex items-center gap-3">
                {logo ? <BrandLogo src={logo} name={name || "?"} size={36} /> : null}
                <h1 className="aw-h2">Brand details</h1>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="aw-label" htmlFor="b-name">
                    Brand name you want to track
                  </label>
                  <input id="b-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="eg. QuickBooks" required className="aw-input" />
                </div>
                <div>
                  <label className="aw-label" htmlFor="b-domain">
                    Brand website
                  </label>
                  <input id="b-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="eg. quickbooks.intuit.com" required className="aw-input" />
                </div>
              </div>
              {(
                [
                  { k: "products", label: "Your products and services", ph: "eg. Accounting software, bookkeeping software, invoicing app" },
                  { k: "customers", label: "Your customers", ph: "eg. Accountants, bookkeepers, small business owners" },
                  { k: "features", label: "Key features", ph: "eg. Send invoices, track receipts, payroll, mileage tracking" },
                ] as const
              ).map((f) => (
                <div key={f.k}>
                  <label className="aw-label mb-0.5!" htmlFor={`b-${f.k}`}>
                    {f.label}
                  </label>
                  <textarea id={`b-${f.k}`} rows={2} value={profile[f.k] ?? ""} onChange={(e) => setProfile({ ...profile, [f.k]: e.target.value })} placeholder={f.ph} className="aw-textarea" />
                </div>
              ))}
              <fieldset>
                <legend className="aw-label mb-0.5!">Business type</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {BUSINESS_TYPES.map((t) => (
                    <label
                      key={t.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-aw border px-4 py-3 text-[14px] font-medium ${profile.businessType === t.id ? "border-brand bg-brand-pale text-brand" : "border-rule bg-white text-ink hover:border-brand-mist"}`}
                    >
                      <input type="radio" name="btype" checked={profile.businessType === t.id} onChange={() => setProfile({ ...profile, businessType: t.id })} className="h-4 w-4 accent-[#0943B0]" required />
                      {t.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <label className="aw-label" htmlFor="b-country">
                    Market
                  </label>
                  <select id="b-country" value={profile.country ?? "United States"} onChange={(e) => setProfile({ ...profile, country: e.target.value })} className="aw-select w-56">
                    {COUNTRIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="aw-btn aw-btn--accent aw-btn--lg" disabled={Boolean(busy)}>
                  {seo ? "Build my Topic Bank ↗" : "Next ↗"}
                </button>
              </div>
            </div>
          </form>
        ) : null}

        {step === "topics" && !busy ? (
          <section className="flex flex-col gap-3">
            <h1 className="aw-h2">Topics to track</h1>
            <p className="aw-small">
              A topic is a buying category your customers ask AI about. Keep the ones that fit, edit them, or add your own. Next we write prompts for each topic.
            </p>
            <label className="flex items-center gap-3 px-1 text-[14px] text-ink">
              <input
                type="checkbox"
                checked={topics.length > 0 && topics.every((t) => t.on)}
                onChange={(e) => setTopics(topics.map((t) => ({ ...t, on: e.target.checked })))}
                className="h-4 w-4 accent-[#0943B0]"
              />
              {chosenTopics.length} topics selected
            </label>
            {topics.map((t, i) => (
              <div key={i} className="flex items-center gap-3 rounded-aw border border-rule bg-white px-4 py-3 shadow-aw-sm">
                <input
                  type="checkbox"
                  aria-label={`Track ${t.text}`}
                  checked={t.on}
                  onChange={(e) => {
                    if (e.target.checked && chosenTopics.length >= MAX_TOPICS) return;
                    setTopics(topics.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)));
                  }}
                  className="h-4 w-4 accent-[#0943B0]"
                />
                <span className="text-brand" aria-hidden="true">
                  ✦
                </span>
                <input
                  aria-label="Topic"
                  value={t.text}
                  onChange={(e) => setTopics(topics.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                  className="min-w-0 flex-1 bg-transparent py-1 text-[15px] text-ink outline-none focus:border-b focus:border-brand"
                />
                <button type="button" aria-label={`Remove ${t.text}`} className="px-1 text-muted hover:text-neg" onClick={() => setTopics(topics.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            ))}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const v = newTopic.trim();
                if (!v) return;
                setTopics([...topics, { text: v, on: chosenTopics.length < MAX_TOPICS }]);
                setNewTopic("");
              }}
            >
              <input value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="Add topic" className="aw-input" />
              <button type="submit" className="aw-btn aw-btn--secondary" aria-label="Add topic">
                +
              </button>
            </form>
          </section>
        ) : null}

        {step === "prompts" && !busy ? (
          <section className="flex flex-col gap-4">
            <h1 className="aw-h2">Prompts to track</h1>
            <p className="aw-small">
              These are the questions we send to each AI model every day. Keep the ones that fit your brand. You can change them later.
            </p>
            {usedPrompts > cap ? <p className="aw-error">You picked {usedPrompts} prompts. The limit is {cap}. Untick some to continue.</p> : null}
            {plan.map((t, ti) => (
              <details key={t.name} open className="aw-frame">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b border-rule-faint px-5 py-3.5">
                  <span className="text-[15px] text-ink">
                    {t.name} <span className="text-muted">({t.prompts.filter((p) => p.on).length} prompts)</span>
                  </span>
                  <span aria-hidden="true" className="text-muted">
                    ▾
                  </span>
                </summary>
                <ul className="flex flex-col gap-1.5 p-3">
                  {t.prompts.map((p, pi) => (
                    <li key={pi} className="flex items-center gap-3 rounded-aw bg-surface-2 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Track: ${p.text}`}
                        checked={p.on}
                        onChange={(e) => setPlan(plan.map((x, i) => (i === ti ? { ...x, prompts: x.prompts.map((y, j) => (j === pi ? { ...y, on: e.target.checked } : y)) } : x)))}
                        className="h-4 w-4 shrink-0 accent-[#0943B0]"
                      />
                      <input
                        aria-label="Prompt"
                        value={p.text}
                        onChange={(e) => setPlan(plan.map((x, i) => (i === ti ? { ...x, prompts: x.prompts.map((y, j) => (j === pi ? { ...y, text: e.target.value } : y)) } : x)))}
                        className="min-w-0 flex-1 bg-transparent py-0.5 text-[14px] text-ink outline-none"
                      />
                      <button
                        type="button"
                        aria-label={`Remove prompt: ${p.text}`}
                        className="px-1 text-muted hover:text-neg"
                        onClick={() => setPlan(plan.map((x, i) => (i === ti ? { ...x, prompts: x.prompts.filter((_, j) => j !== pi) } : x)))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                  <li>
                    <form
                      className="flex gap-2 pt-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const v = (drafts[ti] ?? "").trim();
                        if (!v) return;
                        setPlan(plan.map((x, i) => (i === ti ? { ...x, prompts: [...x.prompts, { text: v, on: usedPrompts < cap }] } : x)));
                        setDrafts({ ...drafts, [ti]: "" });
                      }}
                    >
                      <input value={drafts[ti] ?? ""} onChange={(e) => setDrafts({ ...drafts, [ti]: e.target.value })} placeholder="+ Add prompt" className="aw-input py-2!" />
                      <button type="submit" className="aw-btn aw-btn--secondary" aria-label="Add prompt">
                        +
                      </button>
                    </form>
                  </li>
                </ul>
              </details>
            ))}
          </section>
        ) : null}
      </div>
    </main>
  );
}
