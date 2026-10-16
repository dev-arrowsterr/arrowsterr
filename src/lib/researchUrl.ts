// Research searches live in the address bar, the way Semrush does it:
//   /keywords?q=restaurant+management&db=us   /keywords?mode=bulk&bulk=k7f2a9x1
//   /domain-research?q=momos.com/blog&scope=subfolder&db=us
// So a search can be shared, bookmarked, opened in a new tab, and Back steps through searches.

const CODES: Record<string, string> = {
  "United States": "us",
  "United Kingdom": "uk",
  Canada: "ca",
  Australia: "au",
  Germany: "de",
  France: "fr",
  Spain: "es",
  Netherlands: "nl",
  India: "in",
  Singapore: "sg",
  Vietnam: "vn",
  Japan: "jp",
  Brazil: "br",
  Mexico: "mx",
  Global: "global",
};
const OURS = ["q", "db", "scope", "view", "match", "mode", "bulk", "report"];

/** The short country code in a link, like us or uk. */
export const dbOf = (country: string) => CODES[country] ?? "us";
/** The country a link's db code stands for, or null when there is none. */
export const countryOf = (db: string | null) => (db ? (Object.keys(CODES).find((c) => CODES[c] === db.toLowerCase()) ?? null) : null);

export const urlParams = () => new URLSearchParams(window.location.search);

/** The address's query without any research search, for moving to another page. */
export function withoutResearch(search: string) {
  const p = new URLSearchParams(search);
  for (const k of OURS) p.delete(k);
  return p.size ? `?${p}` : "";
}

/**
 * Put a search in the address bar. push adds a Back step; otherwise the current entry is replaced.
 * Does nothing when the address would not change. tag marks the entry (see history.state.aw).
 */
export function setUrl(next: Record<string, string | null | undefined>, push: boolean, tag = "search") {
  const p = new URLSearchParams(withoutResearch(window.location.search));
  for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
  const url = window.location.pathname + (p.size ? `?${p}` : "");
  if (url === window.location.pathname + window.location.search) return;
  window.history[push ? "pushState" : "replaceState"]({ aw: tag }, "", url);
}

/** The link to a keyword in Keyword Research. */
export const keywordHref = (q: string, country?: string) => `/keywords?${new URLSearchParams({ q, ...(country ? { db: dbOf(country) } : {}) })}`;
/** The link to a site or page in Domain Research. */
export const domainHref = (q: string, scope: string, country?: string) =>
  `/domain-research?${new URLSearchParams({ q, ...(scope !== "domain" ? { scope } : {}), ...(country ? { db: dbOf(country) } : {}) })}`;
/** A plain left click, with no key held to open a new tab or window. */
export const plainClick = (e: React.MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
