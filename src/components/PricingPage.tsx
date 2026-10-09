"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { PLANS, SELF_SERVE, UNLIMITED, type Interval, type Plan } from "@/lib/plans";
import { SALES } from "./BillingPage";
import { BrandLogo } from "./BrandLogo";
import { Logo } from "./Logo";
import { AIS, IntervalSwitch, LogoStack, PlanGrid } from "./PlanGrid";

const n = (v: number) => (v >= UNLIMITED ? "Unlimited" : v.toLocaleString("en-US"));
const yes = (on: boolean) => (on ? "✓" : "–");

const ROWS: { group: string; rows: { label: React.ReactNode; value: (p: Plan) => string }[] }[] = [
  {
    group: "AI visibility",
    rows: [
      { label: "Prompts", value: (p) => n(p.prompts) },
      { label: "Checks", value: (p) => (p.checkEvery === 1 ? "Daily" : "Weekly") },
      {
        label: (
          <span className="flex items-center gap-2">
            AIs tracked <LogoStack size={16} />
          </span>
        ),
        value: () => "6",
      },
      { label: "Brands", value: (p) => n(p.brands) },
      { label: "Seats", value: (p) => n(p.seats) },
      { label: "Competitors per brand", value: (p) => n(p.competitors) },
      { label: "History", value: (p) => (p.historyDays >= 365 ? `${Math.round(p.historyDays / 365)} yr` : `${p.historyDays} days`) },
      { label: "On-demand checks a day", value: (p) => n(p.checkNowPerDay) },
    ],
  },
  {
    group: "SEO & content",
    rows: [
      { label: "Keyword & Website Research a month", value: (p) => (p.researchPerMonth ? n(p.researchPerMonth) : "–") },
      { label: "Content briefs a month", value: (p) => (p.briefsPerMonth ? n(p.briefsPerMonth) : "–") },
      { label: "Content plans a month", value: (p) => (p.plansPerMonth ? n(p.plansPerMonth) : "–") },
      { label: "Agentic Writer", value: (p) => yes(p.writer === "full") },
      { label: "Editorial Calendar & Topic Bank", value: (p) => yes(p.briefsPerMonth > 0) },
    ],
  },
  {
    group: "Reports & data",
    rows: [
      { label: "Live report links", value: () => "✓" },
      { label: "8 report templates", value: (p) => yes(p.reports === "templates" || p.reports === "whitelabel") },
      { label: "White-label reports", value: (p) => yes(p.reports === "whitelabel") },
      { label: "Google Analytics 4", value: () => "✓" },
      { label: "CSV export", value: () => "✓" },
      { label: "Slack, Zapier & API", value: (p) => yes(p.alerts) },
    ],
  },
];

const FAQ: { q: string; a: string }[] = [
  { q: "What is a prompt?", a: "A question people ask AI, like “best CRM for startups”. We ask it to every AI and record whether your brand is named, in what spot, next to which competitors, and which sources the AI used." },
  { q: "Which AIs do you track?", a: "ChatGPT, Claude, Gemini, Perplexity, Google AI Overviews and Google AI Mode. Every plan tracks all six." },
  { q: "Do my brands share prompts?", a: "Yes. Your prompts are one pool for the whole workspace. Add as many brands as you like and split the prompts between them." },
  { q: "Weekly or daily checks?", a: "AI answers change all the time. Weekly checks show the trend. Daily checks catch a drop the day it happens, which matters when you are shipping content to win a prompt." },
  { q: "What happens after the free trial?", a: "Your workspace turns read-only until you pick a plan. Nothing is deleted. No card is needed to start." },
  { q: "Can I change plans later?", a: "Any time. Upgrades start right away and you only pay the difference. Downgrades credit what is left of your month." },
];

