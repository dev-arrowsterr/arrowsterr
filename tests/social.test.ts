import assert from "node:assert/strict";
import { test } from "node:test";
import { authorOf, citedKeys, namesBrand, pickTargets, shareOfVoice, socialSourceOf, splitSnippetDate, threadKey, type Mention } from "../src/lib/social.ts";

test("namesBrand: whole words only, any case, also the domain", () => {
  assert.ok(namesBrand("Has anyone tried Notion for wikis?", "Notion"));
  assert.ok(namesBrand("notion's new AI is good", "Notion"));
  assert.ok(!namesBrand("a notional amount", "Notion"));
  assert.ok(!namesBrand("Peeking at the data", "Peec AI"));
  assert.ok(namesBrand("We moved to monday.com last year", "Monday.com"));
  assert.ok(namesBrand("Check peec.ai for this", "Peec AI", "peec.ai"));
  assert.ok(namesBrand("SE Ranking vs Semrush", "SE Ranking"));
  assert.ok(!namesBrand("seranking", "SE Ranking"));
  assert.ok(!namesBrand("anything", " ", null));
});

test("threadKey: one key per Reddit thread and HN item, however it is linked", () => {
  const a = threadKey("https://www.reddit.com/r/SaaS/comments/1abc23/best_tools/");
  assert.equal(a, "reddit:1abc23");
  assert.equal(threadKey("https://old.reddit.com/r/SaaS/comments/1ABC23/best_tools/xyz9/?utm_source=chatgpt.com"), a);
  assert.equal(threadKey("https://redd.it/1abc23"), a);
  assert.equal(threadKey("https://news.ycombinator.com/item?id=4012"), "hn:4012");
  assert.equal(threadKey("https://www.example.com/blog/post/?ref=x"), "example.com/blog/post");
  assert.equal(threadKey("not a url"), "not a url");
});

test("socialSourceOf and authorOf read the site and the poster from the link", () => {
  assert.equal(socialSourceOf("https://www.reddit.com/r/SEO/comments/abc/x"), "reddit");
  assert.equal(socialSourceOf("https://twitter.com/jack/status/1"), "x");
  assert.equal(socialSourceOf("https://youtu.be/xyz"), "youtube");
  assert.equal(socialSourceOf("https://news.ycombinator.com/item?id=1"), "hn");
  assert.equal(socialSourceOf("https://techcrunch.com/a"), null);
  assert.equal(authorOf("https://www.reddit.com/r/SEO/comments/abc/x"), "r/SEO");
  assert.equal(authorOf("https://x.com/jack/status/1"), "@jack");
  assert.equal(authorOf("https://x.com/search?q=a"), null);
  assert.equal(authorOf("https://www.linkedin.com/posts/jane-doe_ai-seo-activity-123"), "jane-doe");
  assert.equal(authorOf("https://techcrunch.com/a"), null);
});

test("splitSnippetDate: reads Google's date prefix and leaves the text", () => {
  const now = Date.UTC(2026, 9, 16, 12);
  assert.deepEqual(splitSnippetDate("3 days ago — We switched from X to Y", now), { at: new Date(now - 3 * 864e5).toISOString(), text: "We switched from X to Y" });
  assert.deepEqual(splitSnippetDate("Oct 12, 2026 — Big launch today", now), { at: "2026-10-12T00:00:00.000Z", text: "Big launch today" });
  assert.deepEqual(splitSnippetDate("Plain text - with a dash later", now), { at: null, text: "Plain text - with a dash later" });
  assert.deepEqual(splitSnippetDate("No date here", now), { at: null, text: "No date here" });
});

test("pickTargets: top names by default, picks when set, never you, never past the limit", () => {
  const ranked = [
    { name: "Acme", domain: "acme.com" },
    { name: "YouCo", domain: "you.co" },
    { name: "Beta", domain: null },
    { name: "Gamma", domain: "gamma.io" },
  ];
  assert.deepEqual(pickTargets(ranked, "youco", 2).map((r) => r.name), ["Acme", "Beta"]);
  assert.deepEqual(pickTargets(ranked, "YouCo", 5, ["gamma", "Acme", "YOUCO", "acme"]).map((r) => [r.name, r.domain]), [
    ["Gamma", "gamma.io"],
    ["Acme", "acme.com"],
  ]);
  assert.deepEqual(pickTargets(ranked, "YouCo", 0), []);
  assert.deepEqual(pickTargets(ranked, "YouCo", 3, []).map((r) => r.name), ["Acme", "Beta", "Gamma"]);
});

const m = (id: number, name: string, url: string, sentiment: number | null, source: Mention["source"] = "reddit"): Mention => ({
  id,
  brand_id: "b",
  name,
  is_you: name === "You",
  source,
  url,
  title: "",
  snippet: "",
  author: null,
  posted_at: null,
  found_at: "2026-10-15T00:00:00Z",
  sentiment,
  kind: null,
});

test("shareOfVoice: counts, shares, warmth, top source and threads AI cites", () => {
  const now = [
    m(1, "You", "https://reddit.com/r/a/comments/t1/x", 80),
    m(2, "You", "https://x.com/a/status/2", 20, "x"),
    m(3, "Rival", "https://reddit.com/r/a/comments/t3/x", 50),
    m(4, "rival", "https://reddit.com/r/b/comments/t4/x", null),
  ];
  const cited = citedKeys([{ sources: [{ url: "https://www.reddit.com/r/a/comments/T3/x/" }] }]);
  const rows = shareOfVoice(
    [
      { name: "Rival", isYou: false },
      { name: "You", isYou: true },
      { name: "Quiet", isYou: false },
    ],
    now,
    [m(9, "Rival", "https://reddit.com/r/a/comments/t9/x", 50)],
    cited,
  );
  assert.deepEqual(
    rows.map((r) => [r.name, r.mentions, r.before, Math.round(r.share), Math.round(r.positive), Math.round(r.negative), r.topSource, r.cited]),
    [
      ["You", 2, 0, 50, 50, 50, "reddit", 0],
      ["Rival", 2, 1, 50, 0, 0, "reddit", 1],
      ["Quiet", 0, 0, 0, 0, 0, null, 0],
    ],
  );
  assert.equal(rows[1].sentiment, 50);
  assert.equal(rows[2].sentiment, null);
});
