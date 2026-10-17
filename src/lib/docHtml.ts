// A saved draft (docs.content, the editor's ProseMirror JSON) as HTML, on the server, for publishing without the
// editor open (the wp_publish job). Covers the editor's nodes; an unknown node keeps its children.
// Modules come out as the contract in wpModules.ts. Pure.
import { escAttr, hashId, MODULE_ID, moduleBlock } from "./wpModules.ts";

type Mark = { type: string; attrs?: Record<string, unknown> };
export type PmNode = { type: string; attrs?: Record<string, unknown>; content?: PmNode[]; text?: string; marks?: Mark[] };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const safeUrl = (u: unknown) => (typeof u === "string" && !/^\s*(javascript|vbscript|data):/i.test(u) ? u : "");

function text(n: PmNode) {
  let html = esc(n.text ?? "");
  for (const m of n.marks ?? []) {
    if (m.type === "bold") html = `<strong>${html}</strong>`;
    else if (m.type === "italic") html = `<em>${html}</em>`;
    else if (m.type === "strike") html = `<s>${html}</s>`;
    else if (m.type === "underline") html = `<u>${html}</u>`;
    else if (m.type === "code") html = `<code>${html}</code>`;
    else if (m.type === "link") {
      const href = safeUrl(m.attrs?.href);
      if (href) html = `<a href="${escAttr(href)}"${m.attrs?.target === "_blank" ? ' target="_blank" rel="noopener noreferrer"' : ""}>${html}</a>`;
    }
  }
  return html;
}

const kids = (n: PmNode) => (n.content ?? []).map(render).join("");

function render(n: PmNode): string {
  const a = n.attrs ?? {};
  switch (n.type) {
    case "doc":
      return kids(n);
    case "text":
      return text(n);
    case "paragraph":
      return `<p>${kids(n)}</p>`;
    case "heading": {
      const l = Math.min(6, Math.max(1, Number(a.level) || 2));
      return `<h${l}>${kids(n)}</h${l}>`;
    }
    case "bulletList":
      return `<ul>${kids(n)}</ul>`;
    case "orderedList":
      return `<ol>${kids(n)}</ol>`;
    case "listItem":
      return `<li>${kids(n)}</li>`;
    case "blockquote":
      return `<blockquote>${kids(n)}</blockquote>`;
    case "codeBlock":
      return `<pre><code>${esc((n.content ?? []).map((c) => c.text ?? "").join(""))}</code></pre>`;
    case "horizontalRule":
      return "<hr>";
    case "hardBreak":
      return "<br>";
    case "image": {
      const src = safeUrl(a.src);
      return src ? `<img src="${escAttr(src)}" alt="${escAttr(String(a.alt ?? ""))}">` : "";
    }
    case "table":
      return `<table><tbody>${kids(n)}</tbody></table>`;
    case "tableRow":
      return `<tr>${kids(n)}</tr>`;
    case "tableHeader":
    case "tableCell": {
      const tag = n.type === "tableHeader" ? "th" : "td";
      const span = ["colspan", "rowspan"].map((k) => (Number(a[k]) > 1 ? ` ${k}="${Number(a[k])}"` : "")).join("");
      return `<${tag}${span}>${kids(n)}</${tag}>`;
    }
    case "note":
      return "";
    case "embed": {
      const html = String(a.html ?? "");
      return html.trim() ? moduleBlock({ id: hashId(html), title: "Interactive element", html }) : "";
    }
    default: {
      // A module node (the writer's): attrs id + html (or src as base64) + title.
      const id = String(a.id ?? a.moduleId ?? "");
      const src = typeof a.src === "string" ? a.src : "";
      const html = typeof a.html === "string" ? a.html : "";
      if (/module/i.test(n.type) && MODULE_ID.test(id) && (html || src)) {
        if (html) return moduleBlock({ id, title: String(a.title ?? ""), html, height: Number(a.height) || undefined });
        return `<div data-aw-module="${id}" data-aw-title="${escAttr(String(a.title ?? ""))}" data-aw-src="${escAttr(src)}"${Number(a.height) > 0 ? ` data-aw-height="${Math.round(Number(a.height))}"` : ""}></div>`;
      }
      return kids(n);
    }
  }
}

/** The saved draft as HTML. */
export const docToHtml = (content: unknown) => (content && typeof content === "object" && (content as PmNode).type ? render(content as PmNode) : "");
