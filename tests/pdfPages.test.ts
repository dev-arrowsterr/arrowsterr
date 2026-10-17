import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_KIT } from "../src/lib/brandKit.ts";
import type { Chat, Run } from "../src/lib/chats.ts";
import { answered, brandStats, domainRows, competitorDomains, topicRows } from "../src/lib/metrics.ts";
import { ARROWSTERR, fileName, tokensFor } from "../src/lib/pdf/design.ts";
import { cleanParams, competitorsPdf, pdfData, positionScore, promptsPdf, sourcesPdf, viewOf } from "../src/lib/pdf/pages.ts";

const NOW = Date.parse("2026-10-17T12:00:00Z");
const day = (n: number) => new Date(NOW - n * 864e5).toISOString();
const chat = (engine: string, prompt: string, brands: [string, number][], sources: string[] = []): Chat => ({
  engine,
  prompt,
  text: "answer",
  error: null,
  brands: brands.map(([name, position]) => ({ name, position, sentiment: 70 })),
  sources: sources.map((url) => ({ url, title: null, domain: new URL(url).hostname.replace(/^www\./, "") })),
});
const brand = { name: "Acme", domain: "acme.com", logo: null };
const topics = [
  { name: "CRM", prompts: ["best crm", "crm for startups"] },
  { name: "Email", prompts: ["email tool"] },
];
// Two days in this period, one in the period before (days = 7).
const runs: Run[] = [
  { at: day(10), engines: ["ChatGPT"], chats: [chat("ChatGPT", "best crm", [["Rival", 1]])] },
  {
    at: day(3),
    engines: ["ChatGPT", "Gemini"],
    chats: [
      chat("ChatGPT", "best crm", [["Acme", 1], ["Rival", 2]], ["https://acme.com/crm", "https://g2.com/crm"]),
      chat("Gemini", "best crm", [["Rival", 1]], ["https://g2.com/crm"]),
      chat("ChatGPT", "email tool", [["Mailo", 1]], ["https://reddit.com/r/email"]),
    ],
  },
  { at: day(1), engines: ["ChatGPT"], chats: [chat("ChatGPT", "crm for startups", [["Acme", 2], ["Rival", 1]], ["https://acme.com/start"])] },
];
const all = { days: 7, topic: null, model: null };
const view = (p = all) => viewOf(brand, runs, topics, ["ChatGPT", "Gemini"], p, NOW);

test("filters: days stay 1 to 365 and inside the plan's history; 'All' means no filter", () => {
  assert.deepEqual(cleanParams({ days: 9999, topic: "All", model: "All" }), { days: 365, topic: null, model: null });
  assert.equal(cleanParams({ days: 90 }, 30).days, 30);
  assert.equal(cleanParams({ days: "abc" }).days, 30);
  assert.equal(cleanParams({ days: 0 }).days, 30, "no days means the default");
  assert.equal(cleanParams({ days: -5 }).days, 1);
  assert.deepEqual(cleanParams({ topic: " CRM ", model: "ChatGPT" }), { days: 30, topic: "CRM", model: "ChatGPT" });
  assert.deepEqual(cleanParams(null), { days: 30, topic: null, model: null });
});

test("the PDF's numbers are the page's numbers: the same functions on the same answers", () => {
  const v = view();
  const chats = answered(v.current, v.filter);
  assert.equal(chats.length, 4, "only this period's answers");
  const stats = brandStats(chats, { name: "Acme", domain: "acme.com" });
  const p = promptsPdf(v);
  assert.equal(p.scores!.visibility.now, stats.find((s) => s.isYou)!.visibility);
  assert.equal(p.scores!.position.now, positionScore(stats.find((s) => s.isYou)!.position));
  assert.deepEqual(
    p.topics.map((t) => [t.name, t.visibility]),
    topicRows(chats, topics, v.engines, "Acme").map((t) => [t.topic, t.visibility]),
  );
  const s = sourcesPdf(v);
  assert.deepEqual(
    s.sites.map((x) => x.domain),
    domainRows(chats, "acme.com", competitorDomains(stats)).slice(0, 20).map((d) => d.domain),
  );
});

