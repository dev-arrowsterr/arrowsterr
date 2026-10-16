import assert from "node:assert/strict";
import { test } from "node:test";
import { blocksFromSections, BLOCKS, DEFAULT_DOC, moveBlock, parseDoc, toggleBlock } from "../src/lib/reportDoc.ts";

test("a doc from the database is cleaned: unknown blocks go, each block once, missing ones come back off", () => {
  const d = parseDoc({ blocks: [{ id: "traffic", on: true }, { id: "nope", on: true }, { id: "traffic", on: false }, { id: "kpis", on: false }] });
  assert.deepEqual(d.blocks.slice(0, 2), [
    { id: "traffic", on: true },
    { id: "kpis", on: false },
  ]);
  assert.equal(d.blocks.length, BLOCKS.length);
  assert.ok(d.blocks.slice(2).every((b) => !b.on));
});

test("an empty or broken doc is the default with every block on", () => {
  assert.deepEqual(parseDoc(null), DEFAULT_DOC);
  assert.deepEqual(parseDoc("junk"), DEFAULT_DOC);
});

test("a summary is kept only when it is whole", () => {
  assert.equal(parseDoc({ summary: { headline: "Up" } }).summary, null);
  const s = parseDoc({ summary: { headline: "Up", points: ["a", 2], next: [], key: "k", at: "t" } }).summary;
  assert.deepEqual(s, { headline: "Up", points: ["a"], next: [], key: "k", at: "t" });
});

test("blocks move and toggle without losing any", () => {
  const up = moveBlock(DEFAULT_DOC, "summary", -1);
  assert.deepEqual(up.blocks.slice(0, 2).map((b) => b.id), ["summary", "kpis"]);
  assert.equal(moveBlock(DEFAULT_DOC, "kpis", -1), DEFAULT_DOC); // already first
  const off = toggleBlock(DEFAULT_DOC, "traffic");
  assert.equal(off.blocks.find((b) => b.id === "traffic")!.on, false);
  assert.equal(off.blocks.length, DEFAULT_DOC.blocks.length);
});

test("old links' sections map to blocks in the old order", () => {
  const b = blocksFromSections(["competitors"]);
  const on = b.filter((x) => x.on).map((x) => x.id);
  assert.deepEqual(on, ["summary", "wins", "competitors"]);
  assert.ok(blocksFromSections(undefined).every((x) => x.on));
});
