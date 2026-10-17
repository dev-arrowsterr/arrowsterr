// The words of a web page, without its menus, footers and scripts. Pure, so tests can cover it. Server only in practice (cheerio).
import * as cheerio from "cheerio";

/** The page's main writing: the article or main element when there is one, else the body. At most max characters. */
export function pageText(html: string, max = 6000): { title: string; text: string; words: number } {
  const $ = cheerio.load(html.slice(0, 3_000_000));
  const title = $("title").first().text().replace(/\s+/g, " ").trim().slice(0, 160);
  $("script, style, noscript, svg, iframe, template, nav, header, footer, aside, form, button, [role=navigation], [aria-hidden=true]").remove();
  const root = $("article").first().length ? $("article").first() : $("main").first().length ? $("main").first() : $("body");
  // Block elements end a line, so sentences from different paragraphs don't run together.
  root.find("p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, br, div").each((_, el) => {
    $(el).append("\n");
  });
  const text = root
    .text()
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.split(" ").length >= 4) // menus and labels are short; writing isn't
    .join("\n");
  return { title, text: text.slice(0, max), words: text.split(/\s+/).filter(Boolean).length };
}
