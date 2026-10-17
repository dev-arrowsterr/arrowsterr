// Brand Kits (docs/reports.md, section 31): what the agent learns from a website, cleaned so a report can trust it.
// Shared by the server and the browser.
import { FONTS, type Font, type ReportTheme } from "./reportTheme.ts";

export type KitColors = {
  primary: string; // the main brand color
  secondary: string;
  ink: string; // headings
  text: string; // body copy
  muted: string;
  paper: string; // page behind the cards
  surface: string; // cards
  line: string;
};

export type BrandKit = {
  name: string; // the brand's short name, as people say it
  logo: string; // an address or a data URL; empty when none was found
  logoOnDark: boolean; // the logo is white or light, so it needs a dark ground
  colors: KitColors;
  fonts: { heading: Font; body: Font };
  radius: number; // corner radius in px, 0 to 28
  footer: string; // one contact line for the bottom of each report
  voice: { tone: string[]; sample: string };
};

/** A kit row: the workspace's own ('workspace') or a client brand's (its id). */
export type KitRow = { key: string; brand_id: string | null; website: string | null; kit: BrandKit; learned_at: string | null; confirmed_at: string | null };

/** What the learner sends while it reads a site, one line each. The animation shows each part as it lands. */
export type KitPart =
  | { part: "site"; domain: string; title: string }
  | { part: "colors"; colors: string[] }
  | { part: "fonts"; fonts: string[] }
  | { part: "logo"; logo: string; onDark: boolean }
  | { part: "done"; kit: BrandKit; why: string; saved: boolean }
  | { part: "error"; error: string };

/**
 * Read the learner's reply: one KitPart per line. A line may arrive split across chunks.
 * An error line throws. The promise ends with the finished kit, or throws if the reply stopped before it.
 */
export async function readKitStream(body: ReadableStream<string>, onPart: (p: KitPart) => void): Promise<Extract<KitPart, { part: "done" }>> {
  const reader = body.getReader();
  let buf = "";
  const out: { done: Extract<KitPart, { part: "done" }> | null } = { done: null };
  const take = (raw: string) => {
    if (!raw.trim()) return;
    const p = JSON.parse(raw) as KitPart;
    if (p.part === "error") throw new Error(p.error);
    if (p.part === "done") out.done = p;
    onPart(p);
  };
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += value;
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      take(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  }
  take(buf);
  if (!out.done) throw new Error("The connection closed before the Brand Kit was ready. Try again.");
  return out.done;
}

/** Arrowsterr's own look. A kit field that is missing or broken falls back to this. */
export const DEFAULT_KIT: BrandKit = {
  name: "",
  logo: "",
  logoOnDark: false,
  colors: { primary: "#0943B0", secondary: "#4F7FE0", ink: "#0B1B3F", text: "#3D4656", muted: "#5E6675", paper: "#F8F8FF", surface: "#FFFFFF", line: "#E3E6EC" },
  fonts: { heading: "Inter", body: "Inter" },
  radius: 8,
  footer: "",
  voice: { tone: [], sample: "" },
};

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX3 = /^#[0-9a-f]{3}$/i;

