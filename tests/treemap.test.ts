import { test } from "node:test";
import assert from "node:assert/strict";
import { treemap } from "../src/lib/treemap.ts";

test("treemap fills the area and sizes boxes by value", () => {
  const boxes = treemap([{ k: "a", v: 6 }, { k: "b", v: 3 }, { k: "c", v: 1 }, { k: "z", v: 0 }], (x) => x.v);
  assert.equal(boxes.length, 3);
  const area = (k: string) => {
    const b = boxes.find((x) => x.item.k === k)!;
    return b.w * b.h;
  };
  assert.ok(Math.abs(area("a") - 6000) < 1e-6);
  assert.ok(Math.abs(boxes.reduce((n, b) => n + b.w * b.h, 0) - 10000) < 1e-6);
  for (const b of boxes) assert.ok(b.x >= -1e-9 && b.y >= -1e-9 && b.x + b.w <= 100 + 1e-9 && b.y + b.h <= 100 + 1e-9);
});
