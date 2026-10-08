// The sentence in an answer that talks about a brand. Pure, so the browser and tests can use it.

const clean = (s: string) =>
  s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // markdown links
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#>]+/g, "")
    .replace(/^\s*(?:[-•]|\d+[.)])\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

/** The first sentence that names the brand, up to 280 characters. Null when no sentence names it. */
export function quoteOf(text: string, name: string): string | null {
  if (!text || !name) return null;
  const needle = name.toLowerCase();
  const parts = text.split(/\n+/).flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9*"])/));
  for (const p of parts) {
    const s = clean(p);
    if (s.length > 12 && s.toLowerCase().includes(needle)) return s.length > 280 ? `${s.slice(0, 277).trimEnd()}...` : s;
  }
  return null;
}
