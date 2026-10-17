// A draft's HTML to WordPress block markup (Gutenberg), so the post opens in the block editor as headings,
// paragraphs, lists, tables and images people can edit, not one classic block.
// Pure: no network. Images are uploaded by the caller first (collectImages → media map), then passed in.
//
// ─────────────── Input contract ───────────────
// The HTML the editor exports (exportClean in writerNodes.ts, or docHtml.ts on the server): h1–h6, p, ul/ol/li
// (li may wrap its text in <p>), table (th in a first row becomes the header), img or figure>img+figcaption,
// blockquote, pre>code, hr, and inline a/strong/em/code/br/s/u/sub/sup/mark.
// Interactive modules use the contract in wpModules.ts, exactly:
//   <div data-aw-module="ID" data-aw-title="TITLE" data-aw-src="BASE64-UTF8-HTML" data-aw-height="PX"></div>
// (the older <div data-embed="encodeURIComponent(html)"></div> is read too).
// Notes (<aside data-note>) are dropped. Anything else becomes a Custom HTML block as is.
//
// ─────────────── Modules on WordPress ───────────────
// With the Arrowsterr Connector plugin (1.1.0+): a Shortcode block [arrowsterr_module id="ID"]; the module's HTML is
// uploaded to the post's meta (arrowsterr/v1/posts/<id>/modules) and the plugin renders it in a sandboxed iframe
// that sizes itself. Without the plugin: a Custom HTML block with <iframe sandbox="allow-scripts" srcdoc="…">,
// the HTML escaped into the attribute, at a fixed height.
import { parseHTML } from "linkedom";
import { escAttr, moduleDocument, readModule, type AwModule } from "./wpModules.ts";

export type Media = Record<string, { id: number; url: string }>;
export type Converted = { content: string; modules: AwModule[] };

type El = { tagName: string; nodeType: number; textContent: string | null; outerHTML: string; innerHTML: string; childNodes: ArrayLike<Node>; children: ArrayLike<El>; getAttribute(n: string): string | null; setAttribute(n: string, v: string): void; removeAttribute(n: string): void; attributes: ArrayLike<{ name: string; value: string }>; querySelectorAll(s: string): ArrayLike<El>; querySelector(s: string): El | null; parentNode: El | null };
type Node = { nodeType: number; textContent: string | null };

const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "TABLE", "FIGURE", "BLOCKQUOTE", "PRE", "HR", "DIV", "SECTION", "ARTICLE", "ASIDE", "IMG", "SCRIPT", "STYLE", "IFRAME", "HEADER", "FOOTER", "NAV", "FORM"]);
const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const block = (name: string, inner: string, attrs?: Record<string, unknown>) => `<!-- wp:${name}${attrs && Object.keys(attrs).length ? ` ${JSON.stringify(attrs)}` : ""} -->\n${inner}\n<!-- /wp:${name} -->`;

function parse(html: string) {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  return document.body as unknown as El;
}

/** Remove event handlers and script links from the draft's own markup. Modules keep their scripts in their sandbox. */
function scrub(root: El) {
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    for (const a of Array.from(el.attributes ?? [])) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on") || ((n === "href" || n === "src") && /^\s*(javascript|vbscript):/i.test(a.value))) el.removeAttribute(a.name);
    }
  }
}

/** Every image address in the draft, in order, once each: to upload before converting. */
export function collectImages(html: string): string[] {
  const out: string[] = [];
  for (const img of Array.from(parse(html).querySelectorAll("img"))) {
    const src = (img.getAttribute("src") ?? "").trim();
    if (src && !out.includes(src) && /^(https?:|data:image\/)/i.test(src)) out.push(src);
  }
  return out;
}

/** One module as a block: the plugin's shortcode, or an inline sandboxed iframe. */
export function moduleMarkup(m: AwModule, plugin: boolean) {
  if (plugin) return block("shortcode", `[arrowsterr_module id="${m.id}"]`);
  const frame = `<iframe title="${escAttr(m.title || "Interactive module")}" sandbox="allow-scripts" loading="lazy" style="width:100%;border:0;height:${m.height}px" srcdoc="${escAttr(moduleDocument(m.html))}"></iframe>`;
  return block("html", `<div class="arrowsterr-module">${frame}</div>`);
}

