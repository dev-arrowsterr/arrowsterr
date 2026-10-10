"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { atLeast, getPlanUsage, type PlanUsage, type Workspace } from "@/lib/db";
import { LADDER, PLANS, TASK_COST, TASK_PACKS, type Interval, type PackId, type PlanId } from "@/lib/plans";
import type { RunAuth } from "@/lib/runner";
import { IntervalSwitch, PlanGrid } from "./PlanGrid";
import { post } from "./research/shared";
import { Meter } from "./ui";

export const SALES = "mailto:sales@arrowsterr.com?subject=Arrowsterr%20Enterprise";
const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const rank = (id: PlanId) => LADDER.indexOf(id);

/** Pick a plan: Checkout for a first plan, an instant switch after that. Returns a message, or opens Stripe. */
export async function choosePlan(auth: RunAuth, plan: PlanId, interval: Interval) {
  const r = await post<{ url?: string; changed?: boolean }>(auth, "/api/billing/checkout", { plan, interval });
  if (r.url) window.location.href = r.url;
  return r.changed ? `You're on ${PLANS[plan].name} now.` : "";
}

/** Buy a task pack: opens Stripe Checkout. */
export async function buyPack(auth: RunAuth, pack: PackId) {
  const r = await post<{ url: string }>(auth, "/api/billing/pack", { pack });
  window.location.href = r.url;
}

