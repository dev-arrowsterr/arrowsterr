import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, promptsFromCsv, mergePrompts } from "../src/lib/csvImport.ts";

test("parseCsv handles quotes, commas and line breaks", () => {
  assert.deepEqual(parseCsv('prompt,topic\n"best tool, cheap",A\n"say ""hi""\nthere",B\n'), [
    ["prompt", "topic"],
    ["best tool, cheap", "A"],
    ['say "hi"\nthere', "B"],
  ]);
});

test("promptsFromCsv reads a prompt column or a plain list", () => {
  assert.deepEqual(promptsFromCsv("topic,prompt\nSEO,what is seo\n"), [{ prompt: "what is seo", topic: "SEO" }]);
  assert.deepEqual(promptsFromCsv("what is seo\nbest crm\n"), [
    { prompt: "what is seo", topic: "" },
    { prompt: "best crm", topic: "" },
  ]);
});

test("mergePrompts skips ones already there and makes new topics", () => {
  const brand = {
    id: "b",
    workspace_id: "w",
    url: "",
    domain: "",
    name: "B",
    logo: "",
    category: "",
    prompts: ["what is seo"],
    daily: true,
    profile: {},
    topics: [{ name: "SEO", prompts: ["what is seo"] }],
  };
  const out = mergePrompts(brand, [
    { prompt: "What is SEO", topic: "SEO" },
    { prompt: "best crm", topic: "CRM" },
    { prompt: "loose one", topic: "" },
  ]);
  assert.equal(out.added, 2);
  assert.equal(out.skipped, 1);
  assert.deepEqual(out.brand.prompts, ["what is seo", "best crm", "loose one"]);
  assert.deepEqual(out.brand.topics, [
    { name: "SEO", prompts: ["what is seo"] },
    { name: "CRM", prompts: ["best crm"] },
  ]);
});
