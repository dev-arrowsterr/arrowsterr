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

const COLS = ["free", ...SELF_SERVE] as const;
const per = (v: number, unit: string) => (v <= 0 ? "–" : v >= UNLIMITED ? "Unlimited" : `${v} ${v === 1 ? unit : `${unit}s`}`);

const ROWS: { group: string; rows: { label: React.ReactNode; value: (p: Plan) => string }[] }[] = [
  {
    group: "AI visibility",
    rows: [
      { label: "Prompts", value: (p) => n(p.prompts) },
      { label: "Checks", value: (p) => (p.checkEvery === 1 ? "Daily (Claude & Perplexity weekly)" : "Weekly") },
      {
        label: (
          <span className="flex items-center gap-2">
            AIs tracked <LogoStack size={16} />
          </span>
        ),
        value: (p) => (p.engines ? p.engines.join(", ").replace("AI Overview", "AI Overviews") : "All 6"),
      },
      { label: "Brands", value: (p) => n(p.brands) },
      { label: "Seats", value: (p) => n(p.seats) },
      { label: "Competitors per brand", value: (p) => n(p.competitors) },
      { label: "History", value: (p) => (p.historyDays >= 365 ? `${Math.round(p.historyDays / 365)} yr` : `${p.historyDays} days`) },
      { label: "On-demand checks a day", value: (p) => (p.checkNowPerDay ? n(p.checkNowPerDay) : "–") },
      { label: "Sources, Competitors & Prompts", value: () => "✓" },
      { label: "Social listening", value: (p) => (p.listenBrands <= 0 ? "–" : `${per(p.listenBrands, "brand")}, ${p.listenNames} competitors each`) },
    ],
  },
  {
    group: "Organic Research",
    rows: [
      { label: "Tasks a month", value: (p) => n(p.tasksPerMonth) },
      { label: "Task packs to top up", value: () => "✓" },
      { label: "Keyword, Domain & Competitive Analysis", value: () => "✓" },
      { label: "Audience research", value: (p) => (p.audiencePerMonth <= 0 ? "–" : `${per(p.audiencePerMonth, "brand")} a month`) },
      { label: "Revenue-driven Content Plan & briefs", value: (p) => yes(p.plansPerMonth > 0) },
      { label: "Agentic Writer & publishing", value: (p) => yes(p.writer === "full") },
    ],
  },
  {
    group: "Outreach",
    rows: [
      { label: "Outreach lists", value: (p) => n(p.outreachLists) },
      { label: "Contact finding & email drafts", value: () => "✓" },
    ],
  },
  {
    group: "Reports & data",
    rows: [
      { label: "Live report links", value: () => "✓" },
      { label: "8 report templates", value: (p) => yes(p.reports === "templates" || p.reports === "whitelabel") },
      { label: "White-label reports", value: (p) => yes(p.reports === "whitelabel") },
      { label: "Traffic & AI visits", value: (p) => (p.pageviewsPerMonth >= 1_000_000 ? `${p.pageviewsPerMonth / 1_000_000}M` : `${p.pageviewsPerMonth / 1000}k`) },
      { label: "Google Analytics 4", value: () => "✓" },
      { label: "CSV export", value: () => "✓" },
      { label: "Slack, Zapier & API", value: (p) => yes(p.alerts) },
    ],
  },
];

const FAQ: { q: string; a: string }[] = [
  { q: "Is Free really free forever?", a: "Yes. 10 prompts checked weekly on ChatGPT and Google AI Overviews, plus Sources, Competitors and 200 tasks a month for keyword research. No card, no time limit." },
  { q: "What is a prompt?", a: "A question people ask AI, like “best CRM for startups”. We ask it to every AI and record whether your brand is named, in what spot, next to which competitors, and which sources the AI used." },
  { q: "Which AIs do you track?", a: "ChatGPT, Claude, Gemini, Perplexity, Google AI Overviews and Google AI Mode. Free tracks ChatGPT and AI Overviews. Paid plans track all six." },
  { q: "Do my brands share prompts?", a: "Yes. Your prompts are one pool for the whole workspace. Split them between your brands any way you like." },
  { q: "Weekly or daily checks?", a: "AI answers change all the time. Weekly checks show the trend. Daily checks catch a drop the day it happens, which matters when you are shipping content to win a prompt." },
  { q: "What is a task?", a: "Every action you run costs a few tasks: a keyword lookup is 10, a domain report is 10, an outreach email draft is 3, a content brief is 100 and a writer agent job is 15. Tracking your prompts never uses tasks." },
  { q: "What if I run out of tasks?", a: "Buy a task pack from 1,000 tasks for $15. Pack tasks never expire and are used after your monthly tasks." },
  { q: "What does Starter include?", a: "Both toolsets: AI Visibility with 50 prompts checked daily on all six AIs, and Organic Research with 2,000 tasks a month and the Content Plan. The Agentic Writer starts on Pro." },
  { q: "What happens after the free trial?", a: "The 7-day trial includes the Agentic Writer. When it ends, your workspace moves to Free. Nothing is deleted. No card is needed to start." },
  { q: "Can I change plans later?", a: "Any time. Upgrades start right away and you only pay the difference. Downgrades credit what is left of your month." },
];

/** The public pricing page. */
export function PricingPage() {
  const [cycle, setCycle] = useState<Interval>("month");
  const trial = (primary: boolean, label = "Start free trial") => (
    <Link href="/" className={`aw-btn aw-btn--block ${primary ? "aw-btn--primary" : "aw-btn--secondary"}`}>
      {label}
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
              Start free
            </Link>
          </nav>
        </header>

        <section className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-4 pt-10 pb-12 text-center sm:px-8">
          <span className="aw-chip aw-chip--brand">Pricing</span>
          <h1 className="aw-display mb-0!">Be the brand AI recommends</h1>
          <p className="aw-lede max-w-2xl">See where ChatGPT, Claude, Gemini, Perplexity and Google AI name you, who they name instead, and what to publish to win. Free forever plan. No card.</p>
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
            ) : id === "free" ? (
              trial(false, "Start free")
            ) : (
              trial(id === "scale")
            )
          }
        />
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-8">
        <h2 className="aw-h2 mb-6! text-center">Compare plans</h2>
        <div className="overflow-x-auto rounded-[20px] border border-rule bg-white">
          <table className="w-full min-w-[880px] text-[14px]">
            <thead>
              <tr className="border-b border-rule">
                <th className="w-[28%] p-4 text-left font-medium text-muted" />
                {COLS.map((id) => (
                  <th key={id} className={`p-4 text-center ${id === "scale" ? "bg-brand-pale/50" : ""}`}>
                    <span className="block text-[16px] font-medium text-ink">{PLANS[id].name}</span>
                    <span className="aw-num text-[13px] font-normal text-muted">{PLANS[id].price ? `$${cycle === "year" ? PLANS[id].annual : PLANS[id].price}/mo` : "Free forever"}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((g) => (
                <Fragment key={g.group}>
                  <tr>
                    <td colSpan={COLS.length + 1} className="bg-surface-2 px-4 py-2.5 text-[12px] font-medium tracking-wide text-muted uppercase">
                      {g.group}
                    </td>
                  </tr>
                  {g.rows.map((r, i) => (
                    <tr key={i} className="border-t border-rule-faint">
                      <td className="p-4 text-body">{r.label}</td>
                      {COLS.map((id) => {
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
          <p className="max-w-xl text-[16px] text-white/80">Your first results in minutes. Free forever.</p>
          <Link href="/" className="aw-btn aw-btn--lg bg-white! text-brand!">
            Start free
          </Link>
        </div>
      </section>
    </main>
  );
}