/** Plan, allowances, and every plan to pick from. */
export function BillingPage({ sb, ws, auth, onPlan }: { sb: SupabaseClient; ws: Workspace; auth: RunAuth; onPlan: () => void }) {
  const isAdmin = atLeast(ws.role, "admin");
  const [plan, setPlan] = useState<PlanUsage | null>(null);
  const [cycle, setCycle] = useState<Interval>("month");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const p = await getPlanUsage(sb, ws.id).catch(() => null);
    setPlan(p);
    if (p?.interval) setCycle(p.interval);
    return p;
  }, [sb, ws.id]);

  useEffect(() => {
    load();
    // Back from Stripe Checkout: the webhook lands within seconds, so look again a few times.
    const params = new URLSearchParams(window.location.search);
    if (params.get("pack") === "done") {
      params.delete("pack");
      window.history.replaceState(null, "", window.location.pathname + (params.size ? `?${params}` : ""));
      const before = Date.now();
      const t = window.setInterval(async () => {
        await load();
        if (Date.now() - before > 12_000) window.clearInterval(t);
      }, 2000);
      setNotice("Thanks! Your tasks are added as soon as Stripe confirms the payment.");
      return () => window.clearInterval(t);
    }
    if (params.get("checkout") !== "done") return;
    params.delete("checkout");
    window.history.replaceState(null, "", window.location.pathname + (params.size ? `?${params}` : ""));
    let tries = 0;
    const timer = window.setInterval(async () => {
      const p = await load();
      if ((p && p.plan !== "trial" && p.plan !== "legacy" && p.plan !== "free" && p.status === "active") || ++tries >= 10) {
        window.clearInterval(timer);
        if (p) setNotice(`You're on ${p.name} now.`);
        onPlan();
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [load, onPlan]);

  async function act(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const done = await fn();
      if (done) {
        setNotice(done);
        await load();
        onPlan();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const paying = Boolean(plan && plan.customer && plan.plan !== "trial" && plan.plan !== "legacy" && plan.plan !== "free" && plan.status !== "canceled");
  const button = (id: PlanId) => {
    if (id === "free")
      return (
        <button type="button" className="aw-btn aw-btn--secondary aw-btn--block" disabled>
          {plan?.plan === "free" ? "Current plan" : "Always free"}
        </button>
      );
    if (id === "enterprise")
      return (
        <a href={SALES} className="aw-btn aw-btn--block bg-white! text-ink!">
          Talk to us
        </a>
      );
    const same = plan?.plan === id && paying && (plan.interval ?? "month") === cycle;
    if (same)
      return (
        <button type="button" className="aw-btn aw-btn--secondary aw-btn--block" disabled>
          Current plan
        </button>
      );
    const up = !paying || !plan || rank(id) > rank(plan.plan);
    const label = !paying ? "Choose" : plan?.plan === id ? `Switch to ${cycle === "year" ? "yearly" : "monthly"}` : up ? "Boost" : "Switch";
    return (
      <button
        type="button"
        className={`aw-btn aw-btn--block ${up ? "aw-btn--primary" : "aw-btn--secondary"}`}
        disabled={!isAdmin || busy !== null}
        title={isAdmin ? undefined : "Ask an admin"}
        onClick={() => {
          if (paying && !confirm(`Switch to ${PLANS[id].name}? The difference is charged or credited today.`)) return;
          act(id, () => choosePlan(auth, id, cycle));
        }}
      >
        {busy === id ? "Opening..." : label}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="aw-h2 mb-0!">Plan & billing</h1>
        {plan?.customer && isAdmin ? (
          <button
            type="button"
            className="aw-btn aw-btn--secondary"
            disabled={busy !== null}
            onClick={() =>
              act("portal", async () => {
                const r = await post<{ url: string }>(auth, "/api/billing/portal", {});
                window.location.href = r.url;
              })
            }
          >
            {busy === "portal" ? "Opening..." : "Invoices & payment"}
          </button>
        ) : null}
      </div>
      {error ? <p className="aw-error">{error}</p> : null}
      {notice ? <p className="aw-callout text-[15px]!">{notice}</p> : null}

      {plan ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="aw-h4 mb-0!">{plan.name}</h2>
            {plan.status === "read_only" ? (
              <span className="aw-status aw-status--missed">Read-only</span>
            ) : plan.status === "past_due" ? (
              <span className="aw-status aw-status--warn">Payment failed</span>
            ) : plan.trialLeft !== null ? (
              <span className="aw-status aw-status--pending">{plan.trialLeft} days left</span>
            ) : null}
            {plan.cancelAt ? <span className="aw-small">Ends {date(plan.cancelAt)}</span> : plan.periodEnd && paying ? <span className="aw-small">Renews {date(plan.periodEnd)}</span> : null}
          </div>
          {plan.trialEnded ? <p className="aw-callout">Your free trial has ended, so this workspace is on Free now. Your data is safe. Pick a plan to track prompts again.</p> : null}
          <div className="grid gap-3 sm:grid-cols-3">
            {plan.allowances
              .filter((a) => a.metric === "tasks")
              .map((a) => (
                <Meter key={a.metric} label="Tasks this month" used={a.used} limit={a.limit} />
              ))}
            <div className="aw-frame flex flex-col justify-center gap-1 px-4 py-3">
              <span className="aw-label">Task packs</span>
              <span className="aw-num text-[22px] text-ink">{plan.credits.toLocaleString("en-US")}</span>
              <span className="text-[12px] text-muted">Used after the month&apos;s tasks. Never expire.</span>
            </div>
            {plan.allowances
              .filter((a) => a.metric === "checknow" && a.limit > 0)
              .map((a) => (
                <Meter key={a.metric} label="On-demand checks today" used={a.used} limit={a.limit} />
              ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="aw-h4 mb-0!">Task packs</h2>
          <p className="text-[14px] text-body">Ran out of tasks? Top up any time. Pack tasks never expire. Tracking your prompts never uses tasks.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {TASK_PACKS.map((p) => (
            <div key={p.id} className="aw-frame flex flex-col gap-3 p-5">
              <span className="aw-num text-[26px] text-ink">{p.tasks.toLocaleString("en-US")} tasks</span>
              <span className="text-[14px] text-body">
                ${p.price} · ${((p.price / p.tasks) * 1000).toFixed(2)} per 1,000
              </span>
              <button type="button" className="aw-btn aw-btn--primary aw-btn--sm self-start" disabled={!isAdmin || busy !== null} title={isAdmin ? undefined : "Ask an admin"} onClick={() => act(p.id, () => buyPack(auth, p.id))}>
                {busy === p.id ? "Opening..." : "Buy"}
              </button>
            </div>
          ))}
        </div>
        <details className="aw-frame px-5 py-3 text-[14px]">
          <summary className="cursor-pointer font-medium text-ink">What does a task cost?</summary>
          <ul className="mt-3 grid gap-1.5 text-body sm:grid-cols-2">
            {[
              ["Keyword lookup", TASK_COST.keyword],
              ["Domain research", TASK_COST.domain],
              ["Competitive analysis", TASK_COST.gap],
              ["Your pages on Google", TASK_COST.pages],
              ["Content brief", TASK_COST.brief],
              ["Writer agent job", TASK_COST.agent],
              ["Interactive element", TASK_COST.widget],
              ["Small AI job", TASK_COST.ai],
            ].map(([k, v]) => (
              <li key={k as string} className="flex justify-between gap-3 border-b border-rule-faint py-1">
                <span>{k}</span>
                <span className="aw-num text-ink">{v} tasks</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-muted">Tracking prompts, publishing and your first Topic Bank are free.</p>
        </details>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="aw-h4 mb-0!">Plans</h2>
          <IntervalSwitch value={cycle} onChange={setCycle} />
        </div>
        <PlanGrid interval={cycle} current={paying ? plan?.plan : null} action={button} />
      </section>
    </div>
  );
}
