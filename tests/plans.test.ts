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

test("Starter opens the toolset picked, every other plan opens both; more tasks up the ladder; trials and cancels drop to Free", async () => {
  const { TASK_PACKS, effectivePlan, access } = await import("../src/lib/plans.ts");
  assert.equal(LADDER[0], "free");
  for (const id of LADDER.filter((x) => x !== "foundation")) assert.deepEqual(access(id, "seo"), { visibility: true, seo: true }, id);
  assert.deepEqual(access("foundation", "seo"), { visibility: false, seo: true });
  assert.deepEqual(access("foundation"), { visibility: true, seo: false });
  const vis = limitsFor("foundation", { track: "visibility" });
  const seo = limitsFor("foundation", { track: "seo" });
  assert.deepEqual([vis.prompts, vis.tasksPerMonth, vis.listenBrands], [50, 300, 1]);
  assert.deepEqual([seo.prompts, seo.tasksPerMonth, seo.listenBrands], [0, 3000, 0]);
  assert.equal(dailyAnswers(seo), 0);
  for (let i = 1; i < LADDER.length; i++) assert.ok(PLANS[LADDER[i]].tasksPerMonth > PLANS[LADDER[i - 1]].tasksPerMonth, LADDER[i]);
  for (let i = 1; i < TASK_PACKS.length; i++) assert.ok(TASK_PACKS[i].price / TASK_PACKS[i].tasks < TASK_PACKS[i - 1].price / TASK_PACKS[i - 1].tasks);
  assert.deepEqual(effectivePlan("trial", "trialing", "2020-01-01T00:00:00Z"), { plan: "free", status: "active" });
  assert.deepEqual(effectivePlan("trial", "trialing", "2999-01-01T00:00:00Z"), { plan: "trial", status: "trialing" });
  assert.deepEqual(effectivePlan("scale", "canceled", null), { plan: "free", status: "active" });
  assert.deepEqual(effectivePlan("scale", "past_due", null), { plan: "scale", status: "past_due" });
});

test("Free forever: 10 weekly prompts on 2 AIs, 200 tasks, no Content Plan or listening", () => {
  const f = PLANS.free;
  assert.equal(f.price, 0);
  assert.equal(f.prompts, 10);
  assert.equal(f.checkEvery, 7);
  assert.deepEqual(f.engines, ["ChatGPT", "AI Overview"]);
  assert.equal(f.tasksPerMonth, 200);
  assert.equal(f.brands, 1);
  assert.equal(f.plansPerMonth, 0);
  assert.equal(f.listenBrands + f.listenNames, 0);
  assert.equal(dailyAnswers(f), 20);
  for (const id of LADDER.slice(1)) assert.equal(PLANS[id].engines, null, id);
});

test("pricing v5 prices, and brands capped below Agency", () => {
  assert.deepEqual(
    LADDER.map((id) => [PLANS[id].price, PLANS[id].annual]),
    [
      [0, 0],
      [39, 33],
      [179, 152],
      [499, 424],
      [1500, 1500],
    ],
  );
  assert.deepEqual([PLANS.foundation.brands, PLANS.scale.brands], [3, 10]);
  assert.ok(PLANS.agency.brands >= 1000);
  assert.equal(PLANS.foundation.writer, "none");
  assert.equal(PLANS.scale.writer, "full");
  const extra = limitsFor("foundation", { brands: 2 });
  assert.deepEqual([extra.brands, extra.listenBrands], [5, 3]);
  assert.equal(limitsFor("free", { brands: 1 }).listenBrands, 0);
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
  assert.equal(limitsFor("trial").checkEvery, 1);
});

test("daily AI answers cover every prompt on every AI plus on-demand checks", () => {
  assert.equal(dailyAnswers(PLANS.foundation), (50 + 3) * 6);
  assert.equal(dailyAnswers(PLANS.trial), 180); // matches the database default for new workspaces (020_leaner_plans.sql)
});

test("boost goes one step up and never to Enterprise", () => {
  assert.equal(nextPlan("foundation"), "scale");
  assert.equal(nextPlan("trial"), "scale");
  assert.equal(nextPlan("thrive"), "agency");
  assert.equal(nextPlan("agency"), null);
  assert.equal(nextPlan("free"), "foundation");
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
  assert.deepEqual(planOfLookup("arrowsterr_v3_scale_month"), { plan: "scale", interval: "month" });
  assert.equal(lookupKey("agency", "month"), "arrowsterr_v5_agency_month");
  assert.deepEqual(planOfLookup("arrowsterr_v4_foundation_year"), { plan: "foundation", interval: "year" });
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