test("prompts: every topic is open with all its prompts, and the change compares with the period before", () => {
  const p = promptsPdf(view());
  assert.deepEqual(p.topics.map((t) => t.name), ["CRM", "Email"]);
  assert.deepEqual(p.topics[0].prompts.map((x) => x.prompt).sort(), ["best crm", "crm for startups"]);
  assert.equal(p.scores!.visibility.before, 0, "Acme was not named in the week before");
  assert.match(p.headline, /up/);
  assert.ok(p.trend.names[0] === "Acme" && p.trend.names.includes("Rival"));
});

test("topic and model filters narrow the PDF the same way the top bar does", () => {
  const email = promptsPdf(view({ days: 7, topic: "Email", model: null }));
  assert.deepEqual(email.topics.map((t) => t.name), ["Email"]);
  assert.equal(email.answers, 1);
  const gemini = view({ days: 7, topic: null, model: "Gemini" });
  assert.deepEqual(gemini.engines, ["Gemini"]);
  assert.equal(promptsPdf(gemini).answers, 1);
});

test("competitors: you first, your top rival in the battle card, leaders for every topic", () => {
  const c = competitorsPdf(view());
  assert.equal(c.brands[0].name, "Acme");
  assert.equal(c.battle!.a, "Acme");
  assert.equal(c.battle!.b, "Rival");
  assert.deepEqual(c.leaders.rows.map((r) => r.topic), ["CRM", "Email"]);
  assert.ok(c.quadrant.every((d) => d.position > 0));
});

test("sources: shares add up, and your own cited pages are listed", () => {
  const s = sourcesPdf(view());
  const total = s.shares.owned + s.shares.third + s.shares.reviews;
  assert.ok(Math.abs(total - 100) < 0.01, `shares add to ${total}`);
  assert.deepEqual(s.owned.map((o) => o.url).sort(), ["https://acme.com/crm", "https://acme.com/start"]);
});

test("no answers at all: every page still builds, with empty parts and no made-up numbers", () => {
  const empty = viewOf(brand, [], topics, ["ChatGPT"], all, NOW);
  for (const page of ["prompts", "competitors", "sources"] as const) {
    const d = pdfData(page, empty);
    assert.equal(d.answers, 0);
  }
  assert.equal(promptsPdf(empty).scores, null);
  assert.equal(competitorsPdf(empty).battle, null);
  assert.deepEqual(sourcesPdf(empty).shares, { owned: 0, third: 0, reviews: 0 });
});

test("design: the brand look needs a kit and a white label plan, or the file is Arrowsterr's", () => {
  const kit = { ...DEFAULT_KIT, name: "Northwind", logo: "https://northwind.com/logo.svg", footer: "hi@northwind.com" };
  assert.equal(tokensFor("brand", kit, false), ARROWSTERR);
  assert.equal(tokensFor("brand", null, true), ARROWSTERR);
  assert.equal(tokensFor("arrowsterr", kit, true), ARROWSTERR);
  const b = tokensFor("brand", kit, true);
  assert.equal(b.design, "brand");
  assert.equal(b.maker, "Northwind");
  assert.equal(b.footer, "hi@northwind.com");
  assert.ok(!JSON.stringify(b).toLowerCase().includes("arrowsterr"), "no Arrowsterr anywhere in the brand design");
});

test("file names: brand, title and day, with nothing unsafe", () => {
  assert.equal(fileName("AI Visibility by Prompt", "Acme / Inc.", new Date("2026-10-17T09:00:00Z")), "Acme-Inc-AI-Visibility-by-Prompt-2026-10-17.pdf");
  assert.equal(fileName("", "", new Date("2026-10-17T09:00:00Z")), "2026-10-17.pdf");
});
