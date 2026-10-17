import assert from "node:assert/strict";
import { test } from "node:test";
import { answerReady, buildLlmsTxt, readingEase, robotsFix, robotsMatch, robotsVerdicts, speedSummary, titleFromUrl, type PageFacts } from "../src/lib/freeChecks.ts";

const v = (robots: string | null, bot: string, path = "/") => robotsVerdicts(robots, path).find((x) => x.bot === bot)!;

test("robots.txt: a bot's own group wins over *, and the longest rule decides", () => {
  const r = `User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n`;
  assert.equal(v(r, "GPTBot").verdict, "allowed");
  assert.equal(v(r, "ClaudeBot").verdict, "blocked");
  assert.equal(v(r, "ClaudeBot").rule, "Disallow: /");
  assert.equal(v(r, "ClaudeBot").group, "*");
  const longest = `User-agent: *\nDisallow: /\nAllow: /blog/\n`;
  assert.equal(v(longest, "PerplexityBot", "/blog/post").verdict, "allowed");
  assert.equal(v(longest, "PerplexityBot", "/pricing").verdict, "blocked");
});

test("robots.txt: empty Disallow allows all, partial blocks show, and no file means allowed", () => {
  assert.equal(v("User-agent: *\nDisallow:\n", "GPTBot").verdict, "allowed");
  const part = v("User-agent: GPTBot\nDisallow: /private/\n", "GPTBot");
  assert.equal(part.verdict, "partial");
  assert.equal(part.rule, "Disallow: /private/");
  assert.equal(v(null, "CCBot").verdict, "allowed");
  assert.equal(v("User-agent: gptbot\nDisallow: /\n", "GPTBot").verdict, "blocked", "user agents match without case");
  assert.equal(v("User-agent: CCBot\nUser-agent: GPTBot\nDisallow: /\n", "GPTBot").verdict, "blocked", "a group can name several bots");
  assert.equal(v("# comment\nUser-agent: GPTBot # hi\nDisallow: / # all\n", "GPTBot").verdict, "blocked");
});

test("robots.txt patterns: * and $ work, and other characters are literal", () => {
  assert.equal(robotsMatch("/*.pdf$", "/files/a.pdf"), true);
  assert.equal(robotsMatch("/*.pdf$", "/files/a.pdf?x=1"), false);
  assert.equal(robotsMatch("/a$b", "/a$b/c"), true);
  assert.equal(robotsMatch("/search?q=", "/search?q=crm"), true);
  assert.equal(robotsMatch("/blog", "/blogging"), true);
  assert.equal(robotsMatch("/blog/", "/blo"), false);
});

test("the fix lets each blocked bot in", () => {
  const fix = robotsFix(robotsVerdicts("User-agent: GPTBot\nDisallow: /\n"));
  assert.equal(fix, "User-agent: GPTBot\nAllow: /");
  assert.equal(robotsFix(robotsVerdicts(null)), null);
});

