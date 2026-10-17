import "server-only";
import { askJson } from "./claude";
import { readBrand } from "./guideline";
import { FONTS } from "./reportTheme";
import { cleanKit, fontNames, KIT_SCHEMA, paletteOf, pickLogo, type BrandKit, type KitPart } from "./brandKit";

type Said = Exclude<KitPart, { part: "done" } | { part: "error" }>;

/**
 * Learn a Brand Kit from a website (docs/reports.md, section 31).
 * say() gets each part as soon as it is known: the measured colors and fonts come straight from the site's CSS,
 * then the agent picks the logo and finishes the kit.
 */
export async function learnKit(domain: string, say: (p: Said) => void): Promise<{ kit: BrandKit; why: string }> {
  const b = await readBrand(domain);
  say({ part: "site", domain, title: (b.siteName || b.title).slice(0, 80) });
  const colors = paletteOf(b.colors);
  if (colors.length) say({ part: "colors", colors });
  const fonts = fontNames(b.families, b.googleFonts);
  if (fonts.length) say({ part: "fonts", fonts });

  const logoList = b.logos.map((u, i) => `${i}: ${u.startsWith("data:") ? `inline SVG from the header (${decodeURIComponent(u).slice(0, 300)}...)` : u}`).join("\n");
  const out = await askJson<Record<string, unknown>>(
    `You build a Brand Kit for a company from its homepage. Reports, emails and pages will use it, so it must look like the company's own brand.

Website: ${domain}
Site name: ${b.siteName || "unknown"}
Page title: ${b.title}
Meta description: ${b.description}
Headings: ${b.headings.slice(0, 15).join(" | ")}
Buttons: ${b.ctas.slice(0, 10).join(" | ")}
Page text: ${b.body.slice(0, 2500)}
Emails on the page: ${b.contact.emails.join(", ") || "none"}
Phones on the page: ${b.contact.phones.join(", ") || "none"}

Logo options (index: address):
${logoList || "none found"}

Measured from the site's CSS:
- CSS variables: ${b.vars.slice(0, 60).join("; ") || "none"}
- Most used hex colors (color, times used): ${b.colors.map(([c, n]) => `${c} ${n}`).join(", ") || "none"}
- Font families: ${b.families.map(([f, n]) => `${f} (${n})`).join(" | ") || "none"}
- Web fonts loaded: ${b.googleFonts.join(", ") || "none"}
- Corner radius values: ${b.radii.map(([r, n]) => `${r} (${n})`).join(", ") || "none"}

Rules:
- name is the company's short brand name, as people say it. Not the page title.
- logo is the index of the option most likely to be the main logo. A file or SVG named or placed as the logo beats a favicon or a social image. Use -1 if none fit.
- logoOnDark is true only if the logo looks white or light (for example a file named logo-white), so it needs a dark background.
- colors.primary is the main brand color, the one on buttons and links. colors.secondary is a second brand color that looks good next to it.
- colors.ink is for headings, colors.text for body copy, colors.muted for small notes. All three must be easy to read on colors.surface (cards) and colors.paper (the page). colors.line is a soft border color.
- Use 6-digit hex colors like #0943b0.
- fonts must come from this list: ${FONTS.join(", ")}. Pick the closest match to the site's fonts.
- radius is 0 to 28, close to the site's corners.
- footer is one short contact line, like "hello@company.com · company.com". Use a real email from the page if there is one.
- voice.tone is up to 3 single words for how the brand sounds. voice.sample is one short line in that voice, taken from or close to the page.
- why is one short sentence on what you learned about the brand.`,
    KIT_SCHEMA,
    { maxTokens: 1500 },
  );
  const kit = cleanKit({ ...out, logo: pickLogo(out.logo, b.logos) });
  say({ part: "logo", logo: kit.logo, onDark: kit.logoOnDark });
  return { kit, why: typeof out.why === "string" ? out.why.slice(0, 300) : "" };
}
