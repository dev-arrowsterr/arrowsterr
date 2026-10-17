import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanKeyword, freeBlock, freeLimits, utcDayStart } from "../src/lib/freeLimits.ts";

const L = freeLimits("keyword");
const none = { mineTool: 0, mineAll: 0, toolToday: 0, spentToday: 0 };

test("a visitor gets 5 runs a tool and 15 across tools a day, then is asked to sign up", () => {
  assert.equal(freeBlock(none, L), null);
  assert.equal(freeBlock({ ...none, mineTool: 4 }, L), null);
  assert.equal(freeBlock({ ...none, mineTool: 5 }, L)?.kind, "visitor");
  assert.equal(freeBlock({ ...none, mineAll: 15 }, L)?.kind, "visitor");
});

test("the tool's daily cap and the daily spend stop new paid runs for everyone", () => {
  assert.equal(L.cap, 500);
  assert.equal(freeBlock({ ...none, toolToday: 500 }, L)?.kind, "busy");
  assert.equal(freeBlock({ ...none, spentToday: 15 }, L)?.kind, "busy");
  assert.equal(freeBlock({ ...none, spentToday: 14.99 }, L), null);
});

test("server settings change the limits, and bad values fall back to the defaults", () => {
  const l = freeLimits("keyword", { FREE_CAP_KEYWORD: "50", FREE_PER_TOOL: "2", FREE_SPEND_DAY: "3", FREE_PER_VISITOR: "nope" });
  assert.deepEqual(l, { perTool: 2, perVisitor: 15, spendDay: 3, cap: 50 });
  assert.equal(freeLimits("keyword", { FREE_CAP_KEYWORD: "" }).cap, 500);
  assert.equal(freeLimits("keyword", { FREE_CAP_KEYWORD: "-1" }).cap, 500);
  assert.equal(freeBlock({ ...none, toolToday: 50 }, l)?.kind, "busy");
});

test("keywords are cleaned so junk can't make new paid lookups", () => {
  assert.equal(cleanKeyword("  Best   CRM  for Small Business "), "best crm for small business");
  assert.equal(cleanKeyword("café near me"), "café near me");
  assert.equal(cleanKeyword("phần mềm crm"), "phần mềm crm");
  assert.equal(cleanKeyword("a"), null);
  assert.equal(cleanKeyword("x".repeat(81)), null);
  assert.equal(cleanKeyword("https://acme.com"), null);
  assert.equal(cleanKeyword("<script>alert(1)</script>"), null);
  assert.equal(cleanKeyword("!!! ???"), null);
  assert.equal(cleanKeyword("one two three four five six seven eight nine ten eleven"), null);
  assert.equal(cleanKeyword(42), null);
});

test("the day resets at midnight UTC", () => {
  assert.equal(utcDayStart(Date.parse("2026-10-17T23:59:00Z")), "2026-10-17T00:00:00.000Z");
  assert.equal(utcDayStart(Date.parse("2026-10-18T00:00:01Z")), "2026-10-18T00:00:00.000Z");
});
