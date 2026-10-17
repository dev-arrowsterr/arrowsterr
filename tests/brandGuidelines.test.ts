import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanGuidelines, cleanLinks, filePath, kitForBrand, MAX_BODY, MAX_FILES, MAX_LINKS } from "../src/lib/brandGuidelines.ts";
import { DEFAULT_KIT } from "../src/lib/brandKit.ts";

test("guideline links: split on spaces, commas and lines, made https, deduped and capped", () => {
  const { links, bad } = cleanLinks("acme.com/brand, https://acme.com/brand#logo\nhttp://figma.com/file/x  not-a-link ftp://acme.com");
  assert.deepEqual(links, ["https://acme.com/brand", "http://figma.com/file/x"]);
  assert.deepEqual(bad, ["not-a-link", "ftp://acme.com"]);
  assert.equal(cleanLinks(Array.from({ length: 40 }, (_, i) => `acme.com/${i}`)).links.length, MAX_LINKS);
});

test("guidelines row: broken fields come back safe, the body is capped, files at most ten", () => {
  assert.equal(cleanGuidelines(null), null);
  assert.equal(cleanGuidelines({ body: "x" }), null);
  const files = Array.from({ length: 14 }, (_, i) => ({ name: `f${i}.pdf`, path: `ws/b/f${i}.pdf`, size: 10, type: "application/pdf", uploaded_at: "2026-10-17" }));
  const g = cleanGuidelines({ brand_id: "b", body: "a".repeat(MAX_BODY + 50), links: ["acme.com", 4], files: [...files, { name: "no path" }], updated_at: null })!;
  assert.equal(g.body.length, MAX_BODY);
  assert.deepEqual(g.links, ["https://acme.com/"]);
  assert.equal(g.files.length, MAX_FILES);
  assert.equal(g.files[0].path, "ws/b/f0.pdf");
});

test("file path: the workspace first, then the brand, with a safe name", () => {
  assert.equal(filePath("ws1", "b1", "Brand Book (v2).PDF", 5), "ws1/b1/5-brand-book-v2-.pdf");
  assert.equal(filePath("ws1", "b1", "???", 5), "ws1/b1/5-file");
});

test("kit for a brand: its own first, then the workspace's only when it is this brand's", () => {
  const own = { key: "b1", website: "acme.com", kit: { ...DEFAULT_KIT, name: "Acme" } };
  const ws = { key: "workspace", website: "https://www.acme.com/", kit: { ...DEFAULT_KIT, name: "Agency" } };
  const brand = { id: "b1", domain: "acme.com" };
  assert.equal(kitForBrand([own, ws], brand, 3)?.name, "Acme");
  assert.equal(kitForBrand([ws], brand, 3)?.name, "Agency"); // learned from this brand's site
  assert.equal(kitForBrand([ws], { id: "b2", domain: "client.io" }, 3), null); // an agency's kit never dresses a client
  assert.equal(kitForBrand([ws], { id: "b2", domain: "client.io" }, 1)?.name, "Agency"); // the only brand
  assert.equal(kitForBrand([], brand, 1), null);
});
