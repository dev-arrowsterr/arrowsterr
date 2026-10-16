import assert from "node:assert/strict";
import { test } from "node:test";
import { aiCites, isPending, normalizeSection } from "../src/lib/industry.ts";

test("normalizeSection: reads the list wherever it sits, with names, links, scores and reach", () => {
  const rows = normalizeSection("websites", {
    data: {
      results: [
        { domain: "techcrunch.com", affinity: 12.34, visits: 5000 },
        { name: "The Verge", url: "https://www.theverge.com/", score: 0.42 },
        { name: "techcrunch.com" },
        { nothing: true },
        "junk",
      ],
    },
  });
  assert.deepEqual(rows, [
    { name: "techcrunch.com", url: "https://techcrunch.com", score: 12.3, reach: 5000 },
    { name: "The Verge", url: "https://www.theverge.com/", score: 42, reach: null },
  ]);
});

test("normalizeSection: subreddits get r/ and a link; a bare list works; rows stop at 25", () => {
  assert.deepEqual(normalizeSection("reddit", [{ subreddit: "SaaS", members: 300000 }, { name: "r/marketing" }]), [
    { name: "r/SaaS", url: "https://www.reddit.com/r/SaaS", score: null, reach: 300000 },
    { name: "r/marketing", url: "https://www.reddit.com/r/marketing", score: null, reach: null },
  ]);
  const many = Array.from({ length: 40 }, (_, i) => ({ name: `Show ${i}` }));
  assert.equal(normalizeSection("podcasts", { items: many }).length, 25);
  assert.deepEqual(normalizeSection("podcasts", null), []);
  assert.deepEqual(normalizeSection("social", { status: "ok" }), []);
});

test("isPending: only clear 'still building' states", () => {
  assert.ok(isPending({ status: "processing" }));
  assert.ok(isPending({ data: { status: "Pending" } }));
  assert.ok(!isPending({ status: "complete", data: [] }));
  assert.ok(!isPending([]));
  assert.ok(!isPending(null));
});

test("aiCites: sites by domain, subreddits by thread, others not matched", () => {
  const chats = [
    { sources: [{ url: "https://www.techcrunch.com/2026/a" }, { url: "https://www.reddit.com/r/SaaS/comments/abc/x" }] },
    { sources: [{ url: "https://news.techcrunch.com/b" }] },
    { sources: [{ url: "https://www.reddit.com/r/SaaSy/comments/def/y" }] },
  ];
  assert.equal(aiCites("websites", { name: "TechCrunch", url: "https://techcrunch.com", score: null, reach: null }, chats), 2);
  assert.equal(aiCites("press", { name: "Nobody", url: "https://nobody.com", score: null, reach: null }, chats), 0);
  assert.equal(aiCites("reddit", { name: "r/SaaS", url: null, score: null, reach: null }, chats), 1);
  assert.equal(aiCites("websites", { name: "No link", url: null, score: null, reach: null }, chats), null);
  assert.equal(aiCites("podcasts", { name: "Show", url: "https://show.fm", score: null, reach: null }, chats), null);
});
