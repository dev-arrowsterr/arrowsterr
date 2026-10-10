import type { Brief } from "@/lib/briefTypes";
import { askClaude, parseJson } from "@/lib/claude";
import { buildGuideline, guidelineText } from "@/lib/guideline";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { findPages } from "@/lib/sitemap";
import type { BrandGuideline } from "@/lib/writerTypes";
import { meteredRoute } from "@/lib/meter";
import { requireTrack, take } from "@/lib/entitlements";
import { TASK_COST } from "@/lib/plans";
import { cached, DAY } from "@/lib/cache";
import { normalizeSite } from "@/lib/site";
import type { AgentTask } from "@/lib/writerAgent";

const TASKS: AgentTask[] = ["write", "table", "widget", "stats", "links", "faq", "meta", "custom"];
const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const list = (v: unknown) => (Array.isArray(v) ? v : []);

// Agents beside each section of a draft. They do jobs around the writing, never the writing itself:
// a table in the brand's style, stats from sources, FAQ schema, meta tags and internal links.
//   { siteId, docId, task, heading, section, docText }
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const paid = await requireTrack(body.workspaceId, "seo");
  if (paid) return paid;
  const task = body.task as AgentTask;
  if (!TASKS.includes(task)) return Response.json({ error: "Unknown task." }, { status: 400 });
  const took = await take(body.workspaceId, "tasks", task === "widget" ? TASK_COST.widget : task === "stats" ? TASK_COST.stats : TASK_COST.agent);
  if (!took.ok) return took.response;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY is not set on Render." }, { status: 500 });

  const { data: site } = await auth.sb.from("sites").select("id, name, domain, guideline").eq("id", body.siteId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (!site) return Response.json({ error: "Website not found." }, { status: 404 });
  // Writing and design jobs follow the brand. The first time, the agent reads the site and saves its guideline.
  let guideline = site.guideline as BrandGuideline | null;
  if (!guideline && ["write", "table", "widget", "custom"].includes(task)) {
    guideline = await buildGuideline(site.domain, site.name).catch(() => null);
    if (guideline) await auth.sb.from("sites").update({ guideline, guideline_at: guideline.at }).eq("id", site.id);
  }
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
  const guide = str(body.guide, 3000);
  const ask = str(body.instruction, 1500);
  const section = str(body.section, 8000);
  const docText = str(body.docText, 14000);
  const head = `You are an agent inside Arrowsterr working on a draft for ${site.name} (${site.domain})${keyword ? `, target keyword "${keyword}"` : ""}. A human writes the article. You do one job around it and answer with JSON only, no other text. Never invent facts, numbers, customers or quotes.`;

  const brand = guidelineText(guideline);
  const context = `Brand guideline:
${brand}

${
  brief
    ? `Content brief: intent: ${brief.analysis.intent}. Format: ${brief.analysis.format}. Must cover: ${brief.analysis.mustCover.join("; ")}. Terms to use: ${brief.brief.terms.join(", ")}. Make it yours: ${brief.brief.makeItYours.join("; ")}.`
    : ""
}

The whole draft so far (for context, may be cut short):
${docText.slice(0, 9000) || "(empty)"}

The section you work on is under the heading "${heading}".
${guide ? `The guide for this section: ${guide}` : ""}
What is written under it now:
${section.trim() || "(nothing yet)"}`;
  const htmlRules = `Write HTML using only <p>, <h3>, <h4>, <ul>, <ol>, <li>, <strong>, <em>, <a href>, <blockquote>, <table>, <thead>, <tbody>, <tr>, <th>, <td>. No <h1> or <h2>, no classes, no styles, no scripts. Do not repeat the section heading.`;

  try {
    if (task === "write" || task === "custom") {
      const { text } = await askClaude(
        `${head}

${context}

Job: ${
          task === "write"
            ? `write this section, ready to publish. Follow the guide and the brief. Use the brand's voice. Keep it tight: say only what helps the reader decide. Use lists or a short table where they help. ${section.trim() ? "Keep what the writer wrote and build on it." : ""}`
            : `do what the writer asks for this section: "${ask}". The result goes straight into the section.`
        }
Use [brackets] for facts only the brand knows, like prices or customer names. ${htmlRules}
Answer: {"html": "...", "note": "one short line on what you did"}`,
        { maxTokens: 6000 },
      );
      const j = parseJson(text);
      const html = String(j.html ?? "").trim();
      if (!html) throw new Error("The agent came back empty. Try again.");
      return Response.json({ task, html, note: str(j.note, 200), replace: task === "write" && !section.trim() });
    }

    if (task === "widget") {
      const { text } = await askClaude(
        `${head}

${context}

Job: code one interactive element that makes this section more useful, like a cost calculator, a quiz that recommends an option, a filterable comparison or a checklist. Pick what fits the section best. Use the brand's colors, fonts and corner style from the guideline. Self-contained: one <div> with a unique id, one <style> scoped to that id, one <script> in plain JavaScript. No outside libraries, fonts or requests. Works on phones. Use [brackets] for numbers only the brand knows.
Answer: {"embed": "<div ...>...</div><style>...</style><script>...</script>", "note": "one short line on what it does"}`,
        { maxTokens: 8000 },
      );
      const j = parseJson(text);
      const embed = String(j.embed ?? "").trim();
      if (!embed) throw new Error("The agent came back empty. Try again.");
      return Response.json({ task, embed, note: str(j.note, 200) });
    }

    if (task === "table") {
      const { text } = await askClaude(
        `${head}

${context}

Job: build one comparison or summary table that makes this section easier to scan. Use facts from the section, the draft or the brief. Put [brackets] where the writer must fill in a value. Use the brand's words for labels. 2 to 6 columns, 2 to 8 rows.
Answer: {"caption": "...", "head": ["..."], "rows": [["..."]]}`,
        { maxTokens: 2000 },
      );
      const j = parseJson(text);
      const headRow = list(j.head).map((x) => str(x, 120));
      const rows = list(j.rows).map((r) => list(r).map((x) => str(x, 300)));
      if (!headRow.length || !rows.length) throw new Error("The agent could not build a table from this section yet.");
      const e = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const html = `<table><thead><tr>${headRow.map((x) => `<th>${e(x)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${headRow.map((_, k) => `<td>${e(r[k] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      return Response.json({ task, html, note: str(j.caption, 200) });
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
      if (!stats.length) throw new Error("No stats with a real source found for this section.");
      const e = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const html = `<ul>${stats.map((x) => `<li>${e(x.stat)} (<a href="${e(x.url)}">${e(x.source || "source")}${x.year ? `, ${e(x.year)}` : ""}</a>)</li>`).join("")}</ul>`;
      return Response.json({ task, html, note: `${stats.length} stats with sources` });
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
