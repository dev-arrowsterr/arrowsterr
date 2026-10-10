import assert from "node:assert/strict";
import { test } from "node:test";
import { dailyAnswers, LADDER, limitsFor, METRICS, nextPlan, PLANS, periodOf } from "../src/lib/plans.ts";

test("every sold plan costs more and gives more prompts, more often checks or more SEO than the one before", () => {
  for (let i = 1; i < LADDER.length; i++) {
    const a = PLANS[LADDER[i - 1]];
    const b = PLANS[LADDER[i]];
    assert.ok(b.price > a.price, `${b.name} should cost more than ${a.name}`);
    assert.ok(b.prompts >= a.prompts && b.seats >= a.seats, `${b.name} should never give less than ${a.name}`);
    assert.ok(b.prompts > a.prompts || b.checkEvery < a.checkEvery || b.researchPerMonth > a.researchPerMonth, `${b.name} should give more than ${a.name}`);
  }
});

test("Free tracks no prompts and has a little research; every paid plan has more tasks than the one before", async () => {
  const { TASK_COST, TASK_PACKS, effectivePlan } = await import("../src/lib/plans.ts");
  assert.equal(PLANS.free.prompts, 0);
  assert.equal(PLANS.free.price, 0);
  assert.ok(PLANS.free.tasksPerMonth >= TASK_COST.keyword * 10);
  const paid = LADDER.filter((id) => id !== "free");
  for (let i = 1; i < paid.length; i++) assert.ok(PLANS[paid[i]].tasksPerMonth > PLANS[paid[i - 1]].tasksPerMonth, paid[i]);
  for (let i = 1; i < TASK_PACKS.length; i++) assert.ok(TASK_PACKS[i].price / TASK_PACKS[i].tasks < TASK_PACKS[i - 1].price / TASK_PACKS[i - 1].tasks);
  assert.deepEqual(effectivePlan("trial", "trialing", "2020-01-01T00:00:00Z"), { plan: "free", status: "active" });
  assert.deepEqual(effectivePlan("scale", "canceled", null), { plan: "free", status: "active" });
  assert.deepEqual(effectivePlan("scale", "past_due", null), { plan: "scale", status: "past_due" });
});

test("weekly plans check each brand once every 7 days", async () => {
  const { checkDue } = await import("../src/lib/plans.ts");
  const days = Array.from({ length: 14 }, (_, d) => checkDue(3, 7, 20000 + d)).filter(Boolean).length;
  assert.equal(days, 2);
  assert.ok(checkDue(3, 1, 20000));
});

test("white label is only on Agency and Enterprise", () => {
  for (const id of LADDER) assert.equal(PLANS[id].reports === "whitelabel", id === "agency" || id === "enterprise", id);
});

test("extras add to the plan, and the daily extra overrides the schedule", () => {
  const l = limitsFor("foundation", { prompts: 10, seats: 1, daily: true });
  assert.equal(l.prompts, 60);
  assert.equal(l.seats, 3);
  assert.equal(l.checkEvery, 1);
  assert.equal(limitsFor("foundation").checkEvery, 7);
});

test("daily AI answers cover every prompt on every AI plus on-demand checks", () => {
  assert.equal(dailyAnswers(PLANS.foundation), (50 + 3) * 6);
  assert.equal(dailyAnswers(PLANS.trial), 180); // matches the database default for new workspaces (020_leaner_plans.sql)
});

test("boost goes one step up and never to Enterprise", () => {
  assert.equal(nextPlan("free"), "foundation");
  assert.equal(nextPlan("foundation"), "scale");
  assert.equal(nextPlan("trial"), "scale");
  assert.equal(nextPlan("thrive"), "agency");
  assert.equal(nextPlan("agency"), null);
});

test("monthly allowances count by month, daily ones by day", () => {
  const at = new Date("2026-10-09T12:00:00Z");
  assert.equal(periodOf("tasks", at), "2026-10");
  assert.equal(periodOf("checknow", at), "2026-10-09");
  for (const m of Object.keys(METRICS) as (keyof typeof METRICS)[]) assert.ok(METRICS[m].limit(PLANS.scale) >= 1, m);
});

test("billing months start on the plan's day, and short months use their last day", async () => {
  const { cycleStart, cycleEnd, periodOf, planOfLookup, lookupKey } = await import("../src/lib/plans.ts");
  const anchor = new Date("2026-01-31T10:00:00Z");
  assert.equal(cycleStart(anchor, new Date("2026-03-05T00:00:00Z")).toISOString().slice(0, 10), "2026-02-28");
  assert.equal(cycleEnd(anchor, new Date("2026-03-05T00:00:00Z")).toISOString().slice(0, 10), "2026-03-31");
  assert.equal(cycleStart(new Date("2026-10-14T00:00:00Z"), new Date("2026-10-13T23:00:00Z")).toISOString().slice(0, 10), "2026-09-14");
  assert.equal(periodOf("tasks", new Date("2026-10-20T00:00:00Z"), "2026-10-14T08:00:00Z"), "2026-10-14");
  assert.equal(periodOf("tasks", new Date("2026-10-20T00:00:00Z")), "2026-10");
  assert.deepEqual(planOfLookup(lookupKey("scale", "year")), { plan: "scale", interval: "year" });
  assert.deepEqual(planOfLookup("arrowsterr_thrive_year"), { plan: "thrive", interval: "year" });
  assert.equal(planOfLookup("arrowsterr_enterprise_month"), null);
});

test("after a downgrade, prompts past the plan are paused in the order brands were added", async () => {
  const { promptAllowance } = await import("../src/lib/plans.ts");
  const brands = [
    { id: "a", prompts: Array(15).fill("p") },
    { id: "b", prompts: Array(10).fill("p") },
    { id: "c", prompts: Array(5).fill("p") },
  ];
  const m = promptAllowance(brands, { brands: 2, prompts: 20 });
  assert.deepEqual([m.get("a"), m.get("b"), m.get("c")], [15, 5, 0]);
});
