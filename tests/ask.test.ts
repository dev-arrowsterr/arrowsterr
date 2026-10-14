import { test } from "node:test";
import assert from "node:assert/strict";
import { addLink, faqsIn, imagesWithoutAlt, linksIn, setAlts } from "../src/lib/htmlEdit.ts";

test("alt text goes only on images that have none", () => {
  const html = '<p><img src="/a.png"><img src="/b.png" alt="kept"></p>';
  assert.deepEqual(imagesWithoutAlt(html), ["/a.png"]);
  const r = setAlts(html, [{ src: "/a.png", alt: 'A "cat"' }]);
  assert.equal(r.done, 1);
  assert.match(r.html, /<img alt="A &quot;cat&quot;" src="\/a.png">/);
  assert.match(r.html, /alt="kept"/);
});

test("addLink links the first plain mention and skips text inside links", () => {
  const html = '<p><a href="/x">pricing page</a> see our pricing page</p>';
  const r = addLink(html, "pricing page", "https://x.com/pricing");
  assert.ok(r.ok);
  assert.ok(linksIn(r.html).includes("https://x.com/pricing"));
  assert.equal(addLink("<p>nothing here</p>", "pricing", "https://x.com/p").ok, false);
});

test("faqsIn finds question headings and their answers", () => {
  const html = "<h2>FAQ</h2><h3>Is it free?</h3><p>Yes, the starter plan is free for good.</p><h3>Does it work with Ghost?</h3><p>It does, through the Ghost Admin API key.</p>";
  assert.equal(faqsIn(html).length, 2);
});
