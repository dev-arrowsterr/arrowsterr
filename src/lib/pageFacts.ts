// Read a page the way an AI crawler does: no JavaScript, main content only (Mozilla Readability).
// No server imports, so tests can run it on sample pages.
import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";
import { parseHTML } from "linkedom";
import type { PageFacts } from "./freeChecks.ts";

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Every @type in the page's JSON-LD, including inside @graph. */
export function schemaTypes(html: string): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const walk = (n: unknown): void => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (n && typeof n === "object") {
          const o = n as Record<string, unknown>;
          if (o["@type"]) out.push(...[o["@type"]].flat().map(String));
          for (const k of ["@graph", "mainEntity", "author", "publisher"]) if (o[k]) walk(o[k]);
        }
      };
      walk(JSON.parse($(el).text()));
    } catch {
      // Broken JSON-LD counts as none.
    }
  });
  return [...new Set(out)];
}

export function pageFacts(html: string, url: string, aiBlocked: string[]): PageFacts {
  const $ = cheerio.load(html);
  const types = schemaTypes(html);
  const raw = html.replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, "");

  // Main content: Readability on a copy of the page. If it finds nothing, fall back to the body.
  const { document } = parseHTML(raw);
  let article: { content?: string | null; textContent?: string | null } | null = null;
  try {
    article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
  } catch {
    article = null;
  }
  const main = cheerio.load(article?.content || $("body").html() || "");
  main("nav, footer, header, aside, form, script, style, noscript, template").remove();
  const paragraphs = main("p")
    .map((_, p) => main(p).text().replace(/\s+/g, " ").trim())
    .get()
    .filter((t) => words(t) >= 6);
  const text = (article?.textContent || main.root().text()).replace(/\s+/g, " ").trim();
  const headings = $("h2, h3")
    .map((_, h) => $(h).text().replace(/\s+/g, " ").trim())
    .get()
    .filter(Boolean);
  const faq =
    types.some((t) => /^(FAQPage|QAPage)$/i.test(t)) ||
    headings.some((h) => /\b(faq|frequently asked|questions)\b/i.test(h)) ||
    $("details summary").length >= 3;
  const dated =
    Boolean($('meta[property="article:modified_time"], meta[property="article:published_time"], meta[name="date"], meta[itemprop="dateModified"], meta[itemprop="datePublished"]').length) ||
    $("time[datetime]").length > 0 ||
    /"date(Modified|Published)"\s*:/.test(html);
  const author =
    Boolean($('meta[name="author"], [rel="author"], [itemprop="author"], .author, .byline').length) ||
    /"author"\s*:/.test(html) ||
    types.some((t) => /^(Organization|Person)$/i.test(t));
  void url;
  return {
    title: $("title").first().text().trim(),
    description: ($('meta[name="description"]').attr("content") ?? "").trim(),
    h1: $("h1").length,
    subheadings: headings.length,
    questionHeadings: headings.filter((h) => /\?\s*$|^(what|how|why|which|who|where|when|can|is|are|does|do|should)\b/i.test(h)).length,
    firstParagraph: paragraphs[0] ?? "",
    paragraphWords: paragraphs.map(words),
    lists: main("ul, ol").filter((_, l) => main(l).children("li").length >= 2).length,
    tables: main("table").length,
    schemaTypes: types,
    faq,
    words: words(text),
    text: text.slice(0, 20000),
    dated,
    author,
    aiBlocked,
  };
}
