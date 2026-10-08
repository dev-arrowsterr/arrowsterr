import "server-only";
import { gunzipSync } from "node:zlib";
import * as cheerio from "cheerio";
import type { SitePage } from "./research";
import { cleanUrl } from "./urls";

export { cleanUrl };

// Find every page on a website: robots.txt, the usual sitemap addresses, sitemap indexes,
// RSS feeds, and as a last resort the links on the homepage and blog pages. Then clean the list.

const UA = "Mozilla/5.0 (compatible; ArrowsterrBot/1.0; +https://arrowsterr.com)";
const MAX_PAGES = 3000;
const MAX_CHILD_SITEMAPS = 40;
const GUESSES = [
  "/sitemap.xml",
  "/sitemap_index.xml",
  "/wp-sitemap.xml",
  "/sitemap-index.xml",
  "/sitemap.xml.gz",
  "/post-sitemap.xml",
  "/page-sitemap.xml",
  "/blog/sitemap.xml",
  "/sitemap/sitemap.xml",
  "/sitemaps/sitemap.xml",
];
const FEEDS = ["/feed", "/rss.xml", "/blog/feed", "/blog/rss.xml", "/atom.xml", "/feed.xml", "/blog/atom.xml"];
const LISTINGS = ["/blog", "/articles", "/resources", "/news", "/insights", "/guides", "/learn"];
const ARTICLE_DIR = /\/(blog|articles?|posts?|guides?|resources|news|insights|learn|academy|knowledge|library|stories|journal|tutorials?|how-to)\//i;
async function get(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Gzipped sitemaps start with 1f 8b.
    const body = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf;
    return body.toString("utf8").slice(0, 20_000_000);
  } catch {
    return null;
  }
}

const locs = (xml: string) => [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));

/** Pages from one sitemap address, following sitemap indexes one level down. Article sitemaps come first. */
async function readSitemap(url: string): Promise<{ url: string; fromPosts: boolean }[] | null> {
  const xml = await get(url);
  if (!xml || !/<(urlset|sitemapindex)[\s>]/i.test(xml)) return null;
  if (/<sitemapindex[\s>]/i.test(xml)) {
    const posty = (u: string) => /post|blog|article|news|guide|resource/i.test(u);
    const children = locs(xml)
      .filter((u) => !/image|video|author|tag|category/i.test(u.split("/").pop() ?? ""))
      .sort((a, b) => Number(posty(b)) - Number(posty(a)))
      .slice(0, MAX_CHILD_SITEMAPS);
    const out: { url: string; fromPosts: boolean }[] = [];
    for (const child of children) {
      const body = await get(child);
      if (body) out.push(...locs(body).map((u) => ({ url: u, fromPosts: posty(child) })));
      if (out.length > MAX_PAGES * 2) break;
    }
    return out;
  }
  return locs(xml).map((u) => ({ url: u, fromPosts: /post|blog|article/i.test(url) }));
}

/** An article: under a blog-like folder, from a posts sitemap, or a long hyphenated slug at the top level. */
function isArticle(url: string, fromPosts: boolean) {
  const path = new URL(url).pathname;
  if (ARTICLE_DIR.test(`${path}/`) && path.split("/").filter(Boolean).length >= 2) return true;
  if (fromPosts) return true;
  const parts = path.split("/").filter(Boolean);
  return parts.length === 1 && parts[0].split("-").length >= 4;
}

/** Find and clean every page on the site. source says where the list came from. */
export async function findPages(domain: string): Promise<{ source: string | null; pages: SitePage[] }> {
  const bases = [`https://${domain}`, `https://www.${domain}`];
  let found: { url: string; fromPosts: boolean }[] = [];
  let source: string | null = null;

  // 1. Sitemaps named in robots.txt, then the usual addresses.
  for (const base of bases) {
    const robots = (await get(`${base}/robots.txt`)) ?? "";
    const listed = [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
    for (const url of [...listed, ...GUESSES.map((g) => base + g)]) {
      const pages = await readSitemap(url);
      if (pages?.length) {
        found = pages;
        source = url;
        break;
      }
    }
    if (found.length) break;
  }

  // 2. RSS or Atom feeds list recent articles.
  if (!found.length)
    for (const base of bases) {
      for (const f of FEEDS) {
        const xml = await get(base + f);
        if (!xml || !/<(rss|feed)[\s>]/i.test(xml)) continue;
        const links = [...xml.matchAll(/<link>\s*([^<]+?)\s*<\/link>/gi), ...xml.matchAll(/<link[^>]+href="([^"]+)"/gi)].map((m) => m[1]);
        if (links.length) {
          found = links.map((u) => ({ url: u, fromPosts: true }));
          source = base + f;
          break;
        }
      }
      if (found.length) break;
    }

  // 3. Links on the homepage and on blog-like listing pages.
  if (!found.length) {
    const seen = new Set<string>();
    for (const path of ["", ...LISTINGS]) {
      const html = await get(`${bases[0]}${path}`);
      if (!html) continue;
      const $ = cheerio.load(html);
      $("a[href]").each((_, a) => {
        try {
          seen.add(new URL($(a).attr("href")!, `${bases[0]}${path}/`).toString());
        } catch {
          // Not a link we can read.
        }
      });
    }
    found = [...seen].map((u) => ({ url: u, fromPosts: false }));
    source = found.length ? "links on the website" : null;
  }

  const pages = new Map<string, SitePage>();
  for (const f of found) {
    const url = cleanUrl(f.url, domain);
    if (url && !pages.has(url)) pages.set(url, { url, article: isArticle(url, f.fromPosts) });
    if (pages.size >= MAX_PAGES) break;
  }
  return { source, pages: [...pages.values()] };
}
