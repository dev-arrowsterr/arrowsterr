// Writer's Workspace helpers. Pure functions, shared by the browser and tests.
import type { Brief } from "./briefTypes.ts";

type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };
const t = (text: string): Node[] => (text ? [{ type: "text", text }] : []);
const h = (level: number, text: string): Node => ({ type: "heading", attrs: { level }, content: t(text) });
const p = (text = ""): Node => ({ type: "paragraph", content: t(text) });

const FAQ = "Frequently asked questions";

/** Turn a content brief into a draft: just the headings, formatted, with room to write under each. The guide for each heading lives in the comments beside the draft. */
export function briefToDoc(keyword: string, _secondary: string[], brief: Brief): Node {
  const b = brief.brief;
  const content: Node[] = [h(1, b.h1 || keyword), p()];
  for (const o of b.outline) {
    content.push(h(2, o.h2));
    if (!o.h3.length) content.push(p());
    for (const sub of o.h3) content.push(h(3, sub), p());
  }
  if (b.questions.length) {
    content.push(h(2, FAQ));
    for (const q of b.questions.slice(0, 8)) content.push(h(3, q), p());
  }
  return { type: "doc", content };
}

export type Guide = { title: string; text: string; points?: string[] };
const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** What to write under each heading of a draft made from a brief, found by the heading's text. */
export function briefGuides(keyword: string, secondary: string[], brief: Brief): Map<string, Guide> {
  const b = brief.brief;
  const a = brief.analysis;
  const g = new Map<string, Guide>();
  const tmpl = new Map((brief.template?.outline ?? []).map((o) => [key(o.section), o.guide]));
  g.set(key(b.h1 || keyword), {
    title: "Intro",
    text: `Say who this is for and answer "${keyword}" in the first 2 to 3 sentences. ${a.intent}`,
    points: [
      `Format: ${a.format}, about ${b.wordCount} words`,
      ...(secondary.length ? [`Also covers: ${secondary.slice(0, 4).join(", ")}`] : []),
      ...b.makeItYours.map((x) => `Make it yours: ${x}`),
    ],
  });
  for (const o of b.outline) {
    const text = tmpl.get(key(o.h2)) ?? o.notes;
    const links = b.internalLinks.filter((l) => key(o.h2 + " " + o.notes).includes(key(l.anchor).split(" ")[0] ?? "")).slice(0, 2);
    g.set(key(o.h2), { title: "Guide", text: text || "Cover this point clearly, with an example.", points: [...(o.h3.length ? [`Sub-points: ${o.h3.join(" · ")}`] : []), ...links.map((l) => `Link "${l.anchor}" to ${l.url}`)] });
  }
  if (b.questions.length) {
    g.set(key(FAQ), { title: "Guide", text: "Answer each question in 2 to 3 sentences. Lead with the direct answer so AI assistants can quote it." });
    for (const q of b.questions.slice(0, 8)) g.set(key(q), { title: "Answer", text: "Give the direct answer in the first sentence, then one line of detail or an example." });
  }
  return g;
}
export const guideKey = key;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s: string) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');

/** Simple, safe Markdown to HTML for the assistant's replies. Everything is escaped first. */
export function mdToHtml(md: string): string {
  const out: string[] = [];
  const lines = md.replace(/\r/g, "").split("\n");
  let list: "ul" | "ol" | null = null;
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      close();
      const code: string[] = [];
      while (++i < lines.length && !lines[i].startsWith("```")) code.push(lines[i]);
      out.push(`<pre data-lang="${esc(fence[1])}"><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    const hd = line.match(/^(#{1,4})\s+(.*)/);
    const ul = line.match(/^\s*[-*]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (hd) {
      close();
      const level = Math.min(4, hd[1].length + 1);
      out.push(`<h${level}>${inline(hd[2])}</h${level}>`);
    } else if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      if (list !== kind) {
        close();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
    } else if (!line.trim()) {
      close();
    } else {
      close();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  close();
  return out.join("");
}

export type Section = { heading: string; words: number };

/**
 * How much of the brief the draft covers: each subtopic, question, term and link, done or not.
 * text is the writer's body text (no headings, no notes). A question counts as answered when the text
 * covers it, or when the section under a heading that asks it has at least 15 words.
 */
export function coverage(text: string, html: string, brief: Brief, sections: Section[] = []) {
  const lower = text.toLowerCase();
  const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 3);
  // A point counts as covered when most of its main words appear in the draft.
  const covered = (s: string) => {
    const w = [...new Set(words(s))];
    return w.length ? w.filter((x) => lower.includes(x)).length / w.length >= 0.6 : false;
  };
  const items = [
    ...brief.analysis.mustCover.map((label) => ({ label, kind: "Cover", done: covered(label) })),
    ...brief.brief.questions.map((label) => {
      const want = new Set(words(label));
      const under = sections.find((x) => {
        const w = words(x.heading);
        return w.length > 0 && w.filter((y) => want.has(y)).length / Math.max(want.size, 1) >= 0.6;
      });
      return { label, kind: "Answer", done: covered(label) || Boolean(under && under.words >= 15) };
    }),
    ...brief.brief.terms.map((label) => ({ label, kind: "Term", done: lower.includes(label.toLowerCase()) })),
    ...brief.brief.internalLinks.map((l) => ({ label: `Link "${l.anchor}"`, kind: "Link", done: html.includes(l.url) })),
  ];
  const done = items.filter((i) => i.done).length;
  return { items, score: items.length ? Math.round((done / items.length) * 100) : 0 };
}
