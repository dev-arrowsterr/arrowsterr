import { test } from "node:test";
import assert from "node:assert/strict";
import { groupBySerp, pick, slots, type AgentKeyword } from "../src/lib/research.ts";

const kw = (keyword: string, volume: number | null, theme = "A"): AgentKeyword => ({
  keyword, volume, kd: 20, cpc: null, intent: null, trend: [], serp: [], stage: "bofu", theme, group: -1,
});

test("keywords sharing 3 or more top results become one page, led by the biggest", () => {
  const list = [kw("best crm", 100), kw("top crm software", 500), kw("crm pricing", 50)];
  const serps = new Map([
    ["best crm", ["a.com/1", "b.com/2", "c.com/3", "d.com/4"]],
    ["top crm software", ["a.com/1", "b.com/2", "c.com/3", "x.com"]],
    ["crm pricing", ["a.com/1", "y.com", "z.com"]],
  ]);
  const groups = groupBySerp(list, serps);
  assert.equal(groups.length, 2);
  const big = groups.find((g) => g.keywords.length === 2)!;
  assert.equal(big.primary, "top crm software");
  assert.equal(big.volume, 600);
  assert.equal(list[0].group, list[1].group);
  assert.notEqual(list[0].group, list[2].group);
});

test("pick takes turns across themes", () => {
  const list = [kw("a1", 900, "A"), kw("a2", 800, "A"), kw("a3", 700, "A"), kw("b1", 10, "B")];
  assert.deepEqual(pick(list, 2, ["A", "B"]).map((k) => k.keyword), ["a1", "b1"]);
});

test("slots puts 2 posts a week on Monday and Wednesday, never before the start", () => {
  // 2026-10-07 is a Wednesday.
  assert.deepEqual(slots(new Date(2026, 9, 7), 2, 4), ["2026-10-07", "2026-10-12", "2026-10-14", "2026-10-19"]);
});
