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
