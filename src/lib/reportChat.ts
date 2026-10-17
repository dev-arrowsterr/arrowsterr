// Zippie in the report editor (docs/reports.md, section 31.4): you ask in plain words, Zippie answers and changes
// the report. Zippie only ever sends changes from this short list; code checks each one before it lands.
// Pure, shared by the server, the browser and tests.
import { BLOCKS, type BlockId, type ReportDocument } from "./reportDoc.ts";
import { PRESETS, type Compare, type Preset, type ReportRange } from "./reportRange.ts";
import { cleanTheme, FONTS, type ReportTheme } from "./reportTheme.ts";

export type ChatTurn = { role: "you" | "zippie"; text: string };

/** What Zippie may change. Empty or false fields leave that part alone. */
export type ChatChanges = {
  blocks: BlockId[] | null; // the blocks to show, in order; the rest switch off
  name: string; // the report's name
  title: string; // the title on the cover
  range: { preset: Preset | null; compare: Compare | null } | null; // null parts keep what the report has
  theme: ReportTheme | null;
  writeSummary: boolean; // write the AI summary with the checked summary writer
  useBrandKit: boolean; // put the workspace's Brand Kit on the report
};
export type ChatReply = { reply: string; changes: ChatChanges };

export const NO_CHANGES: ChatChanges = { blocks: null, name: "", title: "", range: null, theme: null, writeSummary: false, useBrandKit: false };

const THEME_KEYS = ["accent", "accent2", "ink", "text", "muted", "paper", "surface", "line", "heroBg", "heroText"] as const;

/** The JSON Zippie answers with. */
export const CHAT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "blocks", "name", "title", "preset", "compare", "theme", "writeSummary", "useBrandKit"],
  properties: {
    reply: { type: "string" },
    blocks: { type: "array", items: { type: "string", enum: BLOCKS.map((b) => b.id) } },
    name: { type: "string" },
    title: { type: "string" },
    preset: { type: "string", enum: ["", ...PRESETS.filter((p) => p.id !== "custom").map((p) => p.id)] },
    compare: { type: "string", enum: ["", "previous", "lastYear", "none"] },
    theme: {
      type: "object",
      additionalProperties: false,
      required: ["change", ...THEME_KEYS, "heading", "body", "radius", "hero", "cards"],
      properties: {
        change: { type: "boolean" },
        ...Object.fromEntries(THEME_KEYS.map((k) => [k, { type: "string" }])),
        heading: { type: "string", enum: [...FONTS] },
        body: { type: "string", enum: [...FONTS] },
        radius: { type: "integer" },
        hero: { type: "string", enum: ["dark", "gradient", "light", "split"] },
        cards: { type: "string", enum: ["elevated", "outline", "tinted", "flat"] },
      },
    },
    writeSummary: { type: "boolean" },
    useBrandKit: { type: "boolean" },
  },
};

const IDS = new Set<string>(BLOCKS.map((b) => b.id));
const COMPARES = new Set(["previous", "lastYear", "none"]);

/** Turn Zippie's raw answer into changes code trusts. Anything unknown or broken is dropped. */
export function cleanChat(x: unknown, current: ReportTheme): ChatReply {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const reply = typeof o.reply === "string" && o.reply.trim() ? o.reply.trim().slice(0, 1200) : "Done.";
  const raw = Array.isArray(o.blocks) ? o.blocks.map(String).filter((id) => IDS.has(id)) : [];
  const blocks = raw.length ? ([...new Set(raw)] as BlockId[]) : null;
  const preset = typeof o.preset === "string" && PRESETS.some((p) => p.id === o.preset) && o.preset !== "custom" ? (o.preset as Preset) : null;
  const compare = typeof o.compare === "string" && COMPARES.has(o.compare) ? (o.compare as Compare) : null;
  const t = (o.theme && typeof o.theme === "object" ? o.theme : {}) as Record<string, unknown>;
  const theme = t.change === true ? { ...cleanTheme({ ...current, ...t }, current), template: current.template, name: current.name } : null;
  return {
    reply,
    changes: {
      blocks,
      name: typeof o.name === "string" ? o.name.trim().slice(0, 120) : "",
      title: typeof o.title === "string" ? o.title.trim().slice(0, 80) : "",
      range: preset || compare ? { preset, compare } : null,
      theme,
      writeSummary: o.writeSummary === true,
      useBrandKit: o.useBrandKit === true,
    },
  };
}

