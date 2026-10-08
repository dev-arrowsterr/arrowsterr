// Cleaning sitemap URLs. No server-only code here, so tests can load it.

const JUNK_PATH =
  /\/(tag|tags|category|categories|author|authors|page\/\d+|feed|wp-json|wp-admin|wp-content|cart|checkout|account|my-account|login|log-in|signin|sign-in|signup|sign-up|register|privacy|privacy-policy|terms|terms-of-service|cookie|cookies|legal|search|thank-you|thanks|cdn-cgi|amp)(\/|$)/i;
const JUNK_EXT = /\.(jpe?g|png|gif|svg|webp|avif|ico|pdf|zip|mp4|mp3|webm|css|js|json|xml|txt|gz)$/i;


/** Clean one URL: same site, no query or hash, no files or junk pages. Returns null to drop it. */
export function cleanUrl(raw: string, domain: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== domain && !host.endsWith(`.${domain}`)) return null;
  const path = decodeURIComponent(u.pathname).replace(/\/+$/, "") || "/";
  if (JUNK_EXT.test(path) || JUNK_PATH.test(`${path}/`)) return null;
  return `https://${u.hostname.toLowerCase()}${path === "/" ? "" : path}`;
}

