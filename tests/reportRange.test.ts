import assert from "node:assert/strict";
import { test } from "node:test";
import { dayStart, parseRange, rangeLabel, resolveRange, todayIn } from "../src/lib/reportRange.ts";

// Thursday 16 October 2026, 14:00 UTC.
const NOW = Date.parse("2026-10-16T14:00:00Z");

test("presets end yesterday and cover whole days", () => {
  const r7 = resolveRange({ preset: "last7", compare: "previous" }, { now: NOW });
  assert.deepEqual([r7.start, r7.end, r7.days], ["2026-10-09", "2026-10-15", 7]);
  assert.deepEqual([r7.prevStart, r7.prevEnd], ["2026-10-02", "2026-10-08"]);
  const r30 = resolveRange({ preset: "last30", compare: "none" }, { now: NOW });
  assert.deepEqual([r30.start, r30.end, r30.days, r30.prevStart, r30.compareLabel], ["2026-09-16", "2026-10-15", 30, null, null]);
});

test("full week, month and quarter are the calendar ones before this one", () => {
  const w = resolveRange({ preset: "lastWeek", compare: "previous" }, { now: NOW });
  assert.deepEqual([w.start, w.end], ["2026-10-05", "2026-10-11"]); // Monday to Sunday
  const m = resolveRange({ preset: "lastMonth", compare: "previous" }, { now: NOW });
  assert.deepEqual([m.start, m.end, m.label], ["2026-09-01", "2026-09-30", "September 2026"]);
  // A full month compares with the whole month before, whatever its length.
  assert.deepEqual([m.prevStart, m.prevEnd, m.compareLabel], ["2026-08-01", "2026-08-31", "August 2026"]);
  const march = resolveRange({ preset: "lastMonth", compare: "previous" }, { now: Date.parse("2026-04-10T12:00:00Z") });
  assert.deepEqual([march.prevStart, march.prevEnd], ["2026-02-01", "2026-02-28"]);
  const q1 = resolveRange({ preset: "lastQuarter", compare: "previous" }, { now: Date.parse("2026-04-10T12:00:00Z") });
  assert.deepEqual([q1.label, q1.compareLabel], ["Q1 2026", "Q4 2025"]);
  const q = resolveRange({ preset: "lastQuarter", compare: "lastYear" }, { now: NOW });
  assert.deepEqual([q.start, q.end, q.label, q.compareLabel], ["2026-07-01", "2026-09-30", "Q3 2026", "Q3 2025"]);
  // January: last month is December of the year before.
  const jan = resolveRange({ preset: "lastMonth", compare: "none" }, { now: Date.parse("2026-01-10T12:00:00Z") });
  assert.deepEqual([jan.start, jan.end], ["2025-12-01", "2025-12-31"]);
});

test("to-date ranges on their first day show today instead of an empty range", () => {
  const first = Date.parse("2026-10-01T12:00:00Z");
  const mtd = resolveRange({ preset: "mtd", compare: "none" }, { now: first });
  assert.deepEqual([mtd.start, mtd.end, mtd.days], ["2026-10-01", "2026-10-01", 1]);
  const ytd = resolveRange({ preset: "ytd", compare: "none" }, { now: NOW });
  assert.deepEqual([ytd.start, ytd.end], ["2026-01-01", "2026-10-15"]);
});

test("custom ranges are cleaned: swapped, capped at today, bad dates fall back", () => {
  assert.deepEqual(parseRange({ preset: "custom", start: "2026-09-30", end: "2026-09-01", compare: "none" }), { preset: "custom", start: "2026-09-01", end: "2026-09-30", compare: "none" });
  assert.deepEqual(parseRange({ preset: "custom", start: "2026-02-31", end: "2026-03-01" }), { preset: "last30", compare: "previous" });
  assert.deepEqual(parseRange({ preset: "nope", compare: "nope" }), { preset: "last30", compare: "previous" });
  const future = resolveRange({ preset: "custom", start: "2026-10-01", end: "2026-12-31", compare: "none" }, { now: NOW });
  assert.equal(future.end, "2026-10-16");
});

test("the plan's history clips the start and drops a comparison it can't reach", () => {
  const r = resolveRange({ preset: "last90", compare: "previous" }, { now: NOW, historyDays: 30 });
  assert.equal(r.start, "2026-09-16");
  assert.equal(r.clipped, true);
  assert.equal(r.prevStart, null);
  const ok = resolveRange({ preset: "last7", compare: "previous" }, { now: NOW, historyDays: 30 });
  assert.equal(ok.clipped, false);
  assert.ok(ok.prevStart);
});

test("same period last year handles leap days", () => {
  const r = resolveRange({ preset: "custom", start: "2028-02-29", end: "2028-02-29", compare: "lastYear" }, { now: Date.parse("2028-03-05T00:00:00Z") });
  assert.deepEqual([r.prevStart, r.prevEnd], ["2027-02-28", "2027-02-28"]);
});

test("today and the start of a day follow the timezone, including daylight saving", () => {
  // 14:00 UTC on Oct 16 is already Oct 17 in Auckland.
  assert.equal(todayIn("Pacific/Auckland", NOW), "2026-10-17");
  assert.equal(todayIn("America/Los_Angeles", NOW), "2026-10-16");
  assert.equal(todayIn("Not/AZone", NOW), "2026-10-16");
  assert.equal(dayStart("2026-10-16", "UTC"), "2026-10-16T00:00:00.000Z");
  assert.equal(dayStart("2026-10-16", "America/New_York"), "2026-10-16T04:00:00.000Z"); // EDT
  assert.equal(dayStart("2026-12-16", "America/New_York"), "2026-12-16T05:00:00.000Z"); // EST
  assert.equal(dayStart("2026-03-08", "America/New_York"), "2026-03-08T05:00:00.000Z"); // the night clocks move forward
  assert.equal(dayStart("2026-10-16", "Asia/Bangkok"), "2026-10-15T17:00:00.000Z");
});

test("labels read naturally", () => {
  assert.equal(rangeLabel("2026-09-01", "2026-09-30"), "September 2026");
  assert.equal(rangeLabel("2026-01-01", "2026-12-31"), "2026");
  assert.equal(rangeLabel("2026-09-03", "2026-09-17"), "Sep 3 – Sep 17, 2026");
  assert.equal(rangeLabel("2025-12-28", "2026-01-03"), "Dec 28, 2025 – Jan 3, 2026");
  assert.equal(rangeLabel("2026-09-03", "2026-09-03"), "Sep 3, 2026");
});
