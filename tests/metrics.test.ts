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

test("prompt detail uses the latest answer per model and flags sites that skip you", async () => {
  const { promptDetail } = await import("../src/lib/metrics.ts");
  const runs = [
    { at: "2026-10-01T00:00:00Z", engines: ["ChatGPT"], chats: [chat("ChatGPT", "best crm", ["Rival"], ["https://g2.com/a"])] },
    {
      at: "2026-10-02T00:00:00Z",
      engines: ["ChatGPT", "Gemini"],
      chats: [
        chat("ChatGPT", "best crm", ["Acme", "Rival"], ["https://acme.com/x", "https://acme.com/x#top"]),
        chat("Gemini", "best crm", ["Rival"], ["https://listicle.com/best", "https://listicle.com/best/"]),
      ],
    },
  ];
  const d = promptDetail(runs, "best crm", ["ChatGPT", "Gemini", "Claude"], { name: "Acme", domain: "acme.com" }, () => true);
  assert.equal(d.answered, 2);
  assert.equal(d.engines[0].rank, 1);
  assert.equal(d.engines[0].sources.length, 1);
  assert.equal(d.engines[1].rank, null);
  assert.equal(d.engines[2].answered, false);
  assert.deepEqual(d.brands.map((b) => [b.name, b.engines]), [["Rival", 2], ["Acme", 1]]);
  const listicle = d.sites.find((s) => s.domain === "listicle.com")!;
  assert.equal(listicle.pages.length, 1);
  assert.equal(listicle.withoutYou, true);
  assert.equal(d.sites.find((s) => s.domain === "acme.com")!.type, "You");
});

test("quote finds the sentence that names the brand", async () => {
  const { quoteOf } = await import("../src/lib/quote.ts");
  const text = "Here are options.\n1. **Acme** is great for teams. It has [reviews](https://x.com).\n2. Rival works too.";
  assert.equal(quoteOf(text, "Acme"), "Acme is great for teams.");
  assert.equal(quoteOf(text, "Nope"), null);
});
