import { test } from "node:test";
import assert from "node:assert/strict";
import { weekOf, type Metric } from "../src/lib/visibility.ts";

const day = (d: string, engine: string, named: string, answers: number, mentions = 0, you = false): Metric => ({ day: d, engine, named, is_you: you, answers, mentions });

test("weekOf compares the last 7 days with the 7 before", () => {
  const rows: Metric[] = [
    // last week: 10 answers, named in 2
    day("2026-10-01", "ChatGPT", "", 10),
    day("2026-10-01", "ChatGPT", "Acme", 10, 2, true),
    // this week: 20 answers across two AIs, named in 10; a rival in 15
    day("2026-10-08", "ChatGPT", "", 10),
    day("2026-10-08", "ChatGPT", "Acme", 10, 6, true),
    day("2026-10-08", "ChatGPT", "Rival", 10, 9),
    day("2026-10-09", "Gemini", "", 10),
    day("2026-10-09", "Gemini", "Acme", 10, 4, true),
    day("2026-10-09", "Gemini", "Rival", 10, 6),
    // today is not counted
    day("2026-10-12", "ChatGPT", "", 10),
    day("2026-10-12", "ChatGPT", "Acme", 10, 0, true),
  ];
  const w = weekOf(rows, "2026-10-12")!;
  assert.equal(w.visibility, 50);
  assert.equal(w.change, 30);
  assert.deepEqual(w.byEngine, [
    { engine: "ChatGPT", visibility: 60 },
    { engine: "Gemini", visibility: 40 },
  ]);
  assert.deepEqual(
    w.top.map((t) => [t.name, t.visibility]),
    [["Rival", 75]],
  );
});

test("weekOf is empty without answers this week, and has no change without last week", () => {
  assert.equal(weekOf([day("2026-09-01", "ChatGPT", "", 10)], "2026-10-12"), null);
  const w = weekOf([day("2026-10-10", "ChatGPT", "", 4), day("2026-10-10", "ChatGPT", "Acme", 4, 1, true)], "2026-10-12")!;
  assert.equal(w.visibility, 25);
  assert.equal(w.change, null);
});
