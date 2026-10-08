import { test } from "node:test";
import assert from "node:assert/strict";
import { citedRank, promptGaps, topicGrid, topicRows } from "../src/lib/metrics.ts";
import type { Chat } from "../src/lib/chats.ts";

const chat = (engine: string, prompt: string, brands: string[], sources: string[] = []): Chat => ({
  engine,
  prompt,
  text: "x",
  error: null,
  brands: brands.map((name, i) => ({ name, position: i + 1, sentiment: 70 })),
  sources: sources.map((url) => ({ url, title: null, domain: new URL(url).hostname.replace(/^www\./, "") })) as Chat["sources"],
});

const topics = [
  { name: "CRM", prompts: ["best crm", "crm for startups"] },
  { name: "Email", prompts: ["email tools"] },
];
const chats = [
  chat("ChatGPT", "best crm", ["Acme", "Rival"]),
  chat("Gemini", "best crm", ["Rival"]),
  chat("ChatGPT", "crm for startups", ["Rival"]),
  chat("ChatGPT", "email tools", ["Acme"]),
];

test("topic rows give visibility per topic and per model", () => {
  const [crm, email] = topicRows(chats, topics, ["ChatGPT", "Gemini"], "Acme");
  assert.equal(Math.round(crm.visibility!), 33);
  assert.equal(crm.byEngine.ChatGPT, 50);
  assert.equal(crm.byEngine.Gemini, 0);
  assert.equal(email.visibility, 100);
});

test("the topic grid names the leader of each topic", () => {
  const [crm, email] = topicGrid(chats, topics, ["Acme", "Rival"]);
  assert.equal(crm.leader, "Rival");
  assert.equal(email.leader, "Acme");
});

test("gaps list prompts where another brand beats you, biggest first", () => {
  const gaps = promptGaps(chats, topics, "Acme");
  assert.deepEqual(gaps.map((g) => g.prompt), ["crm for startups", "best crm"]);
  assert.equal(gaps[0].leader, "Rival");
});

test("cited rank finds your site in the sources, counting from 1", () => {
  const c = chat("ChatGPT", "best crm", [], ["https://g2.com/x", "https://www.acme.com/blog/crm"]);
  assert.deepEqual(citedRank(c, "acme.com"), { rank: 2, url: "https://www.acme.com/blog/crm" });
  assert.equal(citedRank(c, "other.com"), null);
});
