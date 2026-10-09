import assert from "node:assert/strict";
import { test } from "node:test";
import { dailyAnswers, LADDER, limitsFor, METRICS, nextPlan, PLANS, periodOf } from "../src/lib/plans.ts";

test("every sold plan costs more and gives more prompts than the one before", () => {
  for (let i = 1; i < LADDER.length; i++) {
    const a = PLANS[LADDER[i - 1]];
    const b = PLANS[LADDER[i]];
    assert.ok(b.price > a.price, `${b.name} should cost more than ${a.name}`);
    assert.ok(b.prompts > a.prompts, `${b.name} should track more prompts than ${a.name}`);
  }
});

test("white label is only on Agency and Enterprise", () => {
  for (const id of LADDER) assert.equal(PLANS[id].reports === "whitelabel", id === "agency" || id === "enterprise", id);
});

test("extras add to the plan, and daily Claude overrides the schedule", () => {
  const l = limitsFor("scale", { prompts: 10, brands: 2, seats: 1, dailyClaude: true });
  assert.equal(l.prompts, 30);
  assert.equal(l.brands, 3);
  assert.equal(l.seats, 4);
  assert.equal(l.claudeEvery, 1);
  assert.equal(limitsFor("scale").claudeEvery, 7);
});

test("daily AI answers cover every prompt on every AI plus on-demand checks", () => {
  assert.equal(dailyAnswers(PLANS.foundation), (12 + 1) * 6);
  assert.equal(dailyAnswers(PLANS.trial), 150); // matches the database default for new workspaces
});

test("boost goes one step up and never to Enterprise", () => {
  assert.equal(nextPlan("foundation"), "scale");
  assert.equal(nextPlan("trial"), "thrive");
  assert.equal(nextPlan("thrive"), "agency");
  assert.equal(nextPlan("agency"), null);
});

test("monthly allowances count by month, daily ones by day", () => {
  const at = new Date("2026-10-09T12:00:00Z");
  assert.equal(periodOf("briefs", at), "2026-10");
  assert.equal(periodOf("research", at), "2026-10-09");
  for (const m of Object.keys(METRICS) as (keyof typeof METRICS)[]) assert.ok(METRICS[m].limit(PLANS.foundation) >= 1, m);
});

test("billing months start on the plan's day, and short months use their last day", async () => {
  const { cycleStart, cycleEnd, periodOf, planOfLookup, lookupKey } = await import("../src/lib/plans.ts");
  const anchor = new Date("2026-01-31T10:00:00Z");
  assert.equal(cycleStart(anchor, new Date("2026-03-05T00:00:00Z")).toISOString().slice(0, 10), "2026-02-28");
  assert.equal(cycleEnd(anchor, new Date("2026-03-05T00:00:00Z")).toISOString().slice(0, 10), "2026-03-31");
  assert.equal(cycleStart(new Date("2026-10-14T00:00:00Z"), new Date("2026-10-13T23:00:00Z")).toISOString().slice(0, 10), "2026-09-14");
  assert.equal(periodOf("briefs", new Date("2026-10-20T00:00:00Z"), "2026-10-14T08:00:00Z"), "2026-10-14");
  assert.equal(periodOf("briefs", new Date("2026-10-20T00:00:00Z")), "2026-10");
  assert.deepEqual(planOfLookup(lookupKey("thrive", "year")), { plan: "thrive", interval: "year" });
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
