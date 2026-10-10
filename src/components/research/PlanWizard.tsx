"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";
import { saveSite, type Site } from "@/lib/db";
import { FORMATS, GOALS, stageCounts, type PlanBrief } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { AiIcon, SidePanel } from "../ui";
import { FIELD, post } from "./shared";

const today = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const STEPS = ["Goal", "Audience", "Shape", "Schedule"] as const;

/** A short set of questions, then the planner builds a content plan from the answers. */
export function PlanWizard({ sb, auth, site, onSite, onStarted, onClose }: { sb: SupabaseClient; auth: RunAuth; site: Site; onSite: (s: Site) => void; onStarted: () => void; onClose: () => void }) {
  const last = site.profile.planBrief ?? {};
  const [b, setB] = useState<PlanBrief>({
    goal: "leads",
    funnel: "bofu",
    size: 120,
    difficulty: "mixed",
    formats: ["Blog posts", "Comparisons", "How-to guides"],
    focus: site.profile.products ?? "",
    audience: site.profile.customers ?? "",
    avoid: "",
    rivals: "",
    updates: true,
    perWeek: 2,
    ...last,
    start: today(),
  });
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (p: Partial<PlanBrief>) => setB({ ...b, ...p });
  const counts = stageCounts(b);

  async function build() {
    setBusy(true);
    setError("");
    try {
      await post<{ id: string }>(auth, "/api/research/agentic", { siteId: site.id, brief: b });
      const next = { ...site, profile: { ...site.profile, planBrief: b } };
      saveSite(sb, next).then(() => onSite(next)).catch(() => {});
      onStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const choice = <T extends string | number>(value: T | undefined, options: { id: T; label: string; sub?: string }[], pick: (v: T) => void, label: string) => (
    <div role="radiogroup" aria-label={label} className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => pick(o.id)}
          className={`flex flex-col gap-0.5 border px-4 py-3 text-left ${value === o.id ? "border-brand bg-brand-pale" : "border-rule bg-white hover:border-ink"}`}
        >
          <span className="text-[15px] font-medium text-ink">{o.label}</span>
          {o.sub ? <span className="text-[13px] text-muted">{o.sub}</span> : null}
        </button>
      ))}
    </div>
  );
  const q = (title: string, body: React.ReactNode) => (
    <div className="flex flex-col gap-2.5">
      <span className="text-[16px] font-medium text-ink">{title}</span>
      {body}
    </div>
  );
  const area = (value: string | undefined, onChange: (v: string) => void, placeholder: string, label: string) => (
    <textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} rows={2} className="aw-input resize-y text-[14px]!" />
  );

  return (
    <SidePanel title="New content plan" kicker={site.domain} onClose={onClose}>
      <ol className="flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={i === step ? "step" : undefined}
              className={`flex items-center gap-2 border px-3 py-1.5 text-[14px] ${i === step ? "border-ink bg-ink text-white" : i < step ? "border-rule bg-white text-ink" : "border-rule bg-white text-muted"}`}
            >
              <span className="aw-num">{i < step ? "✓" : i + 1}</span>
              {s}
            </button>
          </li>
        ))}
      </ol>

      <div className="flex max-w-3xl flex-col gap-7">
        {step === 0 ? (
          <>
            {q("What should this content do?", choice(b.goal, (Object.keys(GOALS) as (keyof typeof GOALS)[]).map((id) => ({ id, label: GOALS[id] })), (goal) => set({ goal }), "Goal"))}
            {q(
              "Where in the funnel?",
              choice(
                b.funnel,
                [
                  { id: "bofu", label: "Ready to buy", sub: "Pricing, best-of, alternatives" },
                  { id: "balanced", label: "Balanced", sub: "Even mix of every stage" },
                  { id: "mofu", label: "Comparing", sub: "Versus, reviews, use cases" },
                  { id: "tofu", label: "Learning", sub: "Guides, how-tos, explainers" },
                ],
                (funnel) => set({ funnel }),
                "Funnel",
              ),
            )}
          </>
        ) : step === 1 ? (
          <>
            {q("Which products, services or topics come first?", area(b.focus, (focus) => set({ focus }), "CRM for dentists, patient reminders, online booking", "Focus"))}
            {q("Who is it for?", area(b.audience, (audience) => set({ audience }), "Owners of small dental clinics in the US", "Audience"))}
            {q("Anything to stay away from?", area(b.avoid, (avoid) => set({ avoid }), "Medical advice, hiring, our old product names", "Avoid"))}
            {q("Competitors to learn from", <input value={b.rivals ?? ""} onChange={(e) => set({ rivals: e.target.value })} placeholder="rival.com, other.io" aria-label="Competitors" className="aw-input text-[14px]!" />)}
          </>
        ) : step === 2 ? (
          <>
            {q(
              "How hard should we aim?",
              choice(
                b.difficulty,
                [
                  { id: "easy", label: "Quick wins", sub: "Low difficulty only" },
                  { id: "mixed", label: "Mixed", sub: "Mostly winnable, some reach" },
                  { id: "hard", label: "Go big", sub: "Include the head terms" },
                ],
                (difficulty) => set({ difficulty }),
                "Difficulty",
              ),
            )}
            {q(
              "Formats",
              <div className="flex flex-wrap gap-2">
                {FORMATS.map((f) => {
                  const on = b.formats?.includes(f) ?? false;
                  return (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set({ formats: on ? (b.formats ?? []).filter((x) => x !== f) : [...(b.formats ?? []), f] })}
                      className={`border px-3 py-1.5 text-[14px] ${on ? "border-brand bg-brand-pale text-ink" : "border-rule bg-white text-body hover:border-ink"}`}
                    >
                      {on ? "✓ " : ""}
                      {f}
                    </button>
                  );
                })}
              </div>,
            )}
            {q(
              "Refresh pages you already have?",
              choice(
                b.updates ? "yes" : "no",
                [
                  { id: "yes", label: "Yes", sub: "Include pages stuck below the top 10" },
                  { id: "no", label: "No", sub: "New pages only" },
                ],
                (v) => set({ updates: v === "yes" }),
                "Updates",
              ),
            )}
          </>
        ) : (
          <>
            {q(
              "How often will you publish?",
              <div className="flex flex-wrap items-end gap-4">
                <label className="flex flex-col gap-1">
                  <span className="aw-label">Posts per week</span>
                  <select value={b.perWeek} onChange={(e) => set({ perWeek: Number(e.target.value) })} className={FIELD}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="aw-label">Starting</span>
                  <input type="date" value={b.start} onChange={(e) => set({ start: e.target.value })} className={FIELD} />
                </label>
              </div>,
            )}
            <section className="aw-frame">
              <div className="aw-frame__head">
                <h3 className="aw-h4">Your plan</h3>
              </div>
              <dl className="grid gap-x-6 gap-y-2 p-5 text-[14px] sm:grid-cols-[160px_1fr]">
                <dt className="text-muted">Goal</dt>
                <dd className="text-ink">{b.goal ? GOALS[b.goal] : "–"}</dd>
                <dt className="text-muted">Keywords</dt>
                <dd className="aw-num text-ink">
                  {b.size} · BOFU {counts.bofu} · MOFU {counts.mofu} · TOFU {counts.tofu}
                </dd>
                <dt className="text-muted">Focus</dt>
                <dd className="text-ink">{b.focus || "–"}</dd>
                <dt className="text-muted">Audience</dt>
                <dd className="text-ink">{b.audience || "–"}</dd>
                <dt className="text-muted">Formats</dt>
                <dd className="text-ink">{b.formats?.join(", ") || "–"}</dd>
                <dt className="text-muted">Schedule</dt>
                <dd className="text-ink">
                  {b.perWeek} a week from {b.start}
                </dd>
              </dl>
            </section>
          </>
        )}

        {error ? <p className="aw-error">{error}</p> : null}
        <div className="flex items-center gap-3 border-t border-rule pt-5">
          {step > 0 ? (
            <button type="button" className="aw-btn aw-btn--secondary" onClick={() => setStep(step - 1)}>
              Back
            </button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <button type="button" className="aw-btn aw-btn--primary" onClick={() => setStep(step + 1)}>
              Next
            </button>
          ) : (
            <button type="button" className="aw-btn aw-btn--accent" onClick={build} disabled={busy}>
              <AiIcon />
              {busy ? "Starting..." : "Build my Topic Bank"}
            </button>
          )}
        </div>
      </div>
    </SidePanel>
  );
}
