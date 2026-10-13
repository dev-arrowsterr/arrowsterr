// Guess what someone means from the address they type: a whole domain, a subdomain, a folder or one page.

export type TargetScope = "domain" | "subdomain" | "subfolder" | "url";

// Country endings with two parts, so blog.acme.co.uk is a subdomain and acme.co.uk is a domain.
const TWO_PART = /\.(co|com|org|net|ac|gov|edu)\.[a-z]{2}$/;
// Paths that are usually a section of a site, not one page.
const FOLDERS = new Set([
  "blog",
  "blogs",
  "resources",
  "guides",
  "guide",
  "learn",
  "help",
  "docs",
  "news",
  "articles",
  "insights",
  "academy",
  "library",
  "hub",
  "knowledge",
  "support",
  "posts",
  "stories",
  "case-studies",
  "customers",
  "glossary",
  "templates",
  "tools",
  "podcast",
  "events",
  "webinars",
  "products",
  "collections",
  "shop",
  "store",
  "category",
  "categories",
  "tag",
  "tags",
  "topics",
]);

export function scopeOf(input: string): TargetScope | null {
  const raw = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "");
  if (!raw || !/^[a-z0-9-]+(\.[a-z0-9-]+)+/.test(raw)) return null;
  const cut = raw.search(/[/?#]/);
  const host = (cut === -1 ? raw : raw.slice(0, cut)).replace(/:\d+$/, "");
  const rest = cut === -1 ? "" : raw.slice(cut);
  const path = rest.replace(/[?#].*$/, "");
  if (/[?#]/.test(rest)) return "url";

  const parts = path.split("/").filter(Boolean);
  if (parts.length) {
    const last = parts[parts.length - 1];
    if (/\.[a-z0-9]{2,5}$/.test(last)) return "url";
    // A trailing slash, or one known section like /blog, is a folder. A deeper path is one page.
    if (path.endsWith("/") && parts.length <= 2) return "subfolder";
    if (parts.length === 1 && FOLDERS.has(last)) return "subfolder";
    if (
      parts.length === 2 &&
      /^[a-z]{2}(-[a-z]{2})?$/.test(parts[0]) &&
      FOLDERS.has(last)
    )
      return "subfolder";
    if (parts.length === 1 && /^[a-z]{2}(-[a-z]{2})?$/.test(last))
      return "subfolder";
    return "url";
  }

  const bare = host.replace(/^www\./, "");
  const labels = bare.split(".");
  const base = TWO_PART.test(bare) ? 3 : 2;
  return labels.length > base ? "subdomain" : "domain";
}
