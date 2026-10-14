import type { CmsKind } from "./cmsTypes.ts";

// ─────────────── HTML edits ───────────────
// Small, targeted string edits, so block markup (WordPress) and cards (Ghost) stay as they were.

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");

/** Images in the HTML with no alt text, or an empty one, by src. */
export function imagesWithoutAlt(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = tag.match(/\ssrc=["']([^"']+)["']/i)?.[1];
    const alt = tag.match(/\salt=["']([^"']*)["']/i);
    if (src && (!alt || !alt[1].trim())) out.push(decode(src));
  }
  return [...new Set(out)];
}

/** Set alt text on every image with this src that has none. */
export function setAlts(html: string, alts: { src: string; alt: string }[]): { html: string; done: number } {
  let done = 0;
  const out = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = decode(tag.match(/\ssrc=["']([^"']+)["']/i)?.[1] ?? "");
    const hit = alts.find((a) => a.src === src);
    if (!hit) return tag;
    const alt = tag.match(/\salt=["']([^"']*)["']/i);
    if (alt && alt[1].trim()) return tag;
    done++;
    return alt ? tag.replace(alt[0], ` alt="${attr(hit.alt)}"`) : tag.replace(/<img\b/i, `<img alt="${attr(hit.alt)}"`);
  });
  return { html: out, done };
}

/** Plain text of the HTML, for prompts. */
export const textOf = (html: string) => decode(html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Turn the first plain-text mention of `anchor` into a link, outside headings, links, code and buttons. */
export function addLink(html: string, anchor: string, url: string): { html: string; ok: boolean } {
  const parts = html.split(/(<[^>]+>)/);
  let blocked = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith("<")) {
      const m = p.match(/^<(\/?)(a|h[1-6]|code|pre|button|figcaption|script|style)\b/i);
      if (m) blocked += m[1] ? -1 : p.endsWith("/>") ? 0 : 1;
      continue;
    }
    if (blocked > 0) continue;
    const at = p.indexOf(anchor);
    if (at < 0) continue;
    parts[i] = `${p.slice(0, at)}<a href="${attr(url)}">${anchor}</a>${p.slice(at + anchor.length)}`;
    return { html: parts.join(""), ok: true };
  }
  return { html, ok: false };
}

/** Links already in the HTML, so we never add the same one twice. */
export const linksIn = (html: string) => [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map((m) => decode(m[1]).replace(/\/$/, ""));

/** Questions already answered on the page: headings that end in a question mark, with the text under them. */
export function faqsIn(html: string): { q: string; a: string }[] {
  const out: { q: string; a: string }[] = [];
  const re = /<h([2-4])[^>]*>([\s\S]*?)<\/h\1>([\s\S]*?)(?=<h[1-4][^>]*>|$)/gi;
  for (const m of html.matchAll(re)) {
    const q = textOf(m[2]);
    const a = textOf(m[3]);
    if (q.endsWith("?") && a.length > 20) out.push({ q, a: a.slice(0, 900) });
  }
  return out.slice(0, 20);
}

/** An FAQ section to add at the end of a page. WordPress gets it as blocks so the editor keeps it tidy. */
export function faqHtml(kind: CmsKind, items: { q: string; a: string }[]): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (kind === "wordpress") {
    return [
      "",
      '<!-- wp:heading -->\n<h2 class="wp-block-heading">Frequently asked questions</h2>\n<!-- /wp:heading -->',
      ...items.map((i) => `<!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading">${esc(i.q)}</h3>\n<!-- /wp:heading -->\n\n<!-- wp:paragraph -->\n<p>${esc(i.a)}</p>\n<!-- /wp:paragraph -->`),
    ].join("\n\n");
  }
  return `\n<h2>Frequently asked questions</h2>\n${items.map((i) => `<h3>${esc(i.q)}</h3>\n<p>${esc(i.a)}</p>`).join("\n")}`;
}
