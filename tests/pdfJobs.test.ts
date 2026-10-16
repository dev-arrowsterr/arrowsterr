import assert from "node:assert/strict";
import { test } from "node:test";
import { isPdf, MAX_PDF, overflow } from "../src/lib/pdfJobs.ts";

test("only the newest 5 PDFs of a report stay", () => {
  assert.deepEqual(overflow(["1.pdf", "2.pdf", "3.pdf"]), []);
  assert.deepEqual(overflow(["9.pdf", "10.pdf", "11.pdf", "12.pdf", "13.pdf", "14.pdf", "8.pdf"]).sort(), ["8.pdf", "9.pdf"], "by job number, not by name");
  assert.deepEqual(overflow(["a.pdf", "1.pdf"], 1), [], "files that aren't ours are left alone");
});

test("only real PDFs are stored", () => {
  assert.equal(isPdf(new TextEncoder().encode("%PDF-1.7\n...")), true);
  assert.equal(isPdf(new TextEncoder().encode("<html>")), false);
  assert.equal(isPdf(new Uint8Array(0)), false);
  const big = new Uint8Array(MAX_PDF + 1);
  big.set(new TextEncoder().encode("%PDF-"));
  assert.equal(isPdf(big), false, "over 50 MB");
});
