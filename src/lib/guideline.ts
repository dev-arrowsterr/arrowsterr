import "server-only";
import * as cheerio from "cheerio";
import { askClaude, parseJson } from "./claude";
import type { BrandGuideline } from "./writerTypes";

// Builds a brand guideline from a website: reads the full homepage HTML and its stylesheets,
// measures the colors, fonts and CSS variables actually used, then asks Claude to write it up.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function get(url: string, max = 3_000_000) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,text/css,*/*" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return "";
    return (await res.text()).slice(0, max);
  } catch {
    return "";
  }
}

/** Count how often each value appears, most used first. */
function top(values: string[], n: number) {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

const normHex = (h: string) => {
  const x = h.toLowerCase();
  return x.length === 4 ? `#${x[1]}${x[1]}${x[2]}${x[2]}${x[3]}${x[3]}` : x.slice(0, 7);
};

export async function readBrand(domain: string) {
  const base = `https://${domain}`;
  const html = await get(base);
  if (!html) throw new Error(`Could not load ${base}. Check the site is online and does not block bots.`);
  const $ = cheerio.load(html);

  // Stylesheets: inline styles plus the first few linked files.
  const links = $('link[rel="stylesheet"]')
    .map((_, l) => $(l).attr("href"))
    .get()
    .filter(Boolean)
    .slice(0, 5)
    .map((h) => new URL(h!, base).toString());
  const fonts = links.filter((l) => /fonts\.googleapis|typekit|fonts\.bunny/.test(l));
  const sheets = await Promise.all(links.filter((l) => !fonts.includes(l)).map((l) => get(l, 600_000)));
  const css = [$("style").map((_, s) => $(s).text()).get().join("\n"), ...sheets, $("[style]").map((_, e) => $(e).attr("style")).get().join(";")].join("\n");

  const vars = [...new Set([...css.matchAll(/(--[\w-]+)\s*:\s*([^;}{]{1,80})/g)].map((m) => `${m[1]}: ${m[2].trim()}`))].slice(0, 120);
  const colors = top([...css.matchAll(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g)].map((m) => normHex(m[0])), 24);
  const rgb = top([...css.matchAll(/rgba?\([^)]{5,40}\)/g)].map((m) => m[0].replace(/\s+/g, "")), 10);
  const families = top([...css.matchAll(/font-family\s*:\s*([^;}{]{1,120})/g)].map((m) => m[1].trim()), 8);
  const radii = top([...css.matchAll(/border-radius\s*:\s*([^;}{]{1,30})/g)].map((m) => m[1].trim()), 6);
  const googleFonts = fonts.flatMap((f) => [...f.matchAll(/family=([^&:]+)/g)].map((m) => decodeURIComponent(m[1]).replace(/\+/g, " ")));

  const logo =
    $('img[src*="logo" i], img[alt*="logo" i], [class*="logo" i] img, header img').first().attr("src") ??
    $('meta[property="og:image"]').attr("content") ??
    $('link[rel*="icon"]').attr("href") ??
    null;
  const text = (sel: string, n: number) => [...new Set($(sel).map((_, e) => $(e).text().replace(/\s+/g, " ").trim()).get().filter((t) => t.length > 1 && t.length < 160))].slice(0, n);
  const headings = text("h1, h2, h3", 40);
  const ctas = text('button, a[class*="btn" i], a[class*="button" i], [role="button"], input[type="submit"]', 25);
  $("script, style, noscript, svg").remove();
  const body = $("body").text().replace(/\s+/g, " ").trim().slice(0, 9000);

  return {
    title: $("title").first().text().trim(),
    description: $('meta[name="description"]').attr("content") ?? "",
    logo: logo ? new URL(logo, base).toString() : null,
    headings,
    ctas,
    body,
    vars,
    colors,
    rgb,
    families,
    radii,
    googleFonts,
  };
}

