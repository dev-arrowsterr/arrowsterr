import assert from "node:assert/strict";
import { test } from "node:test";
import { applyChat, cleanChat, describeChanges, NO_CHANGES } from "../src/lib/reportChat.ts";
import { DEFAULT_DOC, docOf, PURPOSES, TEMPLATES } from "../src/lib/reportDoc.ts";
import { TEMPLATES as THEMES } from "../src/lib/reportTheme.ts";

const theme = THEMES[0];
const range = { preset: "last30" as const, compare: "previous" as const };

test("a reply with nothing to change changes nothing", () => {
  const r = cleanChat({ reply: "Visibility rose 4 points.", blocks: [], name: "", title: "", preset: "", compare: "", theme: { change: false }, writeSummary: false, useBrandKit: false }, theme);
  assert.equal(r.reply, "Visibility rose 4 points.");
  assert.deepEqual(r.changes, NO_CHANGES);
  assert.deepEqual(describeChanges(r.changes), []);
});

test("junk from the model is dropped: unknown blocks, repeats, custom dates, bad compares", () => {
  const r = cleanChat({ blocks: ["kpis", "nope", "kpis", "wins"], preset: "custom", compare: "forever" }, theme);
  assert.deepEqual(r.changes.blocks, ["kpis", "wins"]);
  assert.equal(r.changes.range, null);
  assert.equal(r.reply, "Done.");
  assert.deepEqual(cleanChat(null, theme).changes, NO_CHANGES);
  assert.deepEqual(cleanChat("{oops", theme).changes, NO_CHANGES);
});

test("blocks: the named ones show in that order and the rest switch off", () => {
  const { doc } = applyChat(DEFAULT_DOC, range, { ...NO_CHANGES, blocks: ["wins", "kpis"] });
  assert.deepEqual(doc.blocks.slice(0, 2), [{ id: "wins", on: true }, { id: "kpis", on: true }]);
  assert.equal(doc.blocks.length, DEFAULT_DOC.blocks.length);
  assert.ok(doc.blocks.slice(2).every((b) => !b.on));
});

test("dates: a new preset keeps the comparison, and a new comparison keeps the preset", () => {
  const onlyPreset = cleanChat({ preset: "lastQuarter", compare: "" }, theme).changes;
  assert.deepEqual(applyChat(DEFAULT_DOC, { preset: "last30", compare: "lastYear" }, onlyPreset).range, { preset: "lastQuarter", compare: "lastYear" });
  const onlyCompare = cleanChat({ preset: "", compare: "lastYear" }, theme).changes;
  const out = applyChat(DEFAULT_DOC, { preset: "custom", start: "2026-09-01", end: "2026-09-30", compare: "previous" }, onlyCompare).range;
  assert.deepEqual(out, { preset: "custom", start: "2026-09-01", end: "2026-09-30", compare: "lastYear" });
  assert.ok(describeChanges(onlyCompare).includes("Compared with last year"));
});

test("theme: only when asked, broken colors keep the current ones, and the theme keeps its name", () => {
  assert.equal(cleanChat({ theme: { change: false, accent: "#ff0000" } }, theme).changes.theme, null);
  const t = cleanChat({ theme: { change: true, accent: "#111111", ink: "red", radius: 99, hero: "dark" } }, theme).changes.theme!;
  assert.equal(t.accent, "#111111");
  assert.equal(t.ink, theme.ink);
  assert.equal(t.radius, theme.radius);
  assert.equal(t.hero, "dark");
  assert.equal(t.name, theme.name);
});

test("long text is cut to fit", () => {
  const r = cleanChat({ reply: "x".repeat(5000), name: "n".repeat(500), title: "t".repeat(500) }, theme);
  assert.equal(r.reply.length, 1200);
  assert.equal(r.changes.name.length, 120);
  assert.equal(r.changes.title.length, 80);
});

test("every template sits in a purpose column, and every purpose has templates", () => {
  for (const t of TEMPLATES) assert.ok(PURPOSES.some((p) => p.id === t.purpose), t.id);
  for (const p of PURPOSES) assert.ok(TEMPLATES.some((t) => t.purpose === p.id), p.id);
  assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length);
  const d = docOf(["wins", "kpis"]);
  assert.deepEqual(d.blocks.slice(0, 2), [{ id: "wins", on: true }, { id: "kpis", on: true }]);
  assert.equal(d.blocks.filter((b) => b.on).length, 2);
});
