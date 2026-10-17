import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanKit, contrast, DEFAULT_KIT, fontNames, hex, kitToTheme, paletteOf, pickLogo, readKitStream, type KitPart } from "../src/lib/brandKit.ts";

const kit = (over: Record<string, unknown> = {}) => cleanKit({ name: "Northwind", logo: "https://northwind.com/logo.svg", ...over });

test("colors: short and upper-case hex become 6-digit lower-case; anything else is dropped", () => {
  assert.equal(hex("#ABC"), "#aabbcc");
  assert.equal(hex(" #0943B0 "), "#0943b0");
  assert.equal(hex("rgb(0,0,0)"), null);
  assert.equal(hex("#12345"), null);
  assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
});

test("a broken reply from the agent falls back to Arrowsterr's look, field by field", () => {
  assert.deepEqual(cleanKit(null), DEFAULT_KIT);
  assert.deepEqual(cleanKit("nonsense"), DEFAULT_KIT);
  const k = cleanKit({ colors: { primary: "blue", secondary: "#f60" }, fonts: { heading: "Comic Sans", body: "Manrope" }, radius: 99 });
  assert.equal(k.colors.primary, DEFAULT_KIT.colors.primary);
  assert.equal(k.colors.secondary, "#ff6600");
  assert.equal(k.fonts.heading, "Inter");
  assert.equal(k.fonts.body, "Manrope");
  assert.equal(k.radius, 28);
  assert.equal(cleanKit({ radius: -4 }).radius, 0);
  assert.equal(cleanKit({ radius: Number.NaN }).radius, DEFAULT_KIT.radius);
});

test("text that would not read on the cards or the page is swapped for a color that does", () => {
  // A pale grey site: the agent picked light grey text on white.
  const pale = kit({ colors: { ink: "#cccccc", text: "#dddddd", muted: "#eeeeee", surface: "#ffffff", paper: "#fafafa" } });
  for (const c of [pale.colors.ink, pale.colors.text, pale.colors.muted]) {
    assert.ok(contrast(c, pale.colors.surface) >= 4.5, `${c} on cards`);
    assert.ok(contrast(c, pale.colors.paper) >= 4.5, `${c} on the page`);
  }
  // A dark site: dark text on dark cards turns light.
  const dark = kit({ colors: { ink: "#111111", text: "#222222", muted: "#333333", surface: "#121a33", paper: "#0b1020" } });
  assert.ok(contrast(dark.colors.ink, dark.colors.surface) >= 4.5);
  assert.ok(contrast(dark.colors.text, dark.colors.paper) >= 4.5);
  // Good colors are kept as they are.
  const good = kit({ colors: { ink: "#0b1b3f", text: "#3d4656", surface: "#ffffff", paper: "#f8f8ff" } });
  assert.equal(good.colors.ink, "#0b1b3f");
  assert.equal(good.colors.text, "#3d4656");
});

test("the logo: only https or an inline image, and a bad pick means no logo, never a guess", () => {
  assert.equal(kit({ logo: "javascript:alert(1)" }).logo, "");
  assert.equal(kit({ logo: "http://plain.example/logo.png" }).logo, "");
  assert.equal(kit({ logo: "" }).logo, "");
  assert.ok(kit({ logo: "data:image/svg+xml;utf8,%3Csvg%3E" }).logo.startsWith("data:image/"));
  const options = ["https://a.com/logo.svg", "https://a.com/icon.png"];
  assert.equal(pickLogo(0, options), options[0]);
  assert.equal(pickLogo("1", options), options[1]);
  assert.equal(pickLogo(-1, options), "");
  assert.equal(pickLogo(5, options), "");
  assert.equal(pickLogo(0.5, options), "");
  assert.equal(pickLogo(undefined, options), "");
  assert.equal(pickLogo(0, []), "");
});

