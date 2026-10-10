import { mergeAttributes, Node } from "@tiptap/react";

/** An old-style note to the writer. Kept so older drafts still open; never shown in the draft. */
export const Note = Node.create({
  name: "note",
  group: "block",
  content: "inline*",
  defining: true,
  parseHTML: () => [{ tag: "aside[data-note]" }],
  renderHTML: ({ HTMLAttributes }) => ["aside", mergeAttributes(HTMLAttributes, { "data-note": "", class: "aw-note" }), 0],
});

/** An interactive element an agent coded: HTML, CSS and JavaScript, run in a sandbox in the editor and exported as is. */
export const Embed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({ html: { default: "" } }),
  parseHTML: () => [{ tag: "div[data-embed]", getAttrs: (el) => ({ html: decodeURIComponent((el as HTMLElement).getAttribute("data-embed") ?? "") }) }],
  renderHTML: ({ node }) => ["div", { "data-embed": encodeURIComponent(String(node.attrs.html ?? "")) }],
  addNodeView:
    () =>
    ({ node }) => {
      const dom = document.createElement("div");
      dom.className = "aw-embed";
      dom.contentEditable = "false";
      const tag = document.createElement("span");
      tag.className = "aw-embed__tag";
      tag.textContent = "Interactive element";
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("title", "Interactive element");
      frame.srcdoc = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;font-family:system-ui,sans-serif">${node.attrs.html}<script>new ResizeObserver(()=>parent.postMessage({awh:document.documentElement.scrollHeight},"*")).observe(document.body)</script></body>`;
      const fit = (e: MessageEvent) => {
        if (e.source === frame.contentWindow && typeof e.data?.awh === "number") frame.style.height = `${Math.min(1400, e.data.awh + 4)}px`;
      };
      window.addEventListener("message", fit);
      dom.append(tag, frame);
      return { dom, destroy: () => window.removeEventListener("message", fit) };
    },
});

/** The draft as clean HTML: no notes, and interactive elements as their own code. */
export const exportClean = (html: string) =>
  html.replace(/<aside data-note[^>]*>[\s\S]*?<\/aside>/g, "").replace(/<div data-embed="([^"]*)"><\/div>/g, (_, x: string) => decodeURIComponent(x));
