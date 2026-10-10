"use client";

import { PLANS, TRACKS, type Track } from "@/lib/plans";
import { AIS, LogoStack } from "./PlanGrid";

// A look at the toolset a Starter plan does not have: the real layout with demo numbers, and the way up to Pro.

const Stat = ({ lab, v, d }: { lab: string; v: string; d?: string }) => (
  <div className="aw-kpi">
    <span className="aw-kpi__lab">{lab}</span>
    <span className="aw-kpi__num text-ink">{v}</span>
    {d ? <span className="text-[12px] text-pos">{d}</span> : null}
  </div>
);

function VisibilityDemo() {
  const rivals: [string, number, string][] = [
    ["You", 46, "#0943B0"],
    ["Rival A", 38, "#E8603C"],
    ["Rival B", 27, "#2B3242"],
    ["Rival C", 19, "#A6AEBB"],
  ];
  const prompts: [string, string, string][] = [
    ["best crm for small business", "#2", "71%"],
    ["crm with email automation", "#1", "83%"],
    ["salesforce alternatives", "#4", "40%"],
    ["easy crm for startups", "–", "0%"],
    ["crm for real estate agents", "#3", "52%"],
  ];
  return (
    <div className="flex flex-col gap-5">
      <div className="aw-kpis" style={{ ["--cols" as string]: 4 }}>
        <Stat lab="Visibility" v="46%" d="↗ 8 pts" />
        <Stat lab="Avg. position" v="#2.4" d="↗ 0.6" />
        <Stat lab="Sentiment" v="74" />
        <Stat lab="Mentions" v="318" d="↗ 41" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <section className="aw-frame flex flex-col gap-4 p-5">
          <span className="aw-h4">Share of AI answers</span>
          {rivals.map(([n, v, c]) => (
            <span key={n} className="flex items-center gap-3 text-[14px]">
              <span className="w-20 text-ink">{n}</span>
              <span className="h-2.5 flex-1 rounded-full bg-rule-faint">
                <span className="block h-full rounded-full" style={{ width: `${v * 2}%`, background: c }} />
              </span>
              <span className="aw-num w-10 text-right">{v}%</span>
            </span>
          ))}
          <span className="flex items-center gap-2 text-[12px] text-muted">
            <LogoStack size={16} /> {AIS.length} AIs, checked daily
          </span>
        </section>
        <section className="aw-frame flex flex-col">
          <div className="aw-frame__head">
            <span className="aw-h4">Prompts</span>
          </div>
          <table className="aw-table">
            <thead>
              <tr>
                <th>Prompt</th>
                <th className="w-20">Position</th>
                <th className="w-24">Visibility</th>
              </tr>
            </thead>
            <tbody>
              {prompts.map(([p, pos, v]) => (
                <tr key={p}>
                  <td className="text-ink">{p}</td>
                  <td className="aw-num">{pos}</td>
                  <td className="aw-num">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function SeoDemo() {
  const rows: [string, string, number, string, string][] = [
    ["best crm for small business", "12.1K", 38, "Commercial", "$31.20"],
    ["crm software", "49.5K", 72, "Commercial", "$42.10"],
    ["free crm", "18.1K", 55, "Transactional", "$18.40"],
    ["what is a crm", "33.1K", 41, "Informational", "$9.80"],
    ["crm for startups", "2.9K", 24, "Commercial", "$27.60"],
    ["salesforce alternatives", "6.6K", 33, "Commercial", "$35.90"],
  ];
  return (
    <div className="flex flex-col gap-5">
      <div className="aw-kpis" style={{ ["--cols" as string]: 4 }}>
        <Stat lab="Volume" v="12.1K" />
        <Stat lab="Difficulty" v="38" />
        <Stat lab="Intent" v="Commercial" />
        <Stat lab="CPC" v="$31.20" />
      </div>
      <section className="aw-frame flex flex-col">
        <div className="aw-frame__head">
          <span className="aw-h4">Keyword ideas</span>
        </div>
        <table className="aw-table">
          <thead>
            <tr>
              <th>Keyword</th>
              <th className="w-24">Volume</th>
              <th className="w-24">Difficulty</th>
              <th className="w-32">Intent</th>
              <th className="w-24">CPC</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v, kd, i, c]) => (
              <tr key={k}>
                <td className="text-ink">{k}</td>
                <td className="aw-num">{v}</td>
                <td className="aw-num">{kd}</td>
                <td>{i}</td>
                <td className="aw-num">{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="grid gap-3 sm:grid-cols-3">
        {["Topic Bank · 120 keywords", "12 briefs on the Editorial Calendar", "Agentic Writer · draft in minutes"].map((x) => (
          <div key={x} className="aw-frame px-4 py-3 text-[14px] text-ink">
            {x}
          </div>
        ))}
      </div>
    </div>
  );
}

const PITCH: Record<Track, string> = {
  visibility: "See how ChatGPT, Gemini, Claude, Perplexity and Google's AI talk about your brand and your competitors, checked every day.",
  seo: "Find the keywords that bring buyers, see how competitors win on Google, and turn it into content with the Topic Bank, briefs and the Agentic Writer.",
};

/** The other toolset, shown with demo numbers behind an upgrade card. */
export function Glimpse({ track, title, pitch, admin, busy, onBoost, onPlans }: { track: Track; title?: string; pitch?: string; admin: boolean; busy: boolean; onBoost: () => void; onPlans: () => void }) {
  const pro = PLANS.scale;
  return (
    <div className="relative">
      <div className="pointer-events-none select-none opacity-60 blur-[1.5px] [mask-image:linear-gradient(to_bottom,black_45%,transparent)]" aria-hidden="true">
        {track === "visibility" ? <VisibilityDemo /> : <SeoDemo />}
      </div>
      <span className="aw-chip absolute top-3 right-3 bg-white!">Demo data</span>
      <div className="absolute inset-x-0 top-24 flex justify-center px-4">
        <div className="flex max-w-lg flex-col items-center gap-4 rounded-[20px] border border-rule bg-white px-6 py-8 text-center shadow-aw-lg">
          <span className="aw-label">Not on your Starter plan</span>
          <h2 className="aw-h3 mb-0!">{title ?? `Add ${TRACKS[track].label} with Pro`}</h2>
          <p className="text-[15px] text-body">{pitch ?? PITCH[track]}</p>
          <p className="text-[13px] text-muted">
            Pro has both toolsets, {pro.prompts} prompts checked daily and {pro.tasksPerMonth.toLocaleString("en-US")} tasks a month, for ${pro.price}/mo.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {admin ? (
              <button type="button" className="aw-btn aw-btn--primary" disabled={busy} onClick={onBoost}>
                {busy ? "Opening..." : `Upgrade to Pro · $${pro.price}/mo`}
              </button>
            ) : null}
            <button type="button" className="aw-btn aw-btn--secondary" onClick={onPlans}>
              See plans
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
