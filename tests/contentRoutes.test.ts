import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTENT_ALIASES, CONTENT_SLUGS, contentPageFromPath } from "../src/lib/contentRoutes.ts";

test("content: each page opens at its own address", () => {
  assert.equal(contentPageFromPath("/editorial-calendar"), "calendar");
  assert.equal(contentPageFromPath("/agentic-writer"), "writer");
  assert.equal(contentPageFromPath("/library/"), "library");
  assert.equal(contentPageFromPath("/brand"), "brand");
});

test("content: old Opportunities, Calendar and Content Plan addresses open the Editorial Calendar", () => {
  for (const p of ["/opportunities", "/calendar", "/content-plan", "/content-calendar", "/topic-bank", "/agentic-research", "/content-intelligence"]) assert.equal(contentPageFromPath(p), "calendar", p);
});

test("content: /content opens the Library, the old Brand Voice setting opens Brand", () => {
  assert.equal(contentPageFromPath("/content"), "library");
  assert.equal(contentPageFromPath("/settings/brand-voice"), "brand");
});

test("content: an alias never hides a page's own address, and other paths are not ours", () => {
  for (const slug of Object.values(CONTENT_SLUGS)) assert.equal(CONTENT_ALIASES[slug], undefined, slug);
  assert.equal(contentPageFromPath("/prompts"), null);
});
