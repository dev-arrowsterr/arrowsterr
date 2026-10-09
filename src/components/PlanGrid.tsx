"use client";

import { PLANS, SELF_SERVE, UNLIMITED, type Interval, type Plan, type PlanId } from "@/lib/plans";
import { BrandLogo } from "./BrandLogo";
import { ENGINE_LOGOS } from "./Engines";
import { Seg } from "./ui";

/** The AIs every plan tracks, for the logo rows. */
export const AIS: { name: string; logo: string }[] = [
  { name: "ChatGPT", logo: ENGINE_LOGOS.ChatGPT },
  { name: "Claude", logo: ENGINE_LOGOS.Claude },
  { name: "Gemini", logo: ENGINE_LOGOS.Gemini },
  { name: "Perplexity", logo: ENGINE_LOGOS.Perplexity },
  { name: "AI Overviews", logo: ENGINE_LOGOS["AI Overview"] },
  { name: "AI Mode", logo: ENGINE_LOGOS["AI Mode"] },
];

const n = (v: number) => v.toLocaleString("en-US");
const count = (v: number, one: string, many = `${one}s`) => (v >= UNLIMITED ? `Unlimited ${many}` : `${n(v)} ${v === 1 ? one : many}`);

export type Feature = { text: string; on: boolean; logos?: boolean; tag?: string };
export type Group = { title: string; items: Feature[] };

/** What a plan gives, grouped the way the cards and the table show it. */
export function groups(p: Plan): Group[] {
  return [
    {
      title: "AI visibility",
      items: [
        { text: `${n(p.prompts)} prompts`, on: true },
        { text: p.checkEvery === 1 ? "Checked daily on 6 AIs" : "Checked weekly on 6 AIs", on: true, logos: true },
        { text: count(p.brands, "brand"), on: true },
        { text: count(p.seats, "seat"), on: true },
        { text: `${n(p.competitors)} competitors per brand`, on: true },
        { text: p.historyDays >= 365 ? `${Math.round(p.historyDays / 365)} ${p.historyDays >= 730 ? "years" : "year"} of history` : `${p.historyDays} days of history`, on: true },
      ],
    },
    {
      title: "SEO & content",
      items: [
        { text: p.researchPerMonth ? `Keyword & Website Research · ${n(p.researchPerMonth)} a month` : "Keyword & Website Research", on: p.researchPerMonth > 0 },
        { text: p.briefsPerMonth ? `${n(p.briefsPerMonth)} content briefs a month` : "Content briefs", on: p.briefsPerMonth > 0 },
        { text: p.plansPerMonth ? `${count(p.plansPerMonth, "content plan")} a month` : "Content plans", on: p.plansPerMonth > 0 },
        { text: "Agentic Writer", on: p.writer === "full" },
      ],
    },
    {
      title: "Reports & data",
      items: [
        { text: "Live report links", on: true },
        { text: "8 report templates", on: p.reports === "templates" || p.reports === "whitelabel" },
        { text: "White-label reports", on: p.reports === "whitelabel" },
        { text: "CSV export", on: true },
        { text: "Slack, Zapier & API", on: p.alerts },
      ],
    },
  ];
}

/** Overlapping AI logos. */
export function LogoStack({ size = 20 }: { size?: number }) {
  return (
    <span className="inline-flex items-center" aria-label={AIS.map((a) => a.name).join(", ")}>
      {AIS.filter((a, i) => AIS.findIndex((b) => b.logo === a.logo) === i).map((a, i) => (
        <span key={a.name} className="rounded-[8px] bg-white ring-2 ring-white" style={{ marginLeft: i ? -size * 0.3 : 0 }}>
          <BrandLogo src={a.logo} name={a.name} size={size} />
        </span>
      ))}
    </span>
  );
}

