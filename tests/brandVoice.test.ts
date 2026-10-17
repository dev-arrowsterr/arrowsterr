import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanVoice, distillPrompt, EMPTY_VOICE, sampleUrls, voiceReady, voiceText } from "../src/lib/brandVoice.ts";
import { pageText } from "../src/lib/pageText.ts";

test("voice: a broken reply comes back empty, field by field", () => {
  assert.deepEqual(cleanVoice(null), EMPTY_VOICE);
  assert.deepEqual(cleanVoice("nonsense"), EMPTY_VOICE);
  const v = cleanVoice({ tone: "warm", sentences: 12, use: [1, "ship"], reader: "  Founders   of small SaaS teams " });
  assert.deepEqual(v.tone, ["warm"]);
  assert.equal(v.sentences, "");
  assert.deepEqual(v.use, ["ship"]);
  assert.equal(v.reader, "Founders of small SaaS teams");
});

test("voice: lists from a form split on commas, dedupe without case, and stay short", () => {
  const v = cleanVoice({ tone: ["Plain, Warm", "plain", "direct", "calm", "sharp", "kind"], avoid: "synergy, leverage,\nSynergy, ,robust" });
  assert.deepEqual(v.tone, ["plain", "warm", "direct", "calm", "sharp"]);
  assert.deepEqual(v.avoid, ["synergy", "leverage", "robust"]);
  assert.equal(cleanVoice({ use: Array.from({ length: 40 }, (_, i) => `word${i}`) }).use.length, 20);
});

test("voice: ready once it has a tone and a reader", () => {
  assert.equal(voiceReady(null), false);
  assert.equal(voiceReady(cleanVoice({ tone: ["plain"] })), false);
  assert.equal(voiceReady(cleanVoice({ tone: ["plain"], reader: "Ops leads" })), true);
});

test("sample links: split on spaces, commas and lines, made https, deduped, at most five", () => {
  const { urls, bad } = sampleUrls("acme.com/blog/a, https://acme.com/blog/a#top\nhttp://acme.com/b  acme.com/c acme.com/d acme.com/e acme.com/f");
  assert.deepEqual(urls, ["https://acme.com/blog/a", "http://acme.com/b", "https://acme.com/c", "https://acme.com/d", "https://acme.com/e"]);
  assert.deepEqual(bad, []);
  assert.deepEqual(sampleUrls("not a link ftp://x.com localhost").bad, ["not", "a", "link", "ftp://x.com", "localhost"]);
});

test("distill prompt carries every sample and the Brand Kit's tone as a hint", () => {
  const p = distillPrompt({ name: "Acme", domain: "acme.com" }, [{ source: "https://acme.com/a", text: "Alpha text" }, { source: "pasted text", text: "Beta text" }], { voice: { tone: ["bold"], sample: "" } });
  assert.match(p, /Sample 1 \(https:\/\/acme\.com\/a\)[\s\S]*Alpha text/);
  assert.match(p, /Sample 2 \(pasted text\)[\s\S]*Beta text/);
  assert.match(p, /Brand Kit already says it sounds: bold/);
  assert.doesNotMatch(distillPrompt({ name: "Acme", domain: "acme.com" }, [], null), /Brand Kit/);
});

test("voice text for the writer leaves out empty parts", () => {
  const t = voiceText(cleanVoice({ tone: ["plain"], reader: "Ops leads.", avoid: ["synergy"] }));
  assert.equal(t, "Tone: plain.\nNever use: synergy.\nReader: Ops leads.");
  assert.equal(voiceText(null), "");
});

test("page text keeps the article's writing and drops menus, scripts and footers", () => {
  const html = `<html><head><title>Why plain words win</title><script>var x = "never shown here at all";</script></head><body>
    <nav><a>Home</a><a>Pricing and plans for every team size</a></nav>
    <article><h1>Why plain words win every time</h1><p>Short sentences are easier to read for everyone.</p><ul><li>One idea in each sentence keeps readers moving.</li><li>Tiny</li></ul></article>
    <footer>Copyright Acme Inc, all rights reserved worldwide.</footer></body></html>`;
  const r = pageText(html);
  assert.equal(r.title, "Why plain words win");
  assert.match(r.text, /Short sentences are easier to read/);
  assert.match(r.text, /One idea in each sentence/);
  assert.doesNotMatch(r.text, /never shown|Pricing|Copyright|Tiny/);
  assert.ok(r.words > 10);
});
