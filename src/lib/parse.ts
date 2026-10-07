// Reads the shared answer layout. No network calls, so it runs anywhere and is easy to test.

const ITEM = /^\s*(?:#+\s*)?(\d{1,2})[.)]\s+(.*)$/;

/** The ranked list from an answer: ["HubSpot", "Salesforce", ...] in order. */
export function parseRanking(md: string): string[] {
  // Read only the Recommendations section when it is there.
  let section = md;
  const head = /^#+\s*recommendations.*$/im.exec(md);
  if (head) {
    const body = md.slice(head.index + head[0].length);
    const next = body.search(/^#+\s/m);
    section = next >= 0 ? body.slice(0, next) : body;
  }

  const names: string[] = [];
  for (const line of section.split(/\r?\n/)) {
    const m = ITEM.exec(line);
    if (!m) continue;
    const rest = m[2].replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    const bold = /\*\*(.+?)\*\*/.exec(rest);
    const name = (bold ? bold[1] : rest.split(/\s[-–—:]\s|:/)[0])
      .replace(/[[\]*`#]/g, "")
      .replace(/^[\s:\-–—]+|[\s:\-–—.]+$/g, "")
      .trim();
    if (name && !names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name.slice(0, 80));
  }
  return names.slice(0, 15);
}

/** Words that count as the tracked brand: its name, domain, and domain root ("momos" for momos.com). */
export function brandTerms(name: string, domain: string): string[] {
  const root = domain.split(".")[0] ?? "";
  return [...new Set([name.toLowerCase().trim(), domain.toLowerCase(), root.toLowerCase()])].filter((t) => t.length >= 3);
}

export function isTracked(candidate: string, terms: string[]) {
  const c = candidate.toLowerCase();
  return terms.some((t) => c.includes(t));
}
