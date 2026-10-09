"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { atLeast, getPlanUsage, type PlanUsage, type Workspace } from "@/lib/db";
import { LADDER, PLANS, type Interval, type PlanId } from "@/lib/plans";
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
    if (params.get("checkout") !== "done") return;
    params.delete("checkout");
    window.history.replaceState(null, "", window.location.pathname + (params.size ? `?${params}` : ""));
    let tries = 0;
    const timer = window.setInterval(async () => {
      const p = await load();
      if ((p && p.plan !== "trial" && p.plan !== "legacy" && p.status === "active") || ++tries >= 10) {
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

  const paying = Boolean(plan && plan.customer && plan.plan !== "trial" && plan.plan !== "legacy" && plan.status !== "canceled");
  const button = (id: PlanId) => {
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
            {plan.status === "read_only" || plan.status === "canceled" ? (
              <span className="aw-status aw-status--missed">Read-only</span>
            ) : plan.status === "past_due" ? (
              <span className="aw-status aw-status--warn">Payment failed</span>
            ) : plan.trialLeft !== null ? (
              <span className="aw-status aw-status--pending">{plan.trialLeft} days left</span>
            ) : null}
            {plan.cancelAt ? <span className="aw-small">Ends {date(plan.cancelAt)}</span> : plan.periodEnd && paying ? <span className="aw-small">Renews {date(plan.periodEnd)}</span> : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {plan.allowances.map((a) => (
              <Meter key={a.metric} label={`${a.label[0].toUpperCase()}${a.label.slice(1)} ${a.period === "day" ? "today" : "this month"}`} used={a.used} limit={a.limit} />
            ))}
          </div>
        </section>
      ) : null}

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
