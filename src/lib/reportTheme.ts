// Report looks: ready-made templates, the fonts they may use, and a cleaner for themes the AI agent writes.
// Shared by the server and the browser.

export const FONTS = ["Inter", "Manrope", "Space Grotesk", "IBM Plex Sans", "DM Sans", "Fraunces", "DM Serif Display", "Playfair Display", "Instrument Serif", "Geist Mono", "JetBrains Mono"] as const;
export type Font = (typeof FONTS)[number];
const SERIF: Font[] = ["Fraunces", "DM Serif Display", "Playfair Display", "Instrument Serif"];
const MONO: Font[] = ["Geist Mono", "JetBrains Mono"];
export const fontStack = (f: Font) => `'${f}', ${SERIF.includes(f) ? "Georgia, serif" : MONO.includes(f) ? "ui-monospace, monospace" : "system-ui, sans-serif"}`;

/** The Google Fonts address that loads every font a theme uses. */
export function fontsUrl(t: ReportTheme) {
  const fams = [...new Set([t.heading, t.body, t.label])].map((f) => {
    const name = f.replace(/ /g, "+");
    if (f === "DM Serif Display" || f === "Instrument Serif") return `family=${name}`;
    if (f === "Fraunces") return `family=${name}:opsz,wght@9..144,400;9..144,600;9..144,700`;
    return `family=${name}:wght@400;500;600;700`;
  });
  return `https://fonts.googleapis.com/css2?${fams.join("&")}&display=swap`;
}

export type Hero = "dark" | "gradient" | "light" | "split";
export type Cards = "elevated" | "outline" | "tinted" | "flat";

export type ReportTheme = {
  template: string;
  name: string;
  accent: string;
  accent2: string;
  ink: string; // headings
  text: string; // body copy
  muted: string;
  paper: string; // page behind the cards
  surface: string; // cards
  line: string;
  heroBg: string;
  heroText: string;
  heading: Font;
  body: Font;
  label: Font;
  radius: number;
  hero: Hero;
  cards: Cards;
};

export const TEMPLATES: ReportTheme[] = [
  { template: "perceptric", name: "Perceptric", accent: "#0943B0", accent2: "#2E6BE0", ink: "#0B0D12", text: "#2B3242", muted: "#4A5363", paper: "#F8F8FF", surface: "#FFFFFF", line: "#D9DEE6", heroBg: "#0B0D12", heroText: "#FFFFFF", heading: "Inter", body: "Inter", label: "Geist Mono", radius: 14, hero: "dark", cards: "elevated" },
  { template: "aurora", name: "Aurora", accent: "#6D28D9", accent2: "#EC4899", ink: "#14101F", text: "#3B3550", muted: "#6B6585", paper: "#FBF8FF", surface: "#FFFFFF", line: "#E9E3F5", heroBg: "#6D28D9", heroText: "#FFFFFF", heading: "Space Grotesk", body: "DM Sans", label: "Space Grotesk", radius: 22, hero: "gradient", cards: "elevated" },
  { template: "executive", name: "Executive", accent: "#1F3A5F", accent2: "#B8892B", ink: "#14202E", text: "#36414F", muted: "#6B7684", paper: "#FBFAF7", surface: "#FFFFFF", line: "#E4E0D6", heroBg: "#FFFFFF", heroText: "#14202E", heading: "Fraunces", body: "Inter", label: "Inter", radius: 6, hero: "light", cards: "outline" },
  { template: "editorial", name: "Editorial", accent: "#111111", accent2: "#FF4F00", ink: "#111111", text: "#2A2A2A", muted: "#6E6A62", paper: "#F4F1EA", surface: "#FFFDF8", line: "#D8D2C4", heroBg: "#FF4F00", heroText: "#111111", heading: "DM Serif Display", body: "Inter", label: "Geist Mono", radius: 0, hero: "split", cards: "outline" },
  { template: "midnight", name: "Midnight", accent: "#7DD3FC", accent2: "#A78BFA", ink: "#F5F7FF", text: "#C9D1E6", muted: "#8A93AD", paper: "#0B1020", surface: "#121A33", line: "#233055", heroBg: "#050816", heroText: "#FFFFFF", heading: "Manrope", body: "Manrope", label: "JetBrains Mono", radius: 16, hero: "dark", cards: "tinted" },
  { template: "fresh", name: "Fresh", accent: "#0F766E", accent2: "#F59E0B", ink: "#0F1F1C", text: "#2F4642", muted: "#5F7470", paper: "#F3FAF7", surface: "#FFFFFF", line: "#D5E8E1", heroBg: "#E3F4EE", heroText: "#0F1F1C", heading: "Manrope", body: "Manrope", label: "Manrope", radius: 24, hero: "light", cards: "tinted" },
  { template: "corporate", name: "Corporate", accent: "#2563EB", accent2: "#0EA5E9", ink: "#0F172A", text: "#334155", muted: "#64748B", paper: "#F1F5F9", surface: "#FFFFFF", line: "#E2E8F0", heroBg: "#2563EB", heroText: "#FFFFFF", heading: "IBM Plex Sans", body: "IBM Plex Sans", label: "IBM Plex Sans", radius: 8, hero: "split", cards: "flat" },
  { template: "noir", name: "Noir", accent: "#E8E3D3", accent2: "#C8A96A", ink: "#F2EEE3", text: "#CFC9BA", muted: "#8E887A", paper: "#121110", surface: "#1B1A18", line: "#2E2C28", heroBg: "#000000", heroText: "#F2EEE3", heading: "Instrument Serif", body: "Inter", label: "Geist Mono", radius: 4, hero: "dark", cards: "outline" },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** Keep only values a theme may hold. Anything missing or broken falls back to the base template. */
export function cleanTheme(x: unknown, base: ReportTheme = TEMPLATES[0]): ReportTheme {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const color = (k: keyof ReportTheme) => (typeof o[k] === "string" && HEX.test(o[k] as string) ? (o[k] as string) : (base[k] as string));
  const font = (k: "heading" | "body" | "label") => (FONTS.includes(o[k] as Font) ? (o[k] as Font) : base[k]);
  return {
    template: typeof o.template === "string" ? o.template.slice(0, 40) : base.template,
    name: typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 40) : base.name,
    accent: color("accent"),
    accent2: color("accent2"),
    ink: color("ink"),
    text: color("text"),
    muted: color("muted"),
    paper: color("paper"),
    surface: color("surface"),
    line: color("line"),
    heroBg: color("heroBg"),
    heroText: color("heroText"),
    heading: font("heading"),
    body: font("body"),
    label: font("label"),
    radius: typeof o.radius === "number" && o.radius >= 0 && o.radius <= 32 ? Math.round(o.radius) : base.radius,
    hero: ["dark", "gradient", "light", "split"].includes(o.hero as string) ? (o.hero as Hero) : base.hero,
    cards: ["elevated", "outline", "tinted", "flat"].includes(o.cards as string) ? (o.cards as Cards) : base.cards,
  };
}

/** The theme for a report. Old reports only have one color: they get the Perceptric template in that color. */
export function themeOf(style: { color: string; theme?: ReportTheme }): ReportTheme {
  if (style.theme) return style.theme;
  return HEX.test(style.color) ? { ...TEMPLATES[0], accent: style.color } : TEMPLATES[0];
}