function imageBlock(img: El, media: Media, caption = "") {
  const src = (img.getAttribute("src") ?? "").trim();
  if (!src) return "";
  const m = media[src];
  const alt = img.getAttribute("alt") ?? "";
  const cap = caption ? `<figcaption class="wp-element-caption">${caption}</figcaption>` : "";
  if (m) return block("image", `<figure class="wp-block-image size-large"><img src="${escAttr(m.url)}" alt="${escAttr(alt)}" class="wp-image-${m.id}"/>${cap}</figure>`, { id: m.id, sizeSlug: "large", linkDestination: "none" });
  return block("image", `<figure class="wp-block-image"><img src="${escAttr(src)}" alt="${escAttr(alt)}"/>${cap}</figure>`);
}

/** The inline HTML of an element, with images swapped for their uploaded copies. */
function inline(el: El, media: Media) {
  for (const img of Array.from(el.querySelectorAll("img"))) {
    const m = media[(img.getAttribute("src") ?? "").trim()];
    if (m) {
      img.setAttribute("src", m.url);
      img.setAttribute("class", `wp-image-${m.id}`);
    }
  }
  return el.innerHTML.trim();
}

function list(el: El, media: Media): string {
  const ordered = el.tagName === "OL";
  const items = Array.from(el.children)
    .filter((li) => li.tagName === "LI")
    .map((li) => {
      const parts: string[] = [];
      const nested: string[] = [];
      for (const c of Array.from(li.childNodes) as unknown as El[]) {
        if (c.nodeType === 1 && (c.tagName === "UL" || c.tagName === "OL")) nested.push(list(c, media));
        else if (c.nodeType === 1 && c.tagName === "P") parts.push(inline(c, media));
        else if (c.nodeType === 1) parts.push(c.outerHTML);
        else if (c.nodeType === 3 && (c.textContent ?? "").trim()) parts.push(escText(c.textContent ?? ""));
      }
      const text = parts.filter(Boolean).join("<br>");
      return block("list-item", `<li>${text}${nested.length ? `\n${nested.join("\n")}\n` : ""}</li>`);
    });
  if (!items.length) return "";
  const tag = ordered ? "ol" : "ul";
  return block("list", `<${tag} class="wp-block-list">${items.join("")}</${tag}>`, ordered ? { ordered: true } : undefined);
}

function table(el: El, media: Media): string {
  const rows = Array.from(el.querySelectorAll("tr"));
  if (!rows.length) return "";
  const cells = (tr: El) =>
    Array.from(tr.children)
      .filter((c) => c.tagName === "TD" || c.tagName === "TH")
      .map((c) => {
        // TipTap wraps cell text in <p>: unwrap it so the cell holds text, as WordPress saves it.
        const ps = Array.from(c.children).filter((x) => x.tagName === "P");
        const html = ps.length && ps.length === c.children.length ? ps.map((p) => inline(p, media)).join("<br>") : inline(c, media);
        const span = ["colspan", "rowspan"].map((a) => (c.getAttribute(a) && c.getAttribute(a) !== "1" ? ` ${a}="${Number(c.getAttribute(a)) || 1}"` : "")).join("");
        return { th: c.tagName === "TH", html, span };
      });
  const first = cells(rows[0]);
  const headed = first.length > 0 && first.every((c) => c.th);
  const row = (cs: ReturnType<typeof cells>, tag?: "th") => `<tr>${cs.map((c) => `<${tag ?? (c.th ? "th" : "td")}${c.span}>${c.html}</${tag ?? (c.th ? "th" : "td")}>`).join("")}</tr>`;
  const head = headed ? `<thead>${row(first, "th")}</thead>` : "";
  const body = (headed ? rows.slice(1) : rows).map((r) => row(cells(r))).join("");
  const caption = el.querySelector("caption");
  return block("table", `<figure class="wp-block-table"><table class="has-fixed-layout">${head}<tbody>${body}</tbody></table>${caption ? `<figcaption class="wp-element-caption">${caption.innerHTML.trim()}</figcaption>` : ""}</figure>`);
}