test("tone keeps three short words; long text is cut", () => {
  const k = kit({ voice: { tone: ["Clear", "Warm", "Expert", "Bold"], sample: "x".repeat(500) }, footer: "y".repeat(500) });
  assert.deepEqual(k.voice.tone, ["Clear", "Warm", "Expert"]);
  assert.equal(k.voice.sample.length, 160);
  assert.equal(k.footer.length, 140);
});

test("the report theme: a light logo gets a dark cover with readable text; a dark logo a light one", () => {
  const light = kitToTheme(kit({ logoOnDark: true, colors: { ink: "#0b1b3f" } }));
  assert.equal(light.hero, "dark");
  assert.equal(light.heroBg, "#0b1b3f");
  assert.ok(contrast(light.heroText, light.heroBg) >= 4.5);
  // Light ink cannot be a dark cover: a near-black takes its place.
  const pale = kitToTheme(kit({ logoOnDark: true, colors: { ink: "#ffffff", surface: "#111111", paper: "#000000" } }));
  assert.ok(contrast(pale.heroText, pale.heroBg) >= 4.5);
  const dark = kitToTheme(kit({ logoOnDark: false }));
  assert.equal(dark.hero, "light");
  assert.equal(dark.heroBg, dark.surface);
  assert.ok(contrast(dark.heroText, dark.heroBg) >= 4.5);
  assert.equal(dark.accent, DEFAULT_KIT.colors.primary);
  assert.ok(dark.name.length <= 40);
});

test("the palette shown while learning: brand colors first, greys only to fill up, no repeats", () => {
  const p = paletteOf([["#ffffff", 90], ["#FFF", 40], ["#0943b0", 30], ["#333333", 20], ["#f5a70a", 10], ["#0943B0", 5]]);
  assert.deepEqual(p, ["#0943b0", "#f5a70a", "#ffffff", "#333333"]);
  assert.deepEqual(paletteOf([]), []);
});

test("fonts by name: web fonts first, no system fallbacks, no repeats", () => {
  const f = fontNames([['"Inter", sans-serif', 30], ["-apple-system, BlinkMacSystemFont", 20], ["var(--font-sans)", 10], ["'Fraunces', Georgia, serif", 5], ["inter", 3]], ["Manrope"]);
  assert.deepEqual(f, ["Manrope", "Inter", "Fraunces"]);
});

/** A reply that arrives in the given chunks. */
const reply = (chunks: string[]) =>
  new ReadableStream<string>({
    start(c) {
      for (const x of chunks) c.enqueue(x);
      c.close();
    },
  });
const done = { part: "done", kit: DEFAULT_KIT, why: "Blue and calm.", saved: true };

test("the learner's reply: lines split across chunks still arrive whole and in order", async () => {
  const lines = [{ part: "site", domain: "acme.com", title: "Acme" }, { part: "colors", colors: ["#0943b0"] }, done].map((x) => JSON.stringify(x) + "\n").join("");
  // Cut the reply every 7 characters, so most lines land in pieces.
  const chunks = lines.match(/[\s\S]{1,7}/g)!;
  const seen: KitPart["part"][] = [];
  const out = await readKitStream(reply(chunks), (p) => seen.push(p.part));
  assert.deepEqual(seen, ["site", "colors", "done"]);
  assert.equal(out.why, "Blue and calm.");
});

test("the learner's reply: a last line with no newline still counts", async () => {
  const out = await readKitStream(reply([JSON.stringify(done)]), () => {});
  assert.equal(out.saved, true);
});

test("the learner's reply: an error line throws its message, and a cut-off reply throws too", async () => {
  await assert.rejects(readKitStream(reply([JSON.stringify({ part: "site", domain: "a.com", title: "" }) + "\n", JSON.stringify({ part: "error", error: "Could not load https://a.com." }) + "\n"]), () => {}), /Could not load/);
  await assert.rejects(readKitStream(reply([JSON.stringify({ part: "site", domain: "a.com", title: "" }) + "\n"]), () => {}), /closed before/);
});
