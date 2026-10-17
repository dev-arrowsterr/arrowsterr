// Interactive modules (docs/content-v2.md, "Interactive modules"): one self-contained HTML block per module,
// with inline CSS and JS, no outside scripts and no network. In Arrowsterr it runs in a sandboxed iframe
// (sandbox="allow-scripts", srcdoc), so it has no cookies, storage or pop-ups either.
// Pure, so tests can cover the checks.
import { Script } from "node:vm";
import type { BrandKit } from "./brandKit.ts";
import { MODULE_LABEL, type PlannedModule } from "./writerBrief.ts";

export const MAX_MODULE_BYTES = 60_000;

export type Validation = { ok: true } | { ok: false; error: string };

// What a module may never do. Each rule names what the module did, for the retry prompt and the logs.
// Markup rules read the whole block; code rules read its scripts and inline handlers, so prose like
// "import your data" in the text is fine.
const HTML_BANNED: [RegExp, string][] = [
  [/<script\b[^>]*\bsrc\s*=/i, "It loads an outside script (<script src>)."],
  [/<(link|iframe|frame|object|embed|base|meta|form)\b/i, "It uses a tag that loads or sends something (<link>, <iframe>, <object>, <embed>, <base>, <meta> or <form>)."],
  [/@import\b/i, "Its CSS loads an outside file (@import)."],
  [/url\(\s*['"]?\s*(https?:)?\/\//i, "Its CSS loads an outside file (url())."],
  [/\b(src|href|action|poster|srcset|data)\s*=\s*['"]?\s*(https?:)?\/\//i, "It loads an outside file."],
  [/<\/?(html|head|body)\b/i, "It is a whole page, not a block."],
];
const JS_BANNED: [RegExp, string][] = [
  [/\bfetch\s*\(/, "It calls the network (fetch)."],
  [/\bXMLHttpRequest\b/, "It calls the network (XMLHttpRequest)."],
  [/\bimport\s*\(/, "It loads code (import())."],
  [/(^|[;\s])import\s+[\w{*'"]/m, "It loads code (import)."],
  [/\b(WebSocket|EventSource|RTCPeerConnection)\b/, "It opens a network connection."],
  [/\bsendBeacon\b/, "It calls the network (sendBeacon)."],
  [/\bimportScripts\b|\bnew\s+(Shared)?Worker\b/, "It starts a worker."],
  [/\b(localStorage|sessionStorage|indexedDB)\b|document\.cookie/, "It uses storage, which the sandbox blocks."],
  [/(^|[^.\w])(alert|confirm|prompt)\s*\(|window\.(alert|confirm|prompt)\b/, "It opens a browser pop-up, which the sandbox blocks."],
  [/\bwindow\.open\b|\blocation\s*=[^=]|\blocation\.(href\s*=[^=]|assign|replace)/, "It navigates away."],
  [/\beval\s*\(|\bnew\s+Function\s*\(|\bset(Timeout|Interval)\s*\(\s*['"`]/, "It runs code from text (eval)."],
  [/\b(src|href)\s*=\s*['"`]\s*(https?:)?\/\//, "It loads an outside file."],
];

const scripts = (html: string) => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].map((m) => ({ attrs: m[1], code: m[2] }));

/**
 * Whether a module may go in the article: it parses, it has no outside scripts or network calls, and it has
 * something to interact with. Scripts are compiled, never run.
 */
export function validateModule(html: string): Validation {
  const h = (html ?? "").trim();
  if (!h) return { ok: false, error: "It is empty." };
  if (new TextEncoder().encode(h).length > MAX_MODULE_BYTES) return { ok: false, error: `It is over ${MAX_MODULE_BYTES / 1000} KB.` };
  for (const [re, error] of HTML_BANNED) if (re.test(h)) return { ok: false, error };
  const opens = (tag: string) => (h.match(new RegExp(`<${tag}\\b`, "gi")) ?? []).length;
  const closes = (tag: string) => (h.match(new RegExp(`</${tag}\\s*>`, "gi")) ?? []).length;
  for (const tag of ["script", "style"]) if (opens(tag) !== closes(tag)) return { ok: false, error: `A <${tag}> tag is not closed.` };
  const all = scripts(h);
  const handlers = [...h.matchAll(/\son[a-z]+\s*=\s*("([^"]*)"|'([^']*)')/gi)].map((m) => m[2] ?? m[3] ?? "");
  const code = [...all.map((s) => s.code), ...handlers].join("\n");
  for (const [re, error] of JS_BANNED) if (re.test(code)) return { ok: false, error };
  for (const s of all) {
    if (/\btype\s*=\s*['"]?module/i.test(s.attrs)) return { ok: false, error: "It uses a module script." };
    try {
      new Script(s.code, { filename: "module.js" }); // compile only: a syntax error fails here
    } catch (e) {
      return { ok: false, error: `Its script doesn't parse: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  if (!all.length && !/<details\b/i.test(h)) return { ok: false, error: "It has no script, so nothing on it reacts." };
  if (!/<(input|button|select|textarea|details|summary)\b|tabindex\s*=|role\s*=\s*['"]?(tab|button|slider|checkbox|radio)/i.test(h)) return { ok: false, error: "It has nothing to click or type in." };
  return { ok: true };
}

const FALLBACK = { primary: "#0943B0", secondary: "#111111", ink: "#111111", text: "#2B3242", muted: "#5C6B89", paper: "#FFFFFF", surface: "#F6F7F9", line: "#E3E6EB" };

/** The brand's colors and fonts as CSS variables every module uses. */
export function moduleTheme(kit: BrandKit | null): string {
  const c = kit?.colors ?? FALLBACK;
  const font = (f: string | undefined) => `${f ? `"${f}", ` : ""}system-ui, -apple-system, "Segoe UI", sans-serif`;
  const vars = {
    "--aw-primary": c.primary,
    "--aw-secondary": c.secondary,
    "--aw-ink": c.ink,
    "--aw-text": c.text,
    "--aw-muted": c.muted,
    "--aw-paper": c.paper,
    "--aw-surface": c.surface,
    "--aw-line": c.line,
    "--aw-radius": `${Math.min(12, kit?.radius ?? 6)}px`,
    "--aw-font-heading": font(kit?.fonts.heading),
    "--aw-font-body": font(kit?.fonts.body),
  };
  return `:root{${Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";")}}`;
}

/** The block saved in the article: the brand's variables, then the module. */
export const wrapModule = (html: string, m: Pick<PlannedModule, "type" | "title">, kit: BrandKit | null) =>
  `<div class="aw-module" data-module="${m.type}" aria-label="${m.title.replace(/[<>"&]/g, "")}"><style>${moduleTheme(kit)}</style>${html.trim()}</div>`;

export const MODULE_SCHEMA = { type: "object", additionalProperties: false, required: ["html"], properties: { html: { type: "string" } } };

/** The instructions for building one module, after the cached brand and research. */
export function modulePrompt(m: PlannedModule, ctx: { keyword: string; brand: string; section: string }, lastError?: string | null): string {
  return `Build one interactive module for ${ctx.brand}'s article on "${ctx.keyword}". It goes right after the section "${m.placement}".

Module: ${MODULE_LABEL[m.type]}: ${m.title}
Purpose: ${m.purpose}
Inputs: ${m.inputs.join("; ") || "none"}
Outputs: ${m.outputs.join("; ") || "none"}
Data: ${m.data || "from the sources"}
Why it helps: ${m.why}

The section it follows:
${ctx.section.slice(0, 4000)}
${lastError ? `\nThe last version was refused: ${lastError} Fix that.\n` : ""}
Rules:
- Reply with html: one HTML block (no <html>, <head> or <body>): one <style>, the markup, one inline <script>.
- No outside files of any kind: no <script src>, <link>, <iframe>, images or fonts from the web, @import or url(http...).
- No network: no fetch, XMLHttpRequest, WebSocket, import(). No localStorage, cookies, alert, confirm, prompt or eval. It runs in a sandbox that blocks them.
- Style it with these CSS variables, already set: --aw-primary, --aw-secondary, --aw-ink, --aw-text, --aw-muted, --aw-paper, --aw-surface, --aw-line, --aw-radius, --aw-font-heading, --aw-font-body. Flat: no shadows, no gradients, no emoji.
- Prefix every class and id with "awm-" and wrap everything in one root element, so it can't clash with the page.
- Accessible: every input has a <label>, buttons are <button>, results sit in an aria-live="polite" region, colors keep 4.5:1 contrast, focus is visible.
- Keyboard usable: everything works with Tab, Enter, Space and the arrow keys where they fit.
- Mobile first: works at 320px wide, no horizontal scroll, touch targets at least 40px.
- It works on load with sensible defaults, and changing any input changes the output at once.
- Every number, row or step comes from the sources or the article. Name the source in a small line under it.
- Under 40 KB. Plain modern JavaScript, no libraries.`;
}
