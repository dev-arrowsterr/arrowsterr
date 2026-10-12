import { askClaude, parseJson } from "@/lib/claude";
import { readBrand } from "@/lib/guideline";
import { cleanTheme, FONTS, TEMPLATES } from "@/lib/reportTheme";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { normalizeSite } from "@/lib/site";
import { meteredRoute } from "@/lib/meter";
import { take } from "@/lib/entitlements";
import { TASK_COST } from "@/lib/plans";

// The white label agent: reads the agency's website and learns its brand for client reports.
// Returns the agency name, logo, footer line and a report theme in their colors and fonts.
//   { website }
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY is not set on Render." }, { status: 500 });
  const site = normalizeSite(String(body.website ?? ""));
  if (!site) return Response.json({ error: "Enter your agency's website, like agency.com." }, { status: 400 });
  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;
  const took = await take(body.workspaceId, "tasks", TASK_COST.guideline);
  if (!took.ok) return took.response;

  try {
    const b = await readBrand(site.domain);
    const logoList = b.logos.map((u, i) => `${i}: ${u.startsWith("data:") ? `inline SVG from the header (${decodeURIComponent(u).slice(0, 300)}...)` : u}`).join("\n");
    const { text } = await askClaude(
      `You set up white label client reports for a marketing agency. Learn the agency's brand from its homepage, then design a report theme that looks like it.

Website: ${site.domain}
Site name: ${b.siteName || "unknown"}
Page title: ${b.title}
Meta description: ${b.description}
Headings: ${b.headings.slice(0, 15).join(" | ")}
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
- agency is the agency's short brand name, as people say it. Not the page title.
- logo is the index of the option that is most likely the main logo: a file or SVG named or placed as the logo beats a favicon or a social image. Use -1 if none fit.
- The logo sits on the report cover (heroBg). If the logo is dark (most are), use a light cover ("light" or "split" hero). Use a dark cover only if the logo looks white or light, like a file named logo-white.
- footer is one short contact line for the bottom of each report, like "hello@agency.com · agency.com". Use a real email from the page if there is one.
- accent is the agency's main brand color. accent2 is a second brand color that looks good next to it.
- ink, text and muted must be easy to read on surface and paper. heroText must be easy to read on heroBg.
- Fonts must come from this list: ${FONTS.join(", ")}. Pick the closest match to the site's fonts.
- hero is one of: dark, gradient, light, split. cards is one of: elevated, outline, tinted, flat. radius is 0 to 28, close to the site's corners.
- name is the theme name, like "<agency> Brand".

Return JSON only:
{"agency","logo","footer","theme":{"name","accent","accent2","ink","text","muted","paper","surface","line","heroBg","heroText","heading","body","label","radius","hero","cards"},"why"}
"why" is one short sentence on what you learned about the brand.`,
      { maxTokens: 1500 },
    );
    const out = parseJson(text);
    const i = typeof out.logo === "number" ? out.logo : Number(out.logo);
    const logo = Number.isInteger(i) && i >= 0 && i < b.logos.length ? b.logos[i] : "";
    const theme = cleanTheme({ ...(out.theme && typeof out.theme === "object" ? out.theme : {}), template: "brand" }, TEMPLATES[0]);
    return Response.json({
      website: site.domain,
      style: {
        agency: typeof out.agency === "string" ? out.agency.trim().slice(0, 60) : b.siteName.slice(0, 60),
        logo,
        footer: typeof out.footer === "string" ? out.footer.trim().slice(0, 140) : site.domain,
        theme,
        color: theme.accent,
      },
      why: typeof out.why === "string" ? out.why.slice(0, 300) : "",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Report brand failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("report brand", handle);
