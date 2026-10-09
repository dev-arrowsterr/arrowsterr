// The content brief as an editable document, laid out like the agency brief template.
// Pure functions, shared by the browser and tests.
import type { Brief } from "./briefTypes.ts";
import type { BrandGuideline } from "./writerTypes.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ul = (xs: string[]) => (xs.length ? `<ul>${xs.map((x) => `<li><p>${esc(x)}</p></li>`).join("")}</ul>` : "<p></p>");
const ol = (xs: string[]) => (xs.length ? `<ol>${xs.map((x) => `<li><p>${esc(x)}</p></li>`).join("")}</ol>` : "<p></p>");
/** "Short phrase. The rest" becomes a bold lead-in, like the template's goals. */
const lead = (x: string) => {
  const m = x.match(/^([^.:]{3,80}[.:])\s+(.+)$/);
  return m ? `<strong>${esc(m[1])}</strong> ${esc(m[2])}` : esc(x);
};

export type BriefItem = { keyword: string; secondary: string[]; action: "new" | "update"; current_url: string | null };

/** Build the brief document. Brand guideline and positioning come first, then writer guidelines, SERP analysis and the outline. */
export function briefDocHtml(item: BriefItem, b: Brief, brand: { name: string; country?: string }, guideline: BrandGuideline | null): string {
  const d = b.brief;
  const t = b.template;
  const title = d.h1 || item.keyword;
  const pos = t?.positioning;
  const top5 = b.serp.pages.slice(0, 5);
  const outline = t?.outline?.length
    ? t.outline
    : [
        { section: "Introduction", guide: `Answer "${item.keyword}" in the first 2 to 3 sentences. ${b.analysis.intent}` },
        ...d.outline.map((o) => ({ section: `H2: ${o.h2}`, guide: [o.notes, ...o.h3.map((h) => `H3: ${h}`)].filter(Boolean).join("\n") })),
      ];

  return [
    `<p><em>Content Brief</em></p>`,
    `<h1>${esc(title)}</h1>`,
    `<table><tbody>`,
    `<tr><th><p>Main keyword</p></th><td><p>${esc(item.keyword)}</p></td></tr>`,
    item.secondary.length ? `<tr><th><p>Also target</p></th><td><p>${esc(item.secondary.join(", "))}</p></td></tr>` : "",
    `<tr><th><p>Job</p></th><td><p>${item.action === "update" ? `Improve ${esc(item.current_url ?? "the existing page")}` : "New page"}</p></td></tr>`,
    `<tr><th><p>Format</p></th><td><p>${esc(b.analysis.format)}</p></td></tr>`,
    `<tr><th><p>Length</p></th><td><p>${esc(d.wordCount)} words</p></td></tr>`,
    `<tr><th><p>Title tag</p></th><td><p>${esc(d.titles[0] ?? "")}</p></td></tr>`,
    `<tr><th><p>Meta description</p></th><td><p>${esc(d.metaDescription)}</p></td></tr>`,
    `<tr><th><p>URL</p></th><td><p>${esc(d.slug)}</p></td></tr>`,
    `</tbody></table>`,

    `<h2>1. Editorial Guideline</h2>`,
    guideline
      ? [
          `<p>${esc(guideline.summary)}</p>`,
          guideline.voice.tone.length ? `<p><strong>Voice:</strong> ${esc(guideline.voice.tone.join(", "))}</p>` : "",
          `<h4>Do</h4>${ul(guideline.voice.do)}`,
          `<h4>Don't</h4>${ul(guideline.voice.dont)}`,
          guideline.writing.length ? `<h4>Writing rules</h4>${ul(guideline.writing)}` : "",
        ].join("")
      : `<p>Add your editorial guideline here, or build one in the Writer's Brand tab.</p>`,

    `<h2>2. ${esc(brand.name)}'s Positioning</h2>`,
    pos
      ? `<ul><li><p><strong>Who:</strong> ${esc(pos.who)}</p></li><li><p><strong>Where-to:</strong> ${esc(pos.whereTo)}</p></li><li><p><strong>How-to:</strong> ${esc(pos.howTo)}</p></li><li><p><strong>Why-so:</strong> ${esc(pos.whySo)}</p></li></ul>`
      : `<ul><li><p><strong>Who:</strong> </p></li><li><p><strong>Where-to:</strong> </p></li><li><p><strong>How-to:</strong> </p></li><li><p><strong>Why-so:</strong> </p></li></ul>`,

    `<h2>3. Writer Guidelines</h2>`,
    `<h3>Article Goal</h3>`,
    t?.goals?.length ? `<ol>${t.goals.map((g) => `<li><p>${lead(g)}</p></li>`).join("")}</ol>` : ol(b.analysis.actions.slice(0, 4)),

    `<h3>LEMA Framework Answers</h3>`,
    `<h4>What does the person who searches for "${esc(item.keyword)}" already know?</h4>`,
    ul(t?.lema.knows ?? []),
    `<h4>What does the person who searches want to know?</h4>`,
    ul(t?.lema.wants ?? b.analysis.mustCover.slice(0, 5)),
    `<h4>What should they know about this topic that they didn't know they needed?</h4>`,
    ul(t?.lema.shouldKnow ?? b.analysis.gaps.slice(0, 3)),
    `<h4>What action should they take after reading?</h4>`,
    `<p>${esc(t?.lema.action ?? "")}</p>`,

    `<h3>SERP Analysis</h3>`,
    `<p>Top ${top5.length} articles ranking for the keyword in ${esc(brand.country || "the United States")}:</p>`,
    top5.length ? `<ol>${top5.map((p) => `<li><p><a href="${esc(p.url)}">${esc(p.url)}</a> — ${esc(p.title)}</p></li>`).join("")}</ol>` : "<p></p>",
    `<p><strong>What wins:</strong> ${esc(b.analysis.format)}. ${esc(b.analysis.formatWhy)}</p>`,
    b.analysis.gaps.length ? `<p><strong>Gaps to win on:</strong></p>${ul(b.analysis.gaps)}` : "",

    `<h2>4. Article Outline</h2>`,
    `<table><tbody><tr><th><p>Section</p></th><th><p>Guide</p></th></tr>`,
    ...outline.map((o) => `<tr><td><p><strong>${esc(o.section)}</strong></p></td><td>${o.guide.split(/\n+/).map((l) => `<p>${esc(l)}</p>`).join("")}</td></tr>`),
    `</tbody></table>`,

    `<h2>Additional Notes</h2>`,
    d.questions.length ? `<h4>Questions to answer</h4>${ul(d.questions)}` : "",
    d.makeItYours.length ? `<h4>Make it yours</h4>${ul(d.makeItYours)}` : "",
    d.internalLinks.length ? `<h4>Internal links</h4><ul>${d.internalLinks.map((l) => `<li><p><a href="${esc(l.url)}">${esc(l.anchor)}</a></p></li>`).join("")}</ul>` : "",
    d.aiTips.length ? `<h4>Getting cited by AI</h4>${ul(d.aiTips)}` : "",
    `<p></p>`,
  ].join("");
}

/** A Word file that opens editable in Word and Google Docs. */
export function wordFile(title: string, html: string) {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Arial,sans-serif;font-size:11pt;line-height:1.5}h1{font-size:20pt}h2{font-size:15pt;margin-top:18pt}h3{font-size:12.5pt}h4{font-size:11pt}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:6pt;vertical-align:top;text-align:left}th{background:#f1f3f6}</style></head><body>${html}</body></html>`;
}
