import type { Brief } from "@/lib/briefTypes";
import { askClaude, parseJson } from "@/lib/claude";
import { guidelineText } from "@/lib/guideline";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { findPages } from "@/lib/sitemap";
import type { BrandGuideline } from "@/lib/writerTypes";
import { meteredRoute } from "@/lib/meter";
import { take } from "@/lib/entitlements";
import { cached, DAY } from "@/lib/cache";
import { normalizeSite } from "@/lib/site";
import type { AgentTask } from "@/lib/writerAgent";

const TASKS: AgentTask[] = ["table", "stats", "faq", "meta", "links"];
const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const list = (v: unknown) => (Array.isArray(v) ? v : []);

// Agents beside each section of a draft. They do jobs around the writing, never the writing itself:
// a table in the brand's style, stats from sources, FAQ schema, meta tags and internal links.
//   { siteId, docId, task, heading, section, docText }
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const task = body.task as AgentTask;
  if (!TASKS.includes(task)) return Response.json({ error: "Unknown task." }, { status: 400 });
  const took = await take(body.workspaceId, "ai");
  if (!took.ok) return took.response;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY is not set on Render." }, { status: 500 });

  const { data: site } = await auth.sb.from("sites").select("name, domain, guideline").eq("id", body.siteId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (!site) return Response.json({ error: "Website not found." }, { status: 404 });
  let brief: Brief | null = null;
  let keyword = "";
  if (body.docId) {
    const { data: doc } = await auth.sb.from("docs").select("calendar_item_id").eq("id", body.docId).maybeSingle();
    if (doc?.calendar_item_id) {
      const { data: item } = await auth.sb.from("calendar_items").select("keyword, brief").eq("id", doc.calendar_item_id).maybeSingle();
      brief = (item?.brief as Brief | null) ?? null;
      keyword = item?.keyword ?? "";
    }
  }
  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;

  const heading = str(body.heading, 300);
  const section = str(body.section, 8000);
  const docText = str(body.docText, 14000);
  const head = `You are an agent inside Arrowsterr working on a draft for ${site.name} (${site.domain})${keyword ? `, target keyword "${keyword}"` : ""}. A human writes the article. You do one job around it and answer with JSON only, no other text. Never invent facts, numbers, customers or quotes.`;

  try {
    if (task === "table") {
      const { text } = await askClaude(
        `${head}

Brand guideline:
${guidelineText(site.guideline as BrandGuideline | null)}

Section "${heading}":
${section || "(empty)"}

Job: build one comparison or summary table that makes this section easier to scan. Use only facts in the section or the brief. Put [brackets] where the writer must fill in a value. Use the brand's words for labels. 2 to 6 columns, 2 to 8 rows.
Answer: {"caption": "...", "head": ["..."], "rows": [["..."]]}`,
        { maxTokens: 2000 },
      );
      const j = parseJson(text);
      const headRow = list(j.head).map((x) => str(x, 120));
      const rows = list(j.rows).map((r) => list(r).map((x) => str(x, 300)));
      if (!headRow.length || !rows.length) throw new Error("The agent could not build a table from this section yet.");
      return Response.json({ task, table: { caption: str(j.caption, 200), head: headRow, rows } });
    }

    if (task === "stats") {
      const sources = brief?.brief.sources ?? [];
      const { text } = await askClaude(
        `${head}

Section "${heading}":
${section || "(empty)"}

${sources.length ? `Sources from the content brief, check these first:\n${sources.slice(0, 10).join("\n")}\n` : ""}
Job: find 3 to 5 recent, specific statistics that back up this section. Search the web. Every stat needs the page it comes from. Prefer the brief's sources, then research firms, government data and well known publications. Skip anything you cannot find on a real page.
Answer: {"stats": [{"stat": "one sentence with the number", "source": "publisher name", "url": "https://...", "year": "2025"}]}`,
        { maxTokens: 4000, searches: 5 },
      );
      const stats = list(parseJson(text).stats)
        .map((s) => s as Record<string, unknown>)
        .map((s) => ({ stat: str(s.stat, 400), source: str(s.source, 120), url: str(s.url, 500), year: str(s.year, 10) }))
        .filter((s) => s.stat && /^https?:\/\//.test(s.url));
      return Response.json({ task, stats });
    }

    if (task === "faq") {
      const { text } = await askClaude(
        `${head}

The draft:
${docText || "(empty)"}

Job: pull the question and answer pairs this draft already answers, best from its FAQ section. Use the writer's own answer text, trimmed to 1 to 3 sentences. Skip questions the draft does not answer.
Answer: {"faq": [{"q": "...", "a": "..."}]}`,
        { maxTokens: 3000 },
      );
      const faq = list(parseJson(text).faq)
        .map((x) => x as Record<string, unknown>)
        .map((x) => ({ q: str(x.q, 300), a: str(x.a, 1200) }))
        .filter((x) => x.q && x.a);
      if (!faq.length) throw new Error("The draft does not answer any questions yet. Write the FAQ section first.");
      const schema = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })) };
      return Response.json({ task, faq, schema: JSON.stringify(schema, null, 2) });
    }

    if (task === "meta") {
      const { text } = await askClaude(
        `${head}

${brief ? `The brief suggests titles: ${brief.brief.titles.join(" | ")}\nand meta description: ${brief.brief.metaDescription}\n` : ""}
The draft:
${docText.slice(0, 8000) || "(empty)"}

Job: write the SEO meta title (50 to 60 characters, keyword near the start), the meta description (140 to 155 characters, says what the reader gets and why click) and a short URL slug, all true to the draft.
Answer: {"title": "...", "description": "...", "slug": "..."}`,
        { maxTokens: 800 },
      );
      const j = parseJson(text);
      return Response.json({ task, meta: { title: str(j.title, 90), description: str(j.description, 220), slug: str(j.slug, 90).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") } });
    }

    // Internal links: pages from the site's sitemap that this section should link to.
    const domain = normalizeSite(site.domain)?.domain ?? site.domain;
    const { data: map } = await cached(`sitemap:${domain}`, 7 * DAY, () => findPages(domain));
    const pages = map.pages.map((p) => p.url).slice(0, 400);
    if (!pages.length) throw new Error(`No sitemap found for ${domain}.`);
    const { text } = await askClaude(
      `${head}

Section "${heading}":
${section || "(empty)"}

Pages on ${domain}:
${pages.join("\n")}

Job: pick up to 5 pages this section should link to. For each, give an anchor: a short phrase copied exactly from the section text, 2 to 6 words, that describes the page. Only pick pages that truly match.
Answer: {"links": [{"anchor": "exact words from the section", "url": "https://..."}]}`,
      { maxTokens: 1500 },
    );
    const links = list(parseJson(text).links)
      .map((x) => x as Record<string, unknown>)
      .map((x) => ({ anchor: str(x.anchor, 120), url: str(x.url, 500) }))
      .filter((x) => x.anchor && pages.includes(x.url));
    return Response.json({ task, links });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Writer agent failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("writer agent", handle);
