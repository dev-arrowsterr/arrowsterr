import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanOps, describeOps } from "../src/lib/sheetAi.ts";

test("cleanOps keeps only allowed changes on real rows", () => {
  const ids = new Set(["a", "b"]);
  const ops = cleanOps(
    [
      { op: "update", ids: ["a", "zzz"], set: { status: "writing", due_date: "2026-10-12", owner: "Ana", color: "red", c1: "x" } },
      { op: "update", ids: ["b"], set: { status: "done", due_date: "next week" } },
      { op: "delete", ids: ["b"] },
      { op: "approve", ids: ["a"] },
      { op: "add", keywords: ["  crm   tips ", ""] },
    ],
    "calendar",
    ids,
    ["c1"],
  );
  assert.deepEqual(ops, [
    { op: "update", ids: ["a"], set: { status: "writing", due_date: "2026-10-12", owner: "Ana", c1: "x" } },
    { op: "delete", ids: ["b"] },
    { op: "add", keywords: ["crm tips"] },
  ]);
  assert.deepEqual(cleanOps([{ op: "delete", ids: ["a"] }, { op: "approve", ids: ["a"] }], "plan", ids, []), [{ op: "approve", ids: ["a"] }]);
});

test("describeOps writes one line per change", () => {
  const lines = describeOps([{ op: "update", ids: ["a"], set: { status: "writing" } }, { op: "delete", ids: ["a", "b", "c", "d"] }], (id) => id.toUpperCase(), (k) => k);
  assert.deepEqual(lines, ["Set status to writing on A", "Remove 4 rows"]);
});