export function IntervalSwitch({ value, onChange }: { value: Interval; onChange: (v: Interval) => void }) {
  return (
    <Seg
      label="Billing period"
      value={value}
      onChange={onChange}
      options={[
        { id: "month", label: "Monthly" },
        { id: "year", label: <>Yearly <span className="rounded-full bg-pos-bg px-2 py-0.5 text-[11px] text-pos">Save 15%</span></> },
      ]}
    />
  );
}

function Price({ p, interval }: { p: Plan; interval: Interval }) {
  const price = interval === "year" ? p.annual : p.price;
  return (
    <div>
      <div className="flex items-end gap-1.5">
        {interval === "year" ? <span className="aw-num mb-1.5 text-[18px] text-muted line-through">${p.price}</span> : null}
        <span className="aw-num text-[44px] leading-none font-medium tracking-tight text-ink">${price}</span>
        <span className="mb-1 text-[14px] text-muted">/mo</span>
      </div>
      <p className="aw-small mt-2">{interval === "year" ? `$${n(price * 12)} billed yearly` : "Billed monthly"}</p>
    </div>
  );
}

function Line({ f }: { f: Feature }) {
  return (
    <li className={`flex items-start gap-2.5 text-[14px] leading-snug ${f.on ? "text-body" : "text-faint line-through decoration-rule"}`}>
      <span aria-hidden="true" className={`mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${f.on ? "bg-brand-pale text-brand" : "bg-surface-2 text-faint"}`}>
        {f.on ? "✓" : "–"}
      </span>
      <span className="flex flex-col gap-1.5">
        {f.text}
        {f.logos && f.on ? <LogoStack size={18} /> : null}
        {f.tag ? <span className="self-start rounded-full bg-brand-pale px-2 py-0.5 text-[11px] font-medium text-brand">{f.tag}</span> : null}
      </span>
    </li>
  );
}

/** The self-serve plans side by side, then Enterprise. `action` draws each plan's button. */
export function PlanGrid({ interval, current, action }: { interval: Interval; current?: PlanId | null; action: (plan: PlanId) => React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-4">
        {SELF_SERVE.map((id) => {
          const p = PLANS[id];
          const hot = id === "scale";
          const on = current === id;
          return (
            <div
              key={id}
              className={`relative flex flex-col rounded-[20px] border bg-white p-6 transition-shadow ${hot ? "border-brand shadow-[0_24px_60px_-24px_rgba(9,67,176,0.45)]" : on ? "border-brand" : "border-rule shadow-aw-sm hover:shadow-aw-md"}`}
            >
              {hot ? <span className="aw-badge absolute -top-3 left-6">Most popular</span> : null}
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[20px] font-medium text-ink">{p.name}</h3>
                {on ? <span className="aw-chip aw-chip--brand">Current</span> : null}
              </div>
              <p className="mt-1 min-h-10 text-[14px] text-muted">{p.tagline}</p>
              <div className="mt-4">
                <Price p={p} interval={interval} />
              </div>
              <div className="mt-5">{action(id)}</div>
              <div className="mt-6 flex flex-1 flex-col gap-5 border-t border-rule-faint pt-5">
                {groups(p).map((g) => (
                  <div key={g.title} className="flex flex-col gap-2.5">
                    <span className="aw-label mb-0!">{g.title}</span>
                    <ul className="flex flex-col gap-2.5">
                      {g.items.map((f) => (
                        <Line key={f.text} f={f} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-5 rounded-[20px] bg-ink p-6 text-white sm:p-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium tracking-wide text-white/60 uppercase">Enterprise</span>
          <h3 className="text-[24px] font-medium text-white">{PLANS.enterprise.tagline}</h3>
          <p className="text-[15px] text-white/70">Custom prompts and checks, unlimited seats, SSO, a security review and a named success manager. From ${n(PLANS.enterprise.price)}/mo.</p>
        </div>
        <div className="shrink-0 lg:w-56">{action("enterprise")}</div>
      </div>
    </div>
  );
}
