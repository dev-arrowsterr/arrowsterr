import { test } from "node:test";
import assert from "node:assert/strict";
import { onUndoMessage, quietly, recordUndo, redoLast, undoLast } from "../src/lib/undo.ts";

test("undo: steps undo and redo in order, merge by key, and stay quiet inside quietly()", async () => {
  const said: string[] = [];
  onUndoMessage((m) => said.push(m));
  let v = 0;
  const set = (n: number) => {
    const was = v;
    recordUndo({ label: `set ${n}`, undo: () => set(was), redo: () => set(n), key: "cell" });
    v = n;
  };
  set(1);
  set(2); // merges with set(1): one step from 0 to 2
  await undoLast();
  assert.equal(v, 0);
  await redoLast();
  assert.equal(v, 2);
  await undoLast();
  assert.equal(v, 0);
  await undoLast();
  assert.equal(said.at(-1), "Nothing to undo");
  quietly(() => set(5));
  await undoLast();
  assert.equal(v, 5, "a quiet change records nothing");
});
