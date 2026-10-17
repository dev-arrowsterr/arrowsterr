// Interactive modules in a draft's HTML: the one contract between the writer (which makes them), the editor
// (which shows them in a sandbox) and publishing (wpConvert.ts, which turns them into WordPress blocks).
// Pure and browser-safe.
//
// ─────────────── The contract ───────────────
//
//   <div data-aw-module="ID" data-aw-title="TITLE" data-aw-src="BASE64" data-aw-height="PX"></div>
//
//   data-aw-module  required. The module's id: 1 to 64 of A-Z a-z 0-9 _ -. Unique within the draft and stable
//                   across edits, so publishing again replaces the same module on the site.
//   data-aw-src     required. The module's full HTML (one self-contained file: inline CSS and JS, no outside
//                   scripts), UTF-8, then standard base64 (moduleBlock() builds it).
//   data-aw-title   optional. A short name, HTML-escaped. Used as the iframe's title.
//   data-aw-height  optional. Height in px for places that can't measure the module (the fallback iframe). Default 600.
//   The div is empty: anything inside it is ignored.
//
// The editor's older embed (writerNodes.ts: <div data-embed="encodeURIComponent(html)"></div>) is read too; its id
// is a hash of its HTML.
//
// A module always runs in a sandboxed iframe (sandbox="allow-scripts", no same-origin), never inline on the page.
// It may report its height with parent.postMessage({ awh: <px> }, "*") — the same message the editor listens for.

export type AwModule = { id: string; title: string; html: string; height: number };

export const MODULE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const DEFAULT_HEIGHT = 600;
export const MAX_MODULE_BYTES = 500_000;

/** UTF-8 text to base64, in the browser and on the server. */
export function toBase64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** base64 back to UTF-8 text. Null when it isn't base64. */
export function fromBase64(b64: string): string | null {
  try {
    const bin = atob(b64.replace(/\s+/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Escape text for an HTML attribute value in double quotes (also safe as text). */
export const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A short stable id from some text (FNV-1a), for modules that came without one. */
export function hashId(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return `m${h.toString(36)}`;
}

/** The markup for one module, as the contract above. */
export function moduleBlock(m: { id: string; html: string; title?: string; height?: number }) {
  if (!MODULE_ID.test(m.id)) throw new Error("A module id is 1 to 64 letters, digits, - or _.");
  const h = m.height && m.height > 0 ? ` data-aw-height="${Math.round(m.height)}"` : "";
  return `<div data-aw-module="${m.id}" data-aw-title="${escAttr(m.title ?? "")}" data-aw-src="${toBase64(m.html)}"${h}></div>`;
}

/** Over the size the plugin stores (in UTF-8 bytes). A module is never cut short: it is dropped instead. */
const tooBig = (html: string) => new TextEncoder().encode(html).length > MAX_MODULE_BYTES;

/** Read a module from an element's attributes (contract or the older embed). Null when it isn't one or is broken. */
export function readModule(attr: (name: string) => string | null): AwModule | null {
  const id = attr("data-aw-module");
  if (id !== null) {
    const html = fromBase64(attr("data-aw-src") ?? "");
    if (!MODULE_ID.test(id) || !html) return null;
    const height = Number(attr("data-aw-height"));
    if (tooBig(html)) return null;
    return { id, title: (attr("data-aw-title") ?? "").slice(0, 200), html, height: height > 0 && height < 5000 ? Math.round(height) : DEFAULT_HEIGHT };
  }
  const embed = attr("data-embed");
  if (embed !== null) {
    let html = "";
    try {
      html = decodeURIComponent(embed);
    } catch {
      return null;
    }
    if (!html.trim() || tooBig(html)) return null;
    return { id: hashId(html), title: "Interactive element", html, height: DEFAULT_HEIGHT };
  }
  return null;
}

/** The page a module runs in: its HTML plus a small script that reports its height to the parent. */
export function moduleDocument(html: string) {
  const fit = `<script>(function(){function s(){parent.postMessage({awh:document.documentElement.scrollHeight},"*")}new ResizeObserver(s).observe(document.documentElement);addEventListener("load",s)})()</script>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${fit}</body>`) : `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0">${html}${fit}</body>`;
}
