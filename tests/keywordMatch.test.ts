import assert from "node:assert/strict";
import { test } from "node:test";
import { broadWords, exactRegex, filterWords, stem, wordGroups, wordList } from "../src/lib/research.ts";

test("stems cut plurals so every form matches", () => {
  assert.equal(stem("tools"), "tool");
  assert.equal(stem("companies"), "compan");
  assert.equal(stem("business"), "business");
  assert.equal(stem("businesses"), "business");
  assert.equal(stem("boxes"), "box");
  assert.equal(stem("status"), "status");
  assert.equal(stem("crm"), "crm");
});

test("broad match needs every real word, up to 4, and skips filler words", () => {
  assert.deepEqual(broadWords("crm software for small businesses"), ["crm", "software", "small", "business"]);
  assert.deepEqual(broadWords("best CRM tools"), ["best", "crm", "tool"]);
  assert.deepEqual(broadWords("the"), ["the"]);
});

test("exact match finds the seed as whole words only", () => {
  const re = new RegExp(exactRegex("crm software"));
  assert.ok(re.test("best crm software"));
  assert.ok(re.test("crm software for startups"));
  assert.ok(!re.test("crm softwares"));
  assert.ok(!re.test("hubcrm software"));
  assert.ok(new RegExp(exactRegex("c++ ide")).test("best c++ ide"));
});

test("include and exclude words narrow the list, any word form", () => {
  const rows = ["free crm", "free crm tools", "crm tool for startups", "salesforce crm"].map((keyword) => ({ keyword }));
  assert.deepEqual(filterWords(rows, wordList("tool"), []).map((r) => r.keyword), ["free crm tools", "crm tool for startups"]);
  assert.deepEqual(filterWords(rows, [], wordList("free, salesforce")).map((r) => r.keyword), ["crm tool for startups"]);
  assert.deepEqual(filterWords(rows, wordList("for startups"), []).map((r) => r.keyword), ["crm tool for startups"]);
});

test("word groups count keywords per word besides the seed, biggest first", () => {
  const rows = [
    { keyword: "free crm", volume: 100 },
    { keyword: "free crm software", volume: 50 },
    { keyword: "crm tools", volume: 30 },
    { keyword: "best crm tool", volume: 20 },
    { keyword: "crm for startups", volume: 5 },
  ];
  const g = wordGroups(rows, "crm");
  assert.deepEqual(g.map((x) => [x.word, x.count, x.volume]), [
    ["free", 2, 150],
    ["tool", 2, 50],
  ]);
});
