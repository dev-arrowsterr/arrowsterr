"use client";

import { LADDER, PLANS, type Interval, type Plan, type PlanId } from "@/lib/plans";
import { Seg } from "./ui";

const REPORTS: Record<Plan["reports"], string> = {
  basic: "Client reports",
  templates: "Report templates",
  share: "Shared report links",
  whitelabel: "White-label reports",
};

const n = (v: number) => v.toLocaleString("en-US");
const s = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;

/** What each plan gives, in short lines. */
export function features(p: Plan): string[] {
  if (p.id === "enterprise") return ["Custom prompts and brands", "Unlimited seats", "All 6 AIs daily", "White-label reports", "SSO and a security review", "A named success manager"];
  return [
    `${n(p.prompts)} prompts tracked`,
    `${s(p.brands, "brand")} · ${s(p.seats, "seat")}`,
    p.claudeEvery === 1 ? "All 6 AIs daily" : "5 AIs daily, Claude weekly",
    `${s(p.briefsPerMonth, "content brief")} a month`,
    `${s(p.plansPerMonth, "content plan")} a month`,
    `${n(p.researchPerDay)} research lookups a day`,
    ...(p.writer === "full" ? ["Agentic Writer"] : []),
    REPORTS[p.reports],
    ...(p.alerts ? ["Slack, Zapier and API"] : []),
  ];
}

export function IntervalSwitch({ value, onChange }: { value: Interval; onChange: (v: Interval) => void }) {
  return (
    <Seg
      label="Billing period"
      value={value}
      onChange={onChange}
      options={[
        { id: "month", label: "Monthly" },
        { id: "year", label: <>Yearly <span className="text-pos">−15%</span></> },
      ]}
    />
  );
}

/** The plans side by side. `action` draws each plan's button. */
export function PlanGrid({ interval, current, action }: { interval: Interval; current?: PlanId | null; action: (plan: PlanId) => React.ReactNode }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {LADDER.map((id) => {
        const p = PLANS[id];
        const price = interval === "year" ? p.annual : p.price;
        const on = current === id;
        return (
          <div key={id} className={`aw-frame flex flex-col ${on ? "border-brand! shadow-aw-md" : ""}`}>
            <div className="aw-frame__body flex flex-1 flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="aw-h4 mb-0!">{p.name}</h3>
                {on ? <span className="aw-chip aw-chip--brand">Current</span> : id === "scale" ? <span className="aw-badge">Popular</span> : null}
              </div>
              <div>
                {id === "enterprise" ? (
                  <span className="text-[30px] font-medium text-ink">Custom</span>
                ) : (
                  <>
                    <span className="aw-num text-[30px] font-medium text-ink">${price}</span>
                    <span className="text-[14px] text-muted"> /mo</span>
                  </>
                )}
                <p className="aw-small mt-1 min-h-5">{id === "enterprise" ? `From $${n(p.price)}/mo` : interval === "year" ? `$${n(price * 12)} billed yearly` : "Billed monthly"}</p>
              </div>
              <ul className="flex flex-1 flex-col gap-2">
                {features(p).map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[14px] text-body">
                    <span aria-hidden="true" className="mt-px text-brand">
                      ✓
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              {action(id)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
