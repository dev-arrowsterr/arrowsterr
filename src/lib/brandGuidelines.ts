// Brand guidelines (docs/content-v2.md, Brand): the brand's written rules, links and reference files, kept on the
// Brand page next to the Tone of voice and the Brand Kit. Shared by the server and the browser, and pure, so tests can cover it.
import { cleanKit, type BrandKit } from "./brandKit.ts";

export const MAX_BODY = 50_000;
export const MAX_LINKS = 20;
export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Reference files live at <workspace id>/<brand id>/<file> in this private bucket (supabase/052_brand_guidelines.sql). */
export const FILES_BUCKET = "brand-files";

export type GuidelineFile = { name: string; path: string; size: number; type: string; uploaded_at: string };
export type GuidelinesRow = { brand_id: string; body: string; links: string[]; files: GuidelineFile[]; updated_at: string | null };

/** Links from a box: split on spaces, commas and lines, made https, deduped, at most MAX_LINKS. */
export function cleanLinks(input: string | unknown[]): { links: string[]; bad: string[] } {
  const parts = Array.isArray(input) ? input.filter((x): x is string => typeof x === "string") : input.split(/[\s,]+/);
  const links: string[] = [];
  const bad: string[] = [];
  for (const raw of parts.map((p) => p.trim()).filter(Boolean)) {
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    let u: URL;
    try {
      u = new URL(withScheme);
    } catch {
      bad.push(raw);
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) {
      bad.push(raw);
      continue;
    }
    u.hash = "";
    const s = u.toString();
    if (!links.includes(s) && links.length < MAX_LINKS) links.push(s);
  }
  return { links, bad };
}

/** A saved file entry, or null when it is broken. */
function cleanFile(x: unknown): GuidelineFile | null {
  if (!x || typeof x !== "object") return null;
  const f = x as Record<string, unknown>;
  if (typeof f.path !== "string" || !f.path || typeof f.name !== "string") return null;
  return { name: f.name.slice(0, 200), path: f.path, size: Number(f.size) || 0, type: typeof f.type === "string" ? f.type : "", uploaded_at: typeof f.uploaded_at === "string" ? f.uploaded_at : "" };
}

/** A guidelines row as the database hands it back, cleaned so the page and the writer can trust it. */
export function cleanGuidelines(x: unknown): GuidelinesRow | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (typeof r.brand_id !== "string") return null;
  return {
    brand_id: r.brand_id,
    body: typeof r.body === "string" ? r.body.slice(0, MAX_BODY) : "",
    links: Array.isArray(r.links) ? cleanLinks(r.links).links : [],
    files: Array.isArray(r.files) ? r.files.map(cleanFile).filter((f): f is GuidelineFile => Boolean(f)).slice(0, MAX_FILES) : [],
    updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
  };
}

/** Where an uploaded file goes. The workspace comes first, so the bucket's policies can check the role. */
export const filePath = (workspaceId: string, brandId: string, name: string, now = Date.now()) =>
  `${workspaceId}/${brandId}/${now}-${name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "file"}`;

const host = (s: string | null | undefined) =>
  (s ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");

/**
 * The Brand Kit row a brand writes and designs with: its own kit, or else the workspace's kit when that kit was learned
 * from this brand's website or the workspace has only this brand. An agency's own kit never dresses a client brand.
 */
export function kitRowForBrand<R extends { key: string; website: string | null }>(rows: R[], brand: { id: string; domain: string }, brandCount: number): R | null {
  const own = rows.find((r) => r.key === brand.id);
  if (own) return own;
  const ws = rows.find((r) => r.key === "workspace");
  if (ws && (brandCount <= 1 || (host(ws.website) && host(ws.website) === host(brand.domain)))) return ws;
  return null;
}
export function kitForBrand(rows: { key: string; website: string | null; kit: unknown }[], brand: { id: string; domain: string }, brandCount: number): BrandKit | null {
  const row = kitRowForBrand(rows, brand, brandCount);
  return row ? cleanKit(row.kit) : null;
}
