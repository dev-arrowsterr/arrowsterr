import assert from "node:assert/strict";
import { test } from "node:test";
import { canImport, importPatch, inWriterAt } from "../src/lib/writerImport.ts";

const AT = "2026-10-17T09:00:00.000Z";

test("import: sets extra.in_writer_at and keeps every other extra field", () => {
  const item = { status: "planned", extra: { slug: "/crm-for-agencies", c1: 4 } };
  assert.deepEqual(importPatch(item, AT), { extra: { slug: "/crm-for-agencies", c1: 4, in_writer_at: AT } });
  assert.deepEqual(importPatch({ extra: undefined }, AT), { extra: { in_writer_at: AT } });
});

test("import: the change never touches status", () => {
  const p = importPatch({ extra: {} }, AT);
  assert.deepEqual(Object.keys(p), ["extra"]);
});

test("import: week 1's write_queued_at counts as imported", () => {
  assert.equal(inWriterAt({ extra: { write_queued_at: "2026-10-01T00:00:00.000Z" } }), "2026-10-01T00:00:00.000Z");
  assert.equal(inWriterAt({ extra: { in_writer_at: AT, write_queued_at: "2026-10-01T00:00:00.000Z" } }), AT);
  assert.equal(inWriterAt({ extra: { in_writer_at: null } }), null);
  assert.equal(inWriterAt({}), null);
});

test("import: published pieces and pieces already in the writer can't be imported again", () => {
  assert.equal(canImport({ status: "planned" }), true);
  assert.equal(canImport({ status: "writing" }), true);
  assert.equal(canImport({ status: "published" }), false);
  assert.equal(canImport({ status: "planned", extra: { in_writer_at: AT } }), false);
  assert.equal(canImport({ status: "writing", extra: { write_queued_at: AT } }), false);
});

test("import: undo puts extra back the way it was", () => {
  const before = { status: "planned", extra: { slug: "/a" } };
  const after = { ...before, ...importPatch(before, AT) };
  assert.equal(inWriterAt(after), AT);
  const back = { ...after, extra: before.extra };
  assert.equal(inWriterAt(back), null);
  assert.equal(back.status, "planned");
});
