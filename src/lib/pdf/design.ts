// The two PDF designs (docs/reports.md, section 32.2): Arrowsterr's own, and one made from the workspace's Brand Kit.
// Both share one layout; only these tokens change. Pure, shared by the server, the browser and tests.
import { kitToTheme, type BrandKit } from "../brandKit.ts";
import { fontStack } from "../reportTheme.ts";

export type PdfDesign = "arrowsterr" | "brand";
export const isDesign = (v: unknown): v is PdfDesign => v === "arrowsterr" || v === "brand";

export type DesignTokens = {
  design: PdfDesign;
  maker: string; // whose report this looks like: "Arrowsterr" or the kit's name
  logo: string; // the cover logo; empty means the maker's name in the heading font
  accent: string;
  accent2: string;
  ink: string;
  text: string;
  muted: string;
  paper: string;
  surface: string;
  line: string;
  coverBg: string;
  coverText: string;
  heading: string; // CSS font stack
  body: string;
  numbers: string;
  radius: number;
  footer: string;
  fonts: string | null; // a Google Fonts address to load, or null when the app already has the fonts
};

/** Arrowsterr's brand v5 (docs/brand.md): Night cover, Signal Blue, Funnel Display, Geist and Geist Mono. */
export const ARROWSTERR: DesignTokens = {
  design: "arrowsterr",
  maker: "Arrowsterr",
  logo: "/brand/arrowsterr-logo-white.svg",
  accent: "#0943B0",
  accent2: "#4F7FE0",
  ink: "#0B1B3F",
  text: "#3D4656",
  muted: "#5E6675",
  paper: "#FFFFFF",
  surface: "#F8F8FF",
  line: "#E3E6EC",
  coverBg: "#0B1B3F",
  coverText: "#FFFFFF",
  heading: "var(--font-funnel), 'Funnel Display', system-ui, sans-serif",
  body: "var(--font-geist), 'Geist', system-ui, sans-serif",
  numbers: "var(--font-geist-mono), 'Geist Mono', ui-monospace, monospace",
  radius: 8,
  footer: "Made with Arrowsterr · arrowsterr.com",
  fonts: null,
};

/** The brand design: the kit's logo, colors, fonts and footer line. Arrowsterr's name appears nowhere. */
export function brandTokens(kit: BrandKit): DesignTokens {
  const t = kitToTheme(kit);
  const fams = [...new Set([t.heading, t.body])].map((f) => `family=${f.replace(/ /g, "+")}:wght@400;500;600;700`);
  return {
    design: "brand",
    maker: kit.name || "Your brand",
    logo: kit.logo,
    accent: t.accent,
    accent2: t.accent2,
    ink: t.ink,
    text: t.text,
    muted: t.muted,
    paper: t.surface,
    surface: t.paper,
    line: t.line,
    coverBg: t.heroBg,
    coverText: t.heroText,
    heading: fontStack(t.heading),
    body: fontStack(t.body),
    numbers: fontStack(t.body),
    radius: Math.min(t.radius, 14),
    footer: kit.footer,
    fonts: `https://fonts.googleapis.com/css2?${fams.join("&")}&display=swap`,
  };
}

/** The tokens for a file: the brand design needs a kit and a white label plan, or it falls back to Arrowsterr's. */
export function tokensFor(design: PdfDesign, kit: BrandKit | null, whiteLabel: boolean): DesignTokens {
  return design === "brand" && kit && whiteLabel ? brandTokens(kit) : ARROWSTERR;
}

/** A file name for the PDF, with no maker's name in it on the brand design. */
export function fileName(title: string, brand: string, at: Date): string {
  const day = at.toISOString().slice(0, 10);
  const safe = `${brand} ${title} ${day}`.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 120);
  return `${safe || "report"}.pdf`;
}
