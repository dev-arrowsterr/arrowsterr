// Sources (cited links) shared by the server and the browser.

export type Source = { url: string; title: string | null; domain: string };

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Hosts that serve pictures, files or tool internals, not pages. ChatGPT links the images it shows in
// an answer through images.openai.com, and the answer scraper serves its own copies from dataforseo.com.
const NOT_PAGES =
  /(^|\.)(images\.openai\.com|oaiusercontent\.com|encrypted-tbn\d*\.gstatic\.com|gstatic\.com|googleusercontent\.com|ytimg\.com|twimg\.com|fbcdn\.net|cdninstagram\.com|imgur\.com|cloudfront\.net|wp\.com|staticflickr\.com|dataforseo\.com|bing\.net|googleapis\.com|googlesyndication\.com|doubleclick\.net|localhost)$/;
const FILE = /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp|mp4|webm|css|js|json|xml|woff2?)(\?|#|$)/i;
// Paths that are assets or internals on any host: /cdn/, image resizers, ids with a ":n" tail.
const ASSET_PATH = /^\/(cdn|cdn-cgi|_next|static\/media|wp-content\/uploads|i)\/|:\d+$/i;
// Redirect links that wrap the real page in a parameter.
const WRAPPERS: [RegExp, string][] = [
  [/(^|\.)google\.[a-z.]+$/, "q"],
  [/(^|\.)google\.[a-z.]+$/, "url"],
  [/(^|\.)duckduckgo\.com$/, "uddg"],
  [/(^|\.)facebook\.com$/, "u"],
  [/(^|\.)linkedin\.com$/, "url"],
];
// Gemini's grounding links hide the page behind a redirect; its title is the site's domain.
const GROUNDING = /(^|\.)vertexaisearch\.cloud\.google\.com$/;
// Tracking added to links, which makes the same page look like many.
const TRACKING = /^(utm_|fbclid$|gclid$|msclkid$|srsltid$|mc_[a-z]+$|ref$|ref_src$|igshid$|_hs[a-z]+$)/i;

/** True for real pages a reader could open. False for image hosts, files and asset links. */
export function isPage(s: { url: string; domain?: string }): boolean {
  const domain = s.domain || domainOf(s.url);
  if (!domain || NOT_PAGES.test(domain) || !/\.[a-z]{2,}$/i.test(domain)) return false;
  try {
    const path = new URL(s.url).pathname;
    return !FILE.test(path) && !ASSET_PATH.test(path);
  } catch {
    return false;
  }
}

/** The page a redirect link points to, or the link itself. */
function unwrap(url: URL): URL {
  const host = url.hostname.toLowerCase();
  for (const [re, key] of WRAPPERS) {
    const inner = re.test(host) && url.pathname.length > 1 ? url.searchParams.get(key) : null;
    if (inner && /^https?:\/\//i.test(inner)) {
      try {
        return new URL(inner);
      } catch {}
    }
  }
  return url;
}
const MD_LINK = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const BARE_URL = /(?<!\]\()https?:\/\/[^\s)<>\]"']+/g;

/** Links written in the answer text, as markdown links or bare URLs. */
export function linksInText(text: string): Source[] {
  const out: Source[] = [];
  for (const m of text.matchAll(MD_LINK)) out.push({ url: m[2], title: m[1] || null, domain: "" });
  for (const m of text.matchAll(BARE_URL)) out.push({ url: m[0].replace(/[.,;:]+$/, ""), title: null, domain: "" });
  return out;
}

/** Unwrap redirects, drop tracking params, asset links and repeats. Fill in each domain. */
export function cleanSources(list: Source[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of list) {
    let url: string;
    let domain: string;
    try {
      const u = unwrap(new URL(s.url));
      for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
      u.hash = "";
      url = u.toString().replace(/\/$/, "");
      domain = domainOf(url);
      // A Gemini grounding link: keep it, under the site its title names.
      if (GROUNDING.test(domain)) {
        const named = (s.title ?? "").trim().toLowerCase().replace(/^www\./, "");
        if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(named)) continue;
        domain = named;
      }
    } catch {
      continue;
    }
    // One entry per page: the same page with and without "www" or a slash counts once.
    const key = url.replace(/^https?:\/\/(www\.)?/i, "").toLowerCase();
    if (seen.has(key) || !isPage({ url, domain: GROUNDING.test(domainOf(url)) ? domain : undefined })) continue;
    seen.add(key);
    out.push({ url, title: s.title, domain });
  }
  return out.slice(0, 30);
}
