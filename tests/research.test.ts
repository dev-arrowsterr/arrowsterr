import { test } from "node:test";
import assert from "node:assert/strict";
import { groupBySerp, pick, slots, type AgentKeyword } from "../src/lib/research.ts";

const kw = (keyword: string, volume: number | null, theme = "A"): AgentKeyword => ({
  keyword, volume, kd: 20, cpc: null, intent: null, trend: [], serp: [], stage: "bofu", theme, group: -1,
});

test("keywords sharing 3 or more top results become one page, led by the biggest", () => {
  const list = [kw("best crm", 100), kw("top crm software", 500), kw("crm pricing", 50)];
  const serps = new Map([
    ["best crm", ["a.com/1", "b.com/2", "c.com/3", "d.com/4"]],
    ["top crm software", ["a.com/1", "b.com/2", "c.com/3", "x.com"]],
    ["crm pricing", ["a.com/1", "y.com", "z.com"]],
  ]);
  const groups = groupBySerp(list, serps);
  assert.equal(groups.length, 2);
  const big = groups.find((g) => g.keywords.length === 2)!;
  assert.equal(big.primary, "top crm software");
  assert.equal(big.volume, 600);
  assert.equal(list[0].group, list[1].group);
  assert.notEqual(list[0].group, list[2].group);
});

test("pick takes turns across themes", () => {
  const list = [kw("a1", 900, "A"), kw("a2", 800, "A"), kw("a3", 700, "A"), kw("b1", 10, "B")];
  assert.deepEqual(pick(list, 2, ["A", "B"]).map((k) => k.keyword), ["a1", "b1"]);
});

test("slots puts 2 posts a week on Monday and Wednesday, never before the start", () => {
  // 2026-10-07 is a Wednesday.
  assert.deepEqual(slots(new Date(2026, 9, 7), 2, 4), ["2026-10-07", "2026-10-12", "2026-10-14", "2026-10-19"]);
});

test("cleanUrl keeps real pages and drops junk", async () => {
  const { cleanUrl } = await import("../src/lib/urls.ts");
  assert.equal(cleanUrl("https://www.acme.com/blog/how-to-pick-a-crm/?utm=x#top", "acme.com"), "https://www.acme.com/blog/how-to-pick-a-crm");
  assert.equal(cleanUrl("https://acme.com/tag/crm/", "acme.com"), null);
  assert.equal(cleanUrl("https://acme.com/wp-content/uploads/a.png", "acme.com"), null);
  assert.equal(cleanUrl("https://other.com/page", "acme.com"), null);
  assert.equal(cleanUrl("https://blog.acme.com/post-one", "acme.com"), "https://blog.acme.com/post-one");
});

test("Search Console opportunities", async () => {
  const { opportunities } = await import("../src/lib/opportunities.ts");
  const ops = opportunities({
    days: 28,
    property: "sc-domain:acme.com",
    totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    totalsPrev: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    series: [],
    queries: [],
    pages: [{ page: "https://acme.com/a", clicks: 5, impressions: 900, ctr: 0.005, position: 9, prevClicks: 40, prevPosition: 4 }],
    pairs: [
      { page: "https://acme.com/a", query: "crm for dentists", clicks: 5, impressions: 900, ctr: 0.005, position: 9 },
      { page: "https://acme.com/b", query: "best crm", clicks: 2, impressions: 400, ctr: 0.005, position: 2 },
      { page: "https://acme.com/c", query: "best crm", clicks: 1, impressions: 200, ctr: 0.005, position: 6 },
    ],
  });
  const kinds = ops.map((o) => `${o.kind}|${o.query}`);
  assert.ok(kinds.includes("Close to top 3|crm for dentists"));
  assert.ok(kinds.includes("Low click rate|best crm"));
  assert.ok(kinds.includes("Pages competing|best crm"));
  assert.ok(kinds.includes("Losing clicks|crm for dentists"));
});

test("visitor journeys: sources, visits and score", async () => {
  const { sourceOf, summarize } = await import("../src/lib/journey.ts");
  const { persona } = await import("../src/lib/names.ts");
  assert.deepEqual(sourceOf("chatgpt.com", "acme.com"), { source: "ChatGPT", kind: "ai" });
  assert.deepEqual(sourceOf("www.google.com", "acme.com"), { source: "Google", kind: "search" });
  assert.deepEqual(sourceOf("www.acme.com", "acme.com"), { source: "Direct", kind: "direct" });
  assert.equal(sourceOf("lnkd.in", "acme.com").source, "LinkedIn");
  assert.equal(persona("abc").name, persona("abc").name);

  const s = { id: "abc", browser: "chrome", os: "Mac OS", device: "laptop", country: "US", region: null, city: "Austin", firstAt: "", lastAt: "", visits: 1, views: 0 };
  const steps = [
    { at: "2026-10-01T10:00:00Z", visitId: "v1", path: "/blog/x", query: null, referrer: "chatgpt.com", title: null, event: null },
    { at: "2026-10-01T10:02:00Z", visitId: "v1", path: "/pricing", query: null, referrer: null, title: null, event: null },
    { at: "2026-10-04T09:00:00Z", visitId: "v2", path: "/pricing", query: null, referrer: null, title: null, event: null },
    { at: "2026-10-04T09:04:00Z", visitId: "v2", path: "/pricing", query: null, referrer: null, title: null, event: "Booking click" },
  ];
  const v = summarize(s, steps, "acme.com");
  assert.equal(v.visits, 2);
  assert.equal(v.source, "ChatGPT");
  assert.deepEqual(v.intentPages, ["Pricing"]);
  assert.deepEqual(v.actions, ["Booking click"]);
  assert.equal(v.label, "Hot");
});
