// The Content group's addresses (docs/content-v2.md, The sidebar). Pure, so tests can cover the forwarding.

export type ContentPage = "calendar" | "writer" | "library" | "brand";

export const CONTENT_SLUGS: Record<ContentPage, string> = {
  calendar: "/editorial-calendar",
  writer: "/agentic-writer",
  library: "/library",
  brand: "/brand",
};

/** Older addresses: Opportunities, the Calendar and every Content Plan name open the Editorial Calendar; Content opens the Library. */
export const CONTENT_ALIASES: Record<string, ContentPage> = {
  "/opportunities": "calendar",
  "/calendar": "calendar",
  "/content-calendar": "calendar",
  "/content-plan": "calendar",
  "/agentic-research": "calendar",
  "/topic-bank": "calendar",
  "/planner": "calendar",
  "/inkwell": "calendar",
  "/content-intelligence": "calendar",
  "/performance": "calendar",
  "/reports/content": "calendar",
  "/writer": "writer",
  "/content": "library",
  "/brand-voice": "brand",
  "/settings/brand-voice": "brand",
};

/** The Content page an address opens, or null when it isn't one. */
export function contentPageFromPath(path: string): ContentPage | null {
  const p = path.replace(/\/+$/, "") || "/";
  return (Object.entries(CONTENT_SLUGS).find(([, slug]) => slug === p)?.[0] as ContentPage | undefined) ?? CONTENT_ALIASES[p] ?? null;
}
