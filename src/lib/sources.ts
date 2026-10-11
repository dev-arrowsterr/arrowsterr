// Sources (cited links) shared by the server and the browser.

export type Source = { url: string; title: string | null; domain: string };

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Hosts that serve pictures or files, not pages. ChatGPT links the images it shows in an answer
// through images.openai.com, so those show up as "sources" though nobody reads them.
const NOT_PAGES = /(^|\.)(images\.openai\.com|oaiusercontent\.com|encrypted-tbn\d*\.gstatic\.com|gstatic\.com|googleusercontent\.com|ytimg\.com|twimg\.com|fbcdn\.net|cdninstagram\.com|imgur\.com|cloudfront\.net|wp\.com|staticflickr\.com)$/;
const FILE = /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp|mp4|webm)(\?|#|$)/i;

/** True for real pages a reader could open. False for image hosts and image files. */
export function isPage(s: { url: string; domain?: string }): boolean {
  const domain = s.domain || domainOf(s.url);
  if (NOT_PAGES.test(domain)) return false;
  try {
    return !FILE.test(new URL(s.url).pathname);
  } catch {
    return false;
  }
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

/** Drop tracking params, bad links and repeats. Fill in each domain. */
export function cleanSources(list: Source[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of list) {
    let url: string;
    try {
      const u = new URL(s.url);
      for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
      url = u.toString();
    } catch {
      continue;
    }
    const domain = s.domain || domainOf(url);
    if (!domain || seen.has(url) || !isPage({ url, domain })) continue;
    seen.add(url);
    out.push({ url, title: s.title, domain });
  }
  return out.slice(0, 30);
}
