import { askClaude, parseJson } from "@/lib/claude";
import { cleanTheme, FONTS, TEMPLATES } from "@/lib/reportTheme";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { meteredRoute } from "@/lib/meter";
import { take } from "@/lib/entitlements";

/** Colors used most on a homepage, from its HTML and inline CSS. Used when there is no brand guideline. */
async function siteColors(domain: string) {
  try {
    const res = await fetch(`https://${domain}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ArrowsterrBot/1.0; +https://arrowsterr.com)" }, redirect: "follow", signal: AbortSignal.timeout(12_000) });
    const html = (await res.text()).slice(0, 1_500_000);
    const count = new Map<string, number>();
    for (const m of html.matchAll(/#[0-9a-f]{6}\b/gi)) count.set(m[0].toUpperCase(), (count.get(m[0].toUpperCase()) ?? 0) + 1);
    const theme = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)/i)?.[1] ?? null;
    const fonts = [...new Set([...html.matchAll(/family=([A-Za-z+]+)/g)].map((m) => m[1].replace(/\+/g, " ")))].slice(0, 5);
    return { themeColor: theme, colors: [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([c]) => c), fonts };
  } catch {
    return { themeColor: null, colors: [], fonts: [] };
  }
}

// The report agent: designs a report theme in the brand's style, from its brand guideline or its website, and any ask.
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const took = await take(body.workspaceId, "ai");
  if (!took.ok) return took.response;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY is not set on Render." }, { status: 500 });
  const brand = String(body.brand ?? "").slice(0, 100);
  const domain = String(body.domain ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").slice(0, 120);
  const ask = String(body.ask ?? "").slice(0, 600);
  const guideline = body.guideline ? JSON.stringify(body.guideline).slice(0, 6000) : "";
  const base = cleanTheme(body.base, TEMPLATES.find((t) => t.template === body.base?.template) ?? TEMPLATES[0]);
  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;

  const site = guideline ? null : await siteColors(domain);
  try {
    const { text } = await askClaude(
      `You design client report themes. Make a theme for a performance report for ${brand} (${domain}) that looks like their brand.

${guideline ? `Their brand guideline:\n${guideline}` : `No brand guideline. From their homepage: theme color ${site?.themeColor ?? "none"}; most used colors ${site?.colors.join(", ") || "none found"}; fonts ${site?.fonts.join(", ") || "unknown"}.`}
${ask ? `\nWhat the user asked for: ${ask}` : ""}

The current theme, to change from:
${JSON.stringify(base)}

Rules:
- accent is the main brand color. accent2 is a second brand color that looks good next to it in a gradient.
- ink, text and muted must be easy to read on surface and paper. heroText must be easy to read on heroBg.
- For a dark report, paper and surface are dark and ink, text and muted are light.
- Fonts must come from this list: ${FONTS.join(", ")}. Pick the closest match to the brand's fonts.
- hero is one of: dark, gradient, light, split. cards is one of: elevated, outline, tinted, flat. radius is 0 to 28.
- name is a short name for the theme, like "${brand} Brand".

Return JSON only, with every field: {"name","accent","accent2","ink","text","muted","paper","surface","line","heroBg","heroText","heading","body","label","radius","hero","cards","why"}
"why" is one short sentence on the choices.`,
      { maxTokens: 1200 },
    );
    const out = parseJson(text);
    const theme = cleanTheme({ ...out, template: "brand" }, base);
    return Response.json({ theme, why: typeof out.why === "string" ? out.why.slice(0, 300) : "" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Report style failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("report agent", handle);