function convert(nodes: El[], media: Media, plugin: boolean, modules: AwModule[], seen: Set<string>): string[] {
  const out: string[] = [];
  let loose: string[] = []; // inline nodes between blocks become one paragraph
  const flush = () => {
    const html = loose.join("").trim();
    if (html) out.push(block("paragraph", `<p>${html}</p>`));
    loose = [];
  };
  for (const n of nodes) {
    if (n.nodeType === 3) {
      if ((n.textContent ?? "").trim()) loose.push(escText(n.textContent ?? ""));
      continue;
    }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName;
    if (!BLOCK_TAGS.has(tag)) {
      loose.push(n.outerHTML);
      continue;
    }
    flush();
    const mod = tag === "DIV" ? readModule((a) => n.getAttribute(a)) : null;
    if (mod) {
      // The same id twice in one draft: the second gets its own id, so each renders.
      let id = mod.id;
      for (let i = 2; seen.has(id); i++) id = `${mod.id.slice(0, 60)}-${i}`;
      seen.add(id);
      const m = { ...mod, id };
      modules.push(m);
      out.push(moduleMarkup(m, plugin));
      continue;
    }
    if (tag === "DIV" && (n.getAttribute("data-aw-module") !== null || n.getAttribute("data-embed") !== null)) continue; // a broken module is dropped, never shown raw
    if (/^H[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const html = inline(n, media);
      if (html) out.push(block("heading", `<h${level} class="wp-block-heading">${html}</h${level}>`, level === 2 ? undefined : { level }));
    } else if (tag === "P") {
      const imgs = Array.from(n.querySelectorAll("img"));
      if (imgs.length === 1 && !norm(n.textContent)) out.push(imageBlock(imgs[0], media));
      else {
        const html = inline(n, media);
        if (html && html !== "<br>") out.push(block("paragraph", `<p>${html}</p>`));
      }
    } else if (tag === "UL" || tag === "OL") out.push(list(n, media));
    else if (tag === "TABLE") out.push(table(n, media));
    else if (tag === "IMG") out.push(imageBlock(n, media));
    else if (tag === "FIGURE") {
      const img = n.querySelector("img");
      const tbl = n.querySelector("table");
      if (tbl) out.push(table(tbl, media));
      else if (img) out.push(imageBlock(img, media, n.querySelector("figcaption")?.innerHTML.trim() ?? ""));
      else out.push(block("html", n.outerHTML));
    } else if (tag === "BLOCKQUOTE") {
      const inner = convert(Array.from(n.childNodes) as unknown as El[], media, plugin, modules, seen);
      out.push(block("quote", `<blockquote class="wp-block-quote">${inner.join("\n")}</blockquote>`));
    } else if (tag === "PRE") out.push(block("code", `<pre class="wp-block-code"><code>${escText(n.textContent ?? "")}</code></pre>`));
    else if (tag === "HR") out.push(block("separator", `<hr class="wp-block-separator has-alpha-channel-opacity"/>`));
    else if (tag === "ASIDE" && n.getAttribute("data-note") !== null) continue;
    else if ((tag === "DIV" || tag === "SECTION" || tag === "ARTICLE") && Array.from(n.children).some((c) => BLOCK_TAGS.has(c.tagName))) {
      out.push(...convert(Array.from(n.childNodes) as unknown as El[], media, plugin, modules, seen));
    } else if (tag === "STYLE") continue;
    else out.push(block("html", n.outerHTML));
  }
  flush();
  return out.filter(Boolean);
}

/**
 * The draft as WordPress block markup, and the modules in it.
 * title: a first h1 with the same text as the post title is dropped (WordPress shows the title already).
 */
export function htmlToBlocks(html: string, opts: { plugin: boolean; media?: Media; title?: string }): Converted {
  const body = parse(html);
  scrub(body);
  const nodes = Array.from(body.childNodes) as unknown as El[];
  const firstEl = nodes.find((n) => n.nodeType === 1 || (n.nodeType === 3 && (n.textContent ?? "").trim()));
  const start = firstEl && firstEl.nodeType === 1 && firstEl.tagName === "H1" && opts.title && norm(firstEl.textContent) === norm(opts.title) ? nodes.indexOf(firstEl) + 1 : 0;
  const modules: AwModule[] = [];
  const blocks = convert(nodes.slice(start), opts.media ?? {}, opts.plugin, modules, new Set());
  return { content: blocks.join("\n\n"), modules };
}
