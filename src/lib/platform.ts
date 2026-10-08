import "server-only";

export type Platform = "wordpress" | "shopify" | "webflow" | "wix" | "squarespace" | "framer" | "gtm" | "other";

/** Read the homepage once: how the site is built, and whether our snippet is already on it. */
export async function inspectSite(domain: string, websiteId?: string | null): Promise<{ platform: Platform; installed: boolean; reachable: boolean }> {
  let html = "";
  try {
    const res = await fetch(`https://${domain}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ArrowsterrBot/1.0; +https://arrowsterr.com)" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    html = (await res.text()).slice(0, 3_000_000);
  } catch {
    return { platform: "other", installed: false, reachable: false };
  }
  const h = html.toLowerCase();
  const platform: Platform = h.includes("cdn.shopify.com") || h.includes("shopify.theme")
    ? "shopify"
    : h.includes("wp-content") || h.includes("wp-includes")
      ? "wordpress"
      : h.includes("webflow")
        ? "webflow"
        : h.includes("static.wixstatic.com") || h.includes("wix.com")
          ? "wix"
          : h.includes("squarespace")
            ? "squarespace"
            : h.includes("framerusercontent") || h.includes("framer.com")
              ? "framer"
              : h.includes("googletagmanager.com/gtm.js")
                ? "gtm"
                : "other";
  return { platform, installed: Boolean(websiteId && h.includes(websiteId.toLowerCase())), reachable: true };
}