/** The public pricing page. */
export function PricingPage() {
  const [cycle, setCycle] = useState<Interval>("month");
  const trial = (primary: boolean) => (
    <Link href="/" className={`aw-btn aw-btn--block ${primary ? "aw-btn--primary" : "aw-btn--secondary"}`}>
      Start free trial
    </Link>
  );
  return (
    <main className="min-h-screen bg-paper">
      <div className="bg-[radial-gradient(1200px_500px_at_50%_-120px,var(--aw-brand-pale),transparent)]">
        <header className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-6 sm:px-8">
          <Link href="/" aria-label="Arrowsterr home">
            <Logo size="sm" />
          </Link>
          <nav className="flex items-center gap-2">
            <Link href="/" className="aw-btn aw-btn--secondary aw-btn--sm">
              Sign in
            </Link>
            <Link href="/" className="aw-btn aw-btn--primary aw-btn--sm hidden sm:inline-flex">
              Start free trial
            </Link>
          </nav>
        </header>

        <section className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-4 pt-10 pb-12 text-center sm:px-8">
          <span className="aw-chip aw-chip--brand">Pricing</span>
          <h1 className="aw-display mb-0!">Be the brand AI recommends</h1>
          <p className="aw-lede max-w-2xl">See where ChatGPT, Claude, Gemini, Perplexity and Google AI name you, who they name instead, and what to publish to win. 14-day free trial, no card.</p>
          <ul className="flex flex-wrap justify-center gap-2">
            {AIS.map((a) => (
              <li key={a.name} className="flex items-center gap-2 rounded-full border border-rule bg-white py-1.5 pr-3.5 pl-1.5 text-[13px] font-medium text-ink shadow-aw-sm">
                <BrandLogo src={a.logo} name={a.name} size={22} />
                {a.name}
              </li>
            ))}
          </ul>
          <IntervalSwitch value={cycle} onChange={setCycle} />
        </section>
      </div>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-8">
        <PlanGrid
          interval={cycle}
          action={(id) =>
            id === "enterprise" ? (
              <a href={SALES} className="aw-btn aw-btn--block bg-white! text-ink!">
                Talk to us
              </a>
            ) : (
              trial(id === "scale")
            )
          }
        />
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-8">
        <h2 className="aw-h2 mb-6! text-center">Compare plans</h2>
        <div className="overflow-x-auto rounded-[20px] border border-rule bg-white">
          <table className="w-full min-w-[720px] text-[14px]">
            <thead>
              <tr className="border-b border-rule">
                <th className="w-[34%] p-4 text-left font-medium text-muted" />
                {SELF_SERVE.map((id) => (
                  <th key={id} className={`p-4 text-center ${id === "scale" ? "bg-brand-pale/50" : ""}`}>
                    <span className="block text-[16px] font-medium text-ink">{PLANS[id].name}</span>
                    <span className="aw-num text-[13px] font-normal text-muted">${cycle === "year" ? PLANS[id].annual : PLANS[id].price}/mo</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((g) => (
                <Fragment key={g.group}>
                  <tr>
                    <td colSpan={SELF_SERVE.length + 1} className="bg-surface-2 px-4 py-2.5 text-[12px] font-medium tracking-wide text-muted uppercase">
                      {g.group}
                    </td>
                  </tr>
                  {g.rows.map((r, i) => (
                    <tr key={i} className="border-t border-rule-faint">
                      <td className="p-4 text-body">{r.label}</td>
                      {SELF_SERVE.map((id) => {
                        const v = r.value(PLANS[id]);
                        return (
                          <td key={id} className={`p-4 text-center ${id === "scale" ? "bg-brand-pale/50" : ""} ${v === "✓" ? "text-brand" : v === "–" ? "text-faint" : "aw-num text-ink"}`}>
                            {v}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 pb-20 sm:px-8">
        <h2 className="aw-h2 mb-6! text-center">Questions</h2>
        <div className="aw-faq">
          {FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <div className="aw-faq__a">
                <p>{f.a}</p>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-8">
        <div className="flex flex-col items-center gap-5 rounded-[24px] bg-[linear-gradient(135deg,var(--aw-brand),var(--aw-brand-deep))] px-6 py-14 text-center text-white">
          <LogoStack size={30} />
          <h2 className="text-[32px] leading-tight font-medium text-white sm:text-[40px]">Find out what AI says about you</h2>
          <p className="max-w-xl text-[16px] text-white/80">Your first results in minutes. Free for 14 days.</p>
          <Link href="/" className="aw-btn aw-btn--lg bg-white! text-brand!">
            Start free trial
          </Link>
        </div>
      </section>
    </main>
  );
}
