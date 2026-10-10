"use client";

import { useState } from "react";
import { flatPrompts, type Brand, type BrandCard, type Profile, type RivalCard, type Topic } from "@/lib/db";
import { ANGLES, BUSINESS_TYPES, COUNTRIES, MAX_PROMPTS, MAX_TOPICS, type Angle, type PickedTopic, type TopicRole } from "@/lib/onboarding";
import type { RunAuth } from "@/lib/runner";
import { BrandLogo } from "./BrandLogo";
import { Logo } from "./Logo";
import { Thinking } from "./ui";

export type NewBrand = Omit<Brand, "id" | "workspace_id" | "daily">;
type Step = "site" | "brand" | "market" | "topics" | "prompts";
type TopicPick = PickedTopic & { on: boolean };
type PromptPick = { text: string; angle: Angle; on: boolean };

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

export const ROLES: Record<TopicRole, { label: string; about: string }> = {
  core: { label: "Core", about: "Your home ground, where your difference wins" },
  contested: { label: "Contested", about: "A large shared category with strong players" },
  conquest: { label: "Conquest", about: "Buyers looking to leave a competitor" },
};
const angleLabel = (a: Angle) => ANGLES.find((x) => x.id === a)?.label ?? a;
const PRICES = ["budget", "mid", "premium"] as const;