export async function buildGuideline(domain: string, name: string): Promise<BrandGuideline> {
  const b = await readBrand(domain);
  const prompt = `You are a brand strategist and front-end designer. Write a practical brand guideline for ${name} (${domain}) from its homepage. Writers and developers will follow it.

Page title: ${b.title}
Meta description: ${b.description}
Headings on the page:
${b.headings.join("\n")}
Buttons and calls to action: ${b.ctas.join(" | ")}
Page text: ${b.body}

Measured from the site's CSS:
- CSS variables: ${b.vars.join("; ") || "none"}
- Most used hex colors (color, times used): ${b.colors.map(([c, n]) => `${c} ${n}`).join(", ") || "none"}
- Other colors: ${b.rgb.map(([c, n]) => `${c} ${n}`).join(", ") || "none"}
- Font families: ${b.families.map(([f, n]) => `${f} (${n})`).join(" | ") || "none"}
- Web fonts loaded: ${b.googleFonts.join(", ") || "none"}
- Corner radius values: ${b.radii.map(([r, n]) => `${r} (${n})`).join(", ") || "none"}

Rules:
- Base every point on the evidence above. Name real colors and fonts from the CSS, not guesses.
- Pick 4 to 8 colors with clear roles (primary, accent, text, background, borders).
- The sample paragraph shows the voice in 2 to 3 sentences about this business.
- The css field is ready-to-paste CSS: a :root block with brand variables, then base styles for body, h1 to h3, links, a .btn and a .btn-secondary, and a .card.
- Plain language a 9th grader understands.

Return JSON only:
{
  "summary": "2 sentences on who the brand is and how it presents itself",
  "audience": "who the site speaks to",
  "voice": {"tone": ["3 to 5 words"], "do": ["4 to 6 rules"], "dont": ["4 to 6 rules"], "sample": "..."},
  "vocabulary": {"use": ["words and phrases the brand uses"], "avoid": ["words that do not fit"]},
  "writing": ["formatting rules: sentence length, heading case, lists, numbers, emojis, person (we/you)"],
  "ctas": ["call-to-action wording in the brand's style"],
  "colors": [{"name": "Primary", "hex": "#000000", "use": "where it is used"}],
  "typography": {"headings": "font and weight", "body": "font and size", "notes": "line height, letter spacing, case"},
  "ui": {"buttons": "...", "corners": "...", "spacing": "...", "imagery": "..."},
  "css": "..."
}`;
  const { text } = await askClaude(prompt, { maxTokens: 6000 });
  const g = parseJson(text) as Omit<BrandGuideline, "logo" | "at">;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    summary: String(g.summary ?? ""),
    audience: String(g.audience ?? ""),
    voice: { tone: list(g.voice?.tone), do: list(g.voice?.do), dont: list(g.voice?.dont), sample: String(g.voice?.sample ?? "") },
    vocabulary: { use: list(g.vocabulary?.use), avoid: list(g.vocabulary?.avoid) },
    writing: list(g.writing),
    ctas: list(g.ctas),
    colors: (Array.isArray(g.colors) ? g.colors : []).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c?.hex ?? "")).slice(0, 10),
    typography: { headings: String(g.typography?.headings ?? ""), body: String(g.typography?.body ?? ""), notes: String(g.typography?.notes ?? "") },
    ui: { buttons: String(g.ui?.buttons ?? ""), corners: String(g.ui?.corners ?? ""), spacing: String(g.ui?.spacing ?? ""), imagery: String(g.ui?.imagery ?? "") },
    css: String(g.css ?? ""),
    logo: b.logo,
    at: new Date().toISOString(),
  };
}

/** The guideline as compact text for the writing assistant's instructions. */
export function guidelineText(g: BrandGuideline | null) {
  if (!g) return "No brand guideline yet. Write in clear, friendly, plain English.";
  return `Brand: ${g.summary}
Audience: ${g.audience}
Voice: ${g.voice.tone.join(", ")}. Do: ${g.voice.do.join("; ")}. Don't: ${g.voice.dont.join("; ")}.
Voice sample: ${g.voice.sample}
Words to use: ${g.vocabulary.use.join(", ")}. Words to avoid: ${g.vocabulary.avoid.join(", ")}.
Writing rules: ${g.writing.join("; ")}
Calls to action: ${g.ctas.join(" | ")}
Colors: ${g.colors.map((c) => `${c.name} ${c.hex} (${c.use})`).join("; ")}
Typography: headings ${g.typography.headings}; body ${g.typography.body}; ${g.typography.notes}
UI: buttons ${g.ui.buttons}; corners ${g.ui.corners}; spacing ${g.ui.spacing}; imagery ${g.ui.imagery}
Brand CSS:
${g.css}`;
}