/** "#abc" and "#AABBCC" become "#aabbcc". Anything else is null. */
export function hex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (HEX6.test(s)) return s.toLowerCase();
  if (HEX3.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join("")}`.toLowerCase();
  return null;
}

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/** Relative luminance, 0 (black) to 1 (white). */
export function luminance(h: string): number {
  const [r, g, b] = rgb(h).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio between two colors, 1 to 21. Text needs 4.5. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The first color that reads on bg, or black or white, whichever reads better. */
export function readableOn(bg: string, picks: string[], min = 4.5): string {
  for (const p of picks) if (p && contrast(p, bg) >= min) return p;
  return contrast("#111111", bg) >= contrast("#ffffff", bg) ? "#111111" : "#ffffff";
}

/** How colorful a color is, 0 (grey) to 1. */
function saturation(h: string): number {
  const c = rgb(h);
  const max = Math.max(...c);
  const min = Math.min(...c);
  return max === 0 ? 0 : (max - min) / max;
}

/** The colors to show while the kit is learned: the site's most used brand colors first, greys only to fill up. */
export function paletteOf(counted: [string, number][], max = 5): string[] {
  const all = [...new Set(counted.map(([c]) => hex(c)).filter((c): c is string => c !== null))];
  const brand = all.filter((c) => saturation(c) > 0.25 && luminance(c) > 0.02 && luminance(c) < 0.9);
  const grey = all.filter((c) => !brand.includes(c));
  return [...brand, ...grey].slice(0, max);
}

const GENERIC = /^(inherit|initial|unset|sans-serif|serif|monospace|system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system|blinkmacsystemfont|segoe ui|helvetica|helvetica neue|arial|roboto|emoji|apple color emoji|segoe ui emoji|var\(.*\))$/i;

/** The fonts a site really uses, by name: the first family of each stack, web fonts first, no system fallbacks. */
export function fontNames(families: [string, number][], webFonts: string[] = [], max = 3): string[] {
  const first = families.map(([f]) => f.split(",")[0].replace(/["']/g, "").replace(/!important/i, "").trim());
  const out: string[] = [];
  for (const f of [...webFonts, ...first]) {
    const name = f.trim();
    if (!name || name.length > 40 || GENERIC.test(name) || out.some((o) => o.toLowerCase() === name.toLowerCase())) continue;
    out.push(name);
  }
  return out.slice(0, max);
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isLogo = (v: unknown) => typeof v === "string" && (/^https:\/\/\S+$/.test(v) || v.startsWith("data:image/"));

/** Keep only what a kit may hold, then make sure every text color reads on the ground it sits on. */
export function cleanKit(x: unknown, base: BrandKit = DEFAULT_KIT): BrandKit {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const c = (o.colors && typeof o.colors === "object" ? o.colors : {}) as Record<string, unknown>;
  const f = (o.fonts && typeof o.fonts === "object" ? o.fonts : {}) as Record<string, unknown>;
  const v = (o.voice && typeof o.voice === "object" ? o.voice : {}) as Record<string, unknown>;
  const color = (k: keyof KitColors) => hex(c[k]) ?? base.colors[k];
  const font = (k: "heading" | "body") => (FONTS.includes(f[k] as Font) ? (f[k] as Font) : base.fonts[k]);

  const surface = color("surface");
  const paper = color("paper");
  // Headings and body copy sit on cards and on the page, so they must read on both.
  const both = (fg: string, ...fallbacks: string[]) => {
    const ok = (p: string) => contrast(p, surface) >= 4.5 && contrast(p, paper) >= 4.5;
    return [fg, ...fallbacks].find(ok) ?? (contrast("#111111", surface) >= contrast("#ffffff", surface) ? "#111111" : "#ffffff");
  };
  const ink = both(color("ink"), base.colors.ink, "#111111", "#ffffff");
  const text = both(color("text"), ink);
  const muted = both(color("muted"), text);
  const radius = typeof o.radius === "number" && Number.isFinite(o.radius) ? Math.round(Math.min(28, Math.max(0, o.radius))) : base.radius;

  return {
    name: str(o.name, 60) || base.name,
    logo: isLogo(o.logo) ? (o.logo as string).slice(0, 60_000) : o.logo === "" ? "" : base.logo,
    logoOnDark: typeof o.logoOnDark === "boolean" ? o.logoOnDark : base.logoOnDark,
    colors: { primary: color("primary"), secondary: color("secondary"), ink, text, muted, paper, surface, line: color("line") },
    fonts: { heading: font("heading"), body: font("body") },
    radius,
    footer: str(o.footer, 140) || base.footer,
    voice: {
      tone: Array.isArray(v.tone) ? v.tone.map((t) => str(t, 24)).filter(Boolean).slice(0, 3) : base.voice.tone,
      sample: str(v.sample, 160) || base.voice.sample,
    },
  };
}

/** The logo the agent picked from the site's options, by index. A bad index means no logo, never a guess. */
export function pickLogo(index: unknown, options: string[]): string {
  const i = typeof index === "number" ? index : Number(index);
  return Number.isInteger(i) && i >= 0 && i < options.length ? options[i] : "";
}

/** The report theme a kit makes. The cover is dark only when the logo needs a dark ground. */
export function kitToTheme(kit: BrandKit): ReportTheme {
  const { colors, fonts } = kit;
  const darkGround = luminance(colors.ink) < 0.2 ? colors.ink : "#0b0d12";
  const heroBg = kit.logoOnDark ? darkGround : colors.surface;
  return {
    template: "kit",
    name: `${kit.name || "Brand"} Brand Kit`.slice(0, 40),
    accent: colors.primary,
    accent2: colors.secondary,
    ink: colors.ink,
    text: colors.text,
    muted: colors.muted,
    paper: colors.paper,
    surface: colors.surface,
    line: colors.line,
    heroBg,
    heroText: readableOn(heroBg, ["#ffffff", colors.ink]),
    heading: fonts.heading,
    body: fonts.body,
    label: fonts.body,
    radius: kit.radius,
    hero: kit.logoOnDark ? "dark" : "light",
    cards: "outline",
  };
}

/** The JSON the learner asks the agent for. */
export const KIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "logo", "logoOnDark", "footer", "colors", "fonts", "radius", "voice", "why"],
  properties: {
    name: { type: "string" },
    logo: { type: "integer" },
    logoOnDark: { type: "boolean" },
    footer: { type: "string" },
    colors: {
      type: "object",
      additionalProperties: false,
      required: ["primary", "secondary", "ink", "text", "muted", "paper", "surface", "line"],
      properties: Object.fromEntries(["primary", "secondary", "ink", "text", "muted", "paper", "surface", "line"].map((k) => [k, { type: "string" }])),
    },
    fonts: {
      type: "object",
      additionalProperties: false,
      required: ["heading", "body"],
      properties: { heading: { type: "string", enum: [...FONTS] }, body: { type: "string", enum: [...FONTS] } },
    },
    radius: { type: "integer" },
    voice: {
      type: "object",
      additionalProperties: false,
      required: ["tone", "sample"],
      properties: { tone: { type: "array", items: { type: "string" } }, sample: { type: "string" } },
    },
    why: { type: "string" },
  },
};
