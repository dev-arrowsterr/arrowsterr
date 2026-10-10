import "server-only";
import * as cheerio from "cheerio";

/** Turn "Acme.com/pricing" or "https://www.acme.com" into a clean URL and domain. Returns null if it is not a public domain. */
export function normalizeSite(input: string): { url: string; domain: string } | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let host: string;
  try {
    host = new URL(s).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host)) return null;
  return { url: `https://${host}`, domain: host.replace(/^www\./, "") };
}

export function logoFor(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

/** Read the homepage: site name, title, description, and up to 8,000 characters of text. */
export async function fetchSite(url: string) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ArrowsterrBot/1.0; +https://arrowsterr.com)" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const $ = cheerio.load((await res.text()).slice(0, 2_000_000));
    $("script, style, noscript, svg").remove();
    return {
      siteName: $('meta[property="og:site_name"]').attr("content")?.trim() ?? "",
      title: $("title").first().text().trim(),
      desc: $('meta[name="description"]').attr("content")?.trim() ?? "",
      text: $("body").text().split(/\s+/).join(" ").trim().slice(0, 8000),
    };
  } catch {
    return { siteName: "", title: "", desc: "", text: "" };
  }
}

const KEY_PAGES = /\/(pricing|plans|features|product|products|solutions|about|about-us|company|why)(\/|$)/i;

async function readPage(url: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ArrowsterrBot/1.0; +https://arrowsterr.com)" },
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
  });
  const $ = cheerio.load((await res.text()).slice(0, 2_000_000));
  $("script, style, noscript, svg, nav, header, footer, form, [role=navigation], [aria-hidden=true]").remove();
  return $;
}

/** Read the homepage plus up to 3 key pages (pricing, features, about), with menus and footers removed. */
export async function fetchSitePages(url: string) {
  const home = await fetchSite(url);
  let links: string[] = [];
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ArrowsterrBot/1.0; +https://arrowsterr.com)" }, redirect: "follow", signal: AbortSignal.timeout(12_000) });
    const base = new URL(res.url || url);
    const $ = cheerio.load((await res.text()).slice(0, 2_000_000));
    const seen = new Set<string>();
    $("a[href]").each((_, a) => {
      try {
        const u = new URL($(a).attr("href") ?? "", base);
        if (u.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "") || !KEY_PAGES.test(u.pathname)) return;
        const clean = `${u.origin}${u.pathname.replace(/\/$/, "")}`;
        // One page per kind, so we do not read three pricing pages.
        const kind = u.pathname.match(KEY_PAGES)?.[1]?.toLowerCase().replace(/s$|-us$/, "") ?? clean;
        if (!seen.has(kind)) {
          seen.add(kind);
          links.push(clean);
        }
      } catch {}
    });
  } catch {}
  links = links.slice(0, 3);
  const pages = await Promise.all(
    links.map(async (l) => {
      try {
        const $ = await readPage(l);
        return `\n\n[${new URL(l).pathname}]\n${$("main").text() || $("body").text()}`.split(/[ \t]+/).join(" ").replace(/\s*\n\s*/g, "\n").slice(0, 4000);
      } catch {
        return "";
      }
    }),
  );
  return { ...home, text: (home.text + pages.join("")).trim(), pages: links };
}