/** Website, then the Brand Card, the market, the topics and the prompts. */
export function Onboarding({
  auth,
  onDone,
  onCancel,
  importCount,
  onImport,
  promptRoom = MAX_PROMPTS,
  seo = false,
}: {
  seo?: boolean; // Starter on Organic Research: no prompts to set up
  promptRoom?: number; // prompts the workspace's plan still has room for
  auth: RunAuth;
  onDone: (b: NewBrand) => Promise<void>;
  onCancel?: () => void;
  importCount: number;
  onImport: () => Promise<void>;
}) {
  const [step, setStep] = useState<Step>("site");
  const [seen, setSeen] = useState<Set<Step>>(new Set(["site"]));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [website, setWebsite] = useState("");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [url, setUrl] = useState("");
  const [logo, setLogo] = useState("");
  const [profile, setProfile] = useState<Profile>({ businessType: undefined, country: "United States" });
  const [topics, setTopics] = useState<TopicPick[]>([]);
  const [candidates, setCandidates] = useState(0);
  const [plan, setPlan] = useState<{ name: string; prompts: PromptPick[] }[]>([]);
  const cap = Math.max(1, Math.min(MAX_PROMPTS, promptRoom));

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
  const brandBody = () => ({ name, domain, profile });
  const chosen = topics.filter((t) => t.on);
  const used = plan.reduce((n, t) => n + t.prompts.filter((p) => p.on).length, 0);

  const readSite = (e: React.FormEvent) => {
    e.preventDefault();
    run("Researching your brand and its market...", async () => {
      const d = await call("/api/onboard", auth, { website });
      setName(d.name);
      setDomain(d.domain);
      setUrl(d.url);
      setLogo(d.logo);
      setProfile(d.profile);
      go("brand");
    });
  };
  const makeTopics = () =>
    run("Scoring 50 topics on volume, relevance and diversity...", async () => {
      const d = await call("/api/topics", auth, brandBody());
      setTopics((d.topics as PickedTopic[]).map((t) => ({ ...t, on: true })));
      setCandidates(d.candidates ?? 0);
      go("topics");
    });
  const makePrompts = () =>
    run("Writing prompts from every angle...", async () => {
      const d = await call("/api/prompts", auth, { ...brandBody(), topics: chosen.map((t) => t.topic) });
      const list = d.topics as { name: string; prompts: { text: string; angle: Angle }[] }[];
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
      setPlan(list.map((t, ti) => ({ name: t.name, prompts: t.prompts.map((p, pi) => ({ ...p, on: on[ti][pi] })) })));
      go("prompts");
    });
  const finish = () =>
    run(seo ? "Setting up your brand..." : "Setting up your brand and starting the first check...", async () => {
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
  const at = steps.findIndex((s) => s.id === step);

  return (
    <main className="aw-onb flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-white/95 px-5 py-3 backdrop-blur">
        <Logo size="sm" />
        {step !== "site" ? (
          <ol className="aw-steps" aria-label="Steps">
            {steps.map((s, i) => (
              <li key={s.id} className={`aw-steps__item ${i === at ? "is-on" : i < at ? "is-done" : ""}`}>
                <button type="button" disabled={!seen.has(s.id) || Boolean(busy)} onClick={() => go(s.id)} aria-current={i === at ? "step" : undefined}>
                  <span className="aw-steps__dot">{i < at ? "✓" : i + 1}</span>
                  <span className="aw-steps__label">{s.label}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : null}
        <div className="flex items-center gap-3">
          {onCancel ? (
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
        {error ? <p className="aw-error">{error}</p> : null}
        {busy ? (
          <div className="mx-auto w-full max-w-2xl">
            <Thinking text={busy} />
            <p className="aw-small mt-3 text-center">This takes about a minute. Keep this tab open.</p>
          </div>
        ) : null}

        {step === "site" && !busy ? (
          <SiteStep seo={seo} website={website} setWebsite={setWebsite} onSubmit={readSite} importCount={importCount} onImport={onImport} onManual={() => go("brand")} />
        ) : null}

        {step === "brand" && !busy ? (
          <BrandStep name={name} setName={setName} domain={domain} setDomain={setDomain} logo={logo} profile={profile} setProfile={setProfile} onNext={() => go("market")} />
        ) : null}

        {step === "market" && !busy ? (
          <MarketStep
            name={name}
            logo={logo}
            profile={profile}
            setProfile={setProfile}
            onBack={() => go("brand")}
            next={seo ? "Finish setup" : "Find my topics"}
            onNext={seo ? finish : makeTopics}
          />
        ) : null}

        {step === "topics" && !busy ? <TopicsStep topics={topics} setTopics={setTopics} candidates={candidates} onBack={() => go("market")} onNext={makePrompts} /> : null}

        {step === "prompts" && !busy ? <PromptsStep plan={plan} setPlan={setPlan} used={used} cap={cap} onBack={() => go("topics")} onNext={finish} /> : null}
      </div>
    </main>
  );
}

// ─────────────────────────────── steps ───────────────────────────────

function StepHead({ n, kicker, title, children }: { n?: number; kicker: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="aw-onb__kicker">
        {n ? <b>{String(n).padStart(2, "0")}</b> : null}
        {kicker}
      </span>
      <h1 className="aw-h2 mb-0!">{title}</h1>
      {children ? <p className="max-w-2xl text-[16px] text-body">{children}</p> : null}
    </div>
  );
}

function Footer({ onBack, next, onNext, disabled, note }: { onBack?: () => void; next: string; onNext: () => void; disabled?: boolean; note?: React.ReactNode }) {
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

/** One quadrant of the Brand Card. Click Edit to change the bullets, one per line. */
function Quadrant({ q, items, onChange }: { q: (typeof QUADRANTS)[number]; items: string[]; onChange: (v: string[]) => void }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState("");
  return (
    <section className={`aw-quad aw-quad--${q.k}`}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <span className="aw-quad__label">
            <i aria-hidden="true">{q.glyph}</i>
            {q.label}
          </span>
          <p className="aw-quad__ask">{q.ask}</p>
        </div>
        <button
          type="button"
          className="aw-text-link text-[13px]"
          onClick={() => {
            if (edit) onChange(draft.split("\n").map((x) => x.replace(/^[-•*]\s*/, "").trim()).filter(Boolean));
            else setDraft(items.join("\n"));
            setEdit(!edit);
          }}
        >
          {edit ? "Done" : "Edit"}
        </button>
      </header>
      {edit ? (
        <textarea autoFocus rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} className="aw-textarea text-[14px]!" aria-label={`${q.label}, one point per line`} />
      ) : items.length ? (
        <ul className="aw-quad__list">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      ) : (
        <p className="aw-small">Nothing yet. Click Edit to add points.</p>
      )}
    </section>
  );
}

function BrandStep(p: {
  name: string;
  setName: (v: string) => void;
  domain: string;
  setDomain: (v: string) => void;
  logo: string;
  profile: Profile;
  setProfile: (v: Profile) => void;
  onNext: () => void;
}) {
  const card: BrandCard = p.profile.card ?? { who: [], whereTo: [], howTo: [], whySo: [] };
  const ok = Boolean(p.name.trim() && p.domain.trim() && p.profile.businessType);
  return (
    <>
      <StepHead n={1} kicker="Brand Card" title="Here is how we read your brand">
        Four views of your business. Fix anything that is off, since the topics and prompts build on it.
      </StepHead>

      <div className="aw-frame aw-onb__id">
        {p.logo ? <BrandLogo src={p.logo} name={p.name || "?"} size={44} /> : <span className="aw-onb__mono">{(p.name || "?").slice(0, 1).toUpperCase()}</span>}
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="aw-label mb-0!">Brand name</span>
            <input value={p.name} onChange={(e) => p.setName(e.target.value)} placeholder="eg. Poedit" required className="aw-input" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="aw-label mb-0!">Website</span>
            <input value={p.domain} onChange={(e) => p.setDomain(e.target.value)} placeholder="eg. poedit.net" required className="aw-input" />
          </label>
        </div>
      </div>

      <div className="aw-quads">
        {QUADRANTS.map((q) => (
          <Quadrant key={q.k} q={q} items={card[q.k]} onChange={(v) => p.setProfile({ ...p.profile, card: { ...card, [q.k]: v } })} />
        ))}
        <span className="aw-quads__core" aria-hidden="true">
          {p.logo ? <BrandLogo src={p.logo} name={p.name || "?"} size={28} /> : "✦"}
        </span>
      </div>

      <details className="aw-frame aw-onb__details" open={!p.profile.card}>
        <summary>
          <span>
            <span className="aw-h4">Business details</span>
            <span className="aw-small ml-2">Type, market and the words your customers use</span>
          </span>
          <span aria-hidden="true">▾</span>
        </summary>
        <div className="flex flex-col gap-5 border-t border-rule-faint p-5 sm:p-6">
          <fieldset>
            <legend className="aw-label mb-1!">Business type</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {BUSINESS_TYPES.map((t) => (
                <label
                  key={t.id}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-aw border px-3 py-2.5 text-[14px] font-medium ${p.profile.businessType === t.id ? "border-brand bg-brand-pale text-brand" : "border-rule bg-white text-ink hover:border-brand-mist"}`}
                >
                  <input type="radio" name="btype" checked={p.profile.businessType === t.id} onChange={() => p.setProfile({ ...p.profile, businessType: t.id })} className="h-4 w-4 accent-[#0943B0]" />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                { k: "products", label: "Products and services", ph: "eg. PO editor, translation memory" },
                { k: "customers", label: "Customers", ph: "eg. developers, translators" },
                { k: "features", label: "Key features", ph: "eg. pre-translation, QA checks" },
              ] as const
            ).map((f) => (
              <label key={f.k} className="flex flex-col gap-1">
                <span className="aw-label mb-0!">{f.label}</span>
                <textarea rows={3} value={p.profile[f.k] ?? ""} onChange={(e) => p.setProfile({ ...p.profile, [f.k]: e.target.value })} placeholder={f.ph} className="aw-textarea" />
              </label>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className="aw-label mb-0!">Market</span>
            <select value={p.profile.country ?? "United States"} onChange={(e) => p.setProfile({ ...p.profile, country: e.target.value })} className="aw-select w-56">
              {COUNTRIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
      </details>

      <Footer next="See my market" onNext={p.onNext} disabled={!ok} note={!p.profile.businessType ? "Pick a business type first" : undefined} />
    </>
  );
}

function MarketStep(p: { name: string; logo: string; profile: Profile; setProfile: (v: Profile) => void; onBack: () => void; next: string; onNext: () => void }) {
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
                      rows={3}
                      value={r.difference}
                      onChange={(e) => setRivals(rivals.map((x, j) => (j === i ? { ...x, difference: e.target.value } : x)))}
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

      <Footer onBack={p.onBack} next={p.next} onNext={p.onNext} />
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

function TopicsStep({ topics, setTopics, candidates, onBack, onNext }: { topics: TopicPick[]; setTopics: (t: TopicPick[]) => void; candidates: number; onBack: () => void; onNext: () => void }) {
  const [draft, setDraft] = useState("");
  const max = Math.max(1, ...topics.map((t) => t.volume ?? 0));
  const on = topics.filter((t) => t.on).length;
  return (
    <>
      <StepHead n={3} kicker="Topics" title="The 5 topics worth tracking">
        {candidates ? `We wrote ${candidates} buying categories, checked Google volume for each, and kept the best 5.` : "The buying categories your customers ask AI about."}
      </StepHead>

      <div className="aw-formula" aria-label="How topics are scored">
        <span className="aw-formula__term">
          <b>Volume</b>
          How many people search it
        </span>
        <span className="aw-formula__op">×</span>
        <span className="aw-formula__term">
          <b>Relevance</b>
          How well it fits your difference
        </span>
        <span className="aw-formula__op">×</span>
        <span className="aw-formula__term">
          <b>Diversity</b>
          Each topic covers a new kind of buyer
        </span>
      </div>

      <ol className="flex flex-col gap-3">
        {topics.map((t, i) => (
          <li key={i} className={`aw-topic ${t.on ? "" : "is-off"}`}>
            <span className="aw-topic__rank">{String(i + 1).padStart(2, "0")}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label="Topic"
                  value={t.topic}
                  onChange={(e) => setTopics(topics.map((x, j) => (j === i ? { ...x, topic: e.target.value } : x)))}
                  className="aw-topic__name"
                />
                <span className={`aw-role aw-role--${t.role}`} title={ROLES[t.role].about}>
                  {ROLES[t.role].label}
                </span>
              </div>
              {t.reason ? <p className="aw-small">{t.reason}</p> : null}
              {t.buyer ? <p className="text-[13px] text-muted">Buyer: {t.buyer}</p> : null}
            </div>
            <div className="aw-topic__vol">
              <span className="aw-topic__num">{t.volume === null ? "–" : t.volume.toLocaleString("en-US")}</span>
              <span className="text-[12px] text-muted">searches / mo</span>
              <span className="aw-topic__bar" aria-hidden="true">
                <i style={{ width: `${Math.max(4, ((t.volume ?? 0) / max) * 100)}%` }} />
              </span>
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

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = draft.trim().toLowerCase();
          if (!v) return;
          setTopics([...topics, { topic: v, role: "core", relevance: 5, buyer: "", reason: "Added by you", volume: null, score: 0, on: on < MAX_TOPICS }]);
          setDraft("");
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add your own topic, like: best desktop po editor" className="aw-input" />
        <button type="submit" className="aw-btn aw-btn--secondary" disabled={!draft.trim()}>
          Add
        </button>
      </form>

      <dl className="aw-roles">
        {(Object.keys(ROLES) as TopicRole[]).map((r) => (
          <div key={r}>
            <dt>
              <span className={`aw-role aw-role--${r}`}>{ROLES[r].label}</span>
            </dt>
            <dd>{ROLES[r].about}</dd>
          </div>
        ))}
      </dl>

      <Footer onBack={onBack} next="Write my prompts" onNext={onNext} disabled={!on || on > MAX_TOPICS} note={`${on} of ${MAX_TOPICS} topics`} />
    </>
  );
}

function PromptsStep(p: { plan: { name: string; prompts: PromptPick[] }[]; setPlan: (v: { name: string; prompts: PromptPick[] }[]) => void; used: number; cap: number; onBack: () => void; onNext: () => void }) {
  const set = (ti: number, pi: number, x: Partial<PromptPick>) => p.setPlan(p.plan.map((t, i) => (i === ti ? { ...t, prompts: t.prompts.map((y, j) => (j === pi ? { ...y, ...x } : y)) } : t)));
  return (
    <>
      <StepHead n={4} kicker="Prompts" title="Prompts we will ask AI every day">
        Ten recommended prompts per topic, each from a different angle. The top 5 are ticked. Tick any others you want to track.
      </StepHead>
      {p.used > p.cap ? <p className="aw-error">You picked {p.used} prompts. Your plan allows {p.cap}. Untick some to continue.</p> : null}

      {p.plan.map((t, ti) => {
        const n = t.prompts.filter((x) => x.on).length;
        return (
          <section key={t.name} className="aw-table-wrap rounded-aw-lg">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-surface-2 px-5 py-3">
              <span className="flex items-center gap-3">
                <span className="aw-topic__rank aw-topic__rank--sm">{String(ti + 1).padStart(2, "0")}</span>
                <span className="aw-h4">{t.name}</span>
              </span>
              <span className="aw-small">{n} tracked</span>
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
        );
      })}

      <Footer onBack={p.onBack} next="Start tracking" onNext={p.onNext} disabled={!p.used || p.used > p.cap} note={`${p.used} of ${p.cap} prompts`} />
    </>
  );
}
