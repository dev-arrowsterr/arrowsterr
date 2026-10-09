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