/** Put a reply's block and date changes on a report. */
export function applyChat(doc: ReportDocument, range: ReportRange, c: ChatChanges): { doc: ReportDocument; range: ReportRange } {
  const blocks = c.blocks ? [...c.blocks.map((id) => ({ id, on: true })), ...doc.blocks.filter((b) => !c.blocks!.includes(b.id)).map((b) => ({ ...b, on: false }))] : doc.blocks;
  // A new preset keeps the compare already picked unless Zippie named one, and the other way round.
  const nextRange: ReportRange = c.range ? { preset: c.range.preset ?? range.preset, compare: c.range.compare ?? range.compare, ...(c.range.preset ? {} : { start: range.start, end: range.end }) } : range;
  return { doc: { ...doc, blocks }, range: nextRange };
}

/** The words for one change, so the chat can say what moved. */
export function describeChanges(c: ChatChanges): string[] {
  const out: string[] = [];
  if (c.blocks) out.push(`Showing ${c.blocks.map((id) => BLOCKS.find((b) => b.id === id)!.label).join(", ")}`);
  if (c.name) out.push(`Renamed to "${c.name}"`);
  if (c.title) out.push(`Cover title "${c.title}"`);
  if (c.range?.preset) out.push(`Dates: ${PRESETS.find((p) => p.id === c.range!.preset)?.label ?? c.range.preset}`);
  if (c.range?.compare) out.push(c.range.compare === "none" ? "No comparison" : c.range.compare === "lastYear" ? "Compared with last year" : "Compared with the period before");
  if (c.theme) out.push("New look");
  if (c.useBrandKit) out.push("Brand Kit applied");
  if (c.writeSummary) out.push("Writing the AI summary");
  return out;
}

/** What Zippie reads before answering. numbers is the same compact data the AI summary is written from. */
export function chatPrompt(p: { brand: string; period: string; numbers: unknown; doc: ReportDocument; name: string; title: string; theme: ReportTheme; history: ChatTurn[]; message: string; brandKit: boolean }) {
  const on = p.doc.blocks.filter((b) => b.on).map((b) => b.id);
  return `You are Zippie, the assistant inside Arrowsterr's report editor. You help a marketer shape a client report for ${p.brand}.

The report now:
- Name: ${p.name}
- Cover title: ${p.title || "AI Visibility Report"}
- Dates: ${p.period}
- Blocks shown, in order: ${on.join(", ") || "none"}
- All blocks: ${BLOCKS.map((b) => `${b.id} (${b.label})`).join(", ")}
- Theme: ${JSON.stringify({ accent: p.theme.accent, accent2: p.theme.accent2, ink: p.theme.ink, text: p.theme.text, muted: p.theme.muted, paper: p.theme.paper, surface: p.theme.surface, line: p.theme.line, heroBg: p.theme.heroBg, heroText: p.theme.heroText, heading: p.theme.heading, body: p.theme.body, radius: p.theme.radius, hero: p.theme.hero, cards: p.theme.cards })}
- The workspace ${p.brandKit ? "has" : "has no"} Brand Kit.

The numbers on the report (the only numbers you may use):
${JSON.stringify(p.numbers)}

The conversation so far:
${p.history.map((t) => `${t.role === "you" ? "User" : "Zippie"}: ${t.text}`).join("\n") || "(none)"}

User: ${p.message}

Rules:
- reply: short and plain, 9th-grade words, no emoji. Say what you changed. When asked about the numbers, use only the numbers above. Never make up a number, a client, a quote or a result.
- blocks: the full list of blocks to show, in order, only when the user wants blocks added, removed or moved. Otherwise an empty list.
- name and title: only when asked to change them, else "".
- preset and compare: only when asked to change the dates, else "".
- theme.change: true only when asked to change colors, fonts, corners or the look. Then give every theme field, copying the current value for anything you leave alone. Text colors must be easy to read on their background.
- writeSummary: true when asked to write or rewrite the AI summary or executive summary. The summary writer adds it; do not write it in reply.
- useBrandKit: true when asked to use their brand, Brand Kit, logo or colors from their site${p.brandKit ? "" : ". There is no Brand Kit yet, so say they can learn one in the Brand Kit tab"}.
- If the user asks for something you cannot do here, say so in one sentence and suggest the closest thing you can do.`;
}