test("llms.txt: name, summary, sections by folder, no duplicates, and the rest under Optional", () => {
  const pages = [
    { url: "https://acme.com/", title: "Acme CRM" },
    { url: "https://acme.com/pricing", title: "Pricing", description: "Plans from $9" },
    { url: "https://acme.com/blog/best-crm", title: "" },
    { url: "https://acme.com/docs/setup", title: "Set up [fast]" },
    { url: "https://acme.com/pricing/", title: "Pricing again" },
  ];
  const txt = buildLlmsTxt({ name: "Acme", summary: "CRM for small teams.", url: "https://acme.com" }, pages, 3);
  assert.match(txt, /^# Acme\n\n> CRM for small teams\.\n/);
  assert.match(txt, /## Main pages\n\n- \[Acme CRM\]\(https:\/\/acme\.com\/\)/);
  assert.match(txt, /## Product\n\n- \[Pricing\]\(https:\/\/acme\.com\/pricing\): Plans from \$9/);
  assert.match(txt, /## Articles\n\n- \[Best Crm\]/);
  assert.match(txt, /## Optional\n\n- \[Set up fast\]/);
  assert.equal(txt.match(/Pricing again/), null);
  assert.equal(titleFromUrl("https://acme.com/blog/how-to-pick_a-crm.html"), "How To Pick A Crm");
});

const facts: PageFacts = {
  title: "Best CRM for small business",
  description: "x".repeat(150),
  h1: 1,
  subheadings: 5,
  questionHeadings: 2,
  firstParagraph: "The best CRM for most small businesses is a simple tool with email, a pipeline and reminders. Here is how the top options compare on price and setup time.",
  paragraphWords: [30, 40, 50],
  lists: 2,
  tables: 1,
  schemaTypes: ["Article", "FAQPage"],
  faq: true,
  words: 1400,
  text: "The best tool is simple. It has email. It has a pipeline. You can set it up in a day. Most teams pick it fast. It costs little. ".repeat(10),
  dated: true,
  author: true,
  aiBlocked: [],
};

test("answer-ready: a well built page scores high, and each gap costs points with a fix", () => {
  const good = answerReady(facts);
  assert.equal(good.score, 100);
  assert.ok(good.checks.every((c) => c.pass));
  const bad = answerReady({ ...facts, aiBlocked: ["OAI-SearchBot"], words: 40, faq: false, schemaTypes: [] });
  assert.ok(bad.score < 70, String(bad.score));
  assert.equal(bad.checks.find((c) => c.id === "access")!.pass, false);
  assert.match(bad.checks.find((c) => c.id === "access")!.detail, /OAI-SearchBot/);
  assert.equal(answerReady({ ...facts, firstParagraph: "What is a CRM?" }).checks.find((c) => c.id === "answer")!.pass, false);
  assert.equal(answerReady({ ...facts, h1: 2 }).checks.find((c) => c.id === "h1")!.pass, false);
});

test("reading ease: plain text scores higher than dense text, and short text isn't scored", () => {
  const plain = readingEase("We sell a CRM. It is easy to use. You can try it free. It works on your phone. ".repeat(5))!;
  const dense = readingEase("Comprehensive organizational relationship management infrastructure facilitates sophisticated interdepartmental communication methodologies. ".repeat(5))!;
  assert.ok(plain > 70 && dense < 20, `${plain} ${dense}`);
  assert.equal(readingEase("Too short."), null);
});

test("page speed: score, Core Web Vitals with ratings, field data and the biggest fixes", () => {
  const s = speedSummary({
    lighthouseResult: {
      categories: { performance: { score: 0.47 } },
      audits: {
        "largest-contentful-paint": { numericValue: 4800 },
        "cumulative-layout-shift": { numericValue: 0.05 },
        "total-blocking-time": { numericValue: 350 },
        "render-blocking-resources": { title: "Eliminate render-blocking resources", details: { type: "opportunity", overallSavingsMs: 1200 } },
        "unused-css-rules": { title: "Reduce unused CSS", details: { type: "opportunity", overallSavingsMs: 50 } },
        "uses-optimized-images": { title: "Efficiently encode images", details: { type: "opportunity", overallSavingsMs: 600 } },
      },
    },
    loadingExperience: { overall_category: "AVERAGE", metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2300 }, INTERACTION_TO_NEXT_PAINT: { percentile: 250 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 12 } } },
  });
  assert.equal(s.score, 47);
  assert.deepEqual(s.lab.lcp, { ms: 4800, rating: "poor" });
  assert.equal(s.lab.cls!.rating, "good");
  assert.equal(s.lab.tbt!.rating, "needs work");
  assert.deepEqual(s.field!.cls, { value: 0.12, rating: "needs work" });
  assert.equal(s.field!.inp!.rating, "needs work");
  assert.deepEqual(s.fixes.map((f) => f.savingsMs), [1200, 600], "small savings are left out, biggest first");
  assert.equal(speedSummary({}).score, null);
  assert.equal(speedSummary({}).field, null);
});

import { pageFacts } from "../src/lib/pageFacts.ts";
test("page facts: main content, structure, schema, date and author from raw HTML", () => {
  const body = "<p>" + "Acme is a simple CRM for small teams that tracks deals and sends follow-up email. ".repeat(3) + "</p>" + "<h2>What does it cost?</h2><p>" + "It costs nine dollars a month for each person on the team. ".repeat(4) + "</p><ul><li>Email</li><li>Pipeline</li></ul><h2>How do I set it up?</h2><p>" + "Sign up, import a spreadsheet and invite your team in a few minutes. ".repeat(5) + "</p><h2>FAQ</h2><table><thead><tr><th>Plan</th><th>Price</th></tr></thead><tbody><tr><td>Starter</td><td>$9</td></tr><tr><td>Team</td><td>$29</td></tr></tbody></table>";
  const html = `<html><head><title>Acme CRM</title><meta name="description" content="Simple CRM"><meta name="author" content="Jo"><meta property="article:modified_time" content="2026-10-01">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Article"},{"@type":"FAQPage"}]}</script></head>
<body><nav><a href="/">Home</a> menu menu menu</nav><article><h1>Acme CRM</h1>${body}</article><footer>footer text here</footer></body></html>`;
  const f = pageFacts(html, "https://acme.com/crm", []);
  assert.equal(f.title, "Acme CRM");
  assert.equal(f.h1, 1);
  assert.equal(f.subheadings, 3);
  assert.equal(f.questionHeadings, 2);
  assert.match(f.firstParagraph, /^Acme is a simple CRM/);
  assert.equal(f.lists, 1);
  assert.equal(f.tables, 1);
  assert.deepEqual(f.schemaTypes.sort(), ["Article", "FAQPage"]);
  assert.equal(f.faq, true);
  assert.equal(f.dated, true);
  assert.equal(f.author, true);
  assert.ok(f.words > 100 && !/footer text/.test(f.text), String(f.words));
  const empty = pageFacts("<html><body><div id=app></div><script>render()</script></body></html>", "https://x.com/", ["OAI-SearchBot"]);
  assert.equal(empty.words, 0);
  assert.equal(empty.firstParagraph, "");
});
