import "server-only";
import { createHmac } from "node:crypto";
import type { CmsKind } from "./cmsTypes";

// Reading and editing pages that already live in a CMS, for Ask Arrowsterr's change sets.
// WordPress and Ghost for now. Every write returns the page's new "modified" stamp, and undo only
// restores a page nobody has edited since, so Arrowsterr never overwrites someone's later work.

type Config = Record<string, string>;
export type ItemType = "post" | "page";
export type Item = {
  type: ItemType;
  id: string;
  url: string;
  title: string;
  html: string;
  date?: string;
  modified: string;
  author?: string;
  image?: string;
  meta?: { title: string; description: string };
  schema?: string;
};
/** The editable fields of one page, as a snapshot we can put back. */
export type Fields = { html?: string; metaTitle?: string; metaDescription?: string; schema?: string };
export type Caps = { alt: boolean; meta: boolean; schema: boolean; faq: boolean; links: boolean; note?: string };

const base = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`).replace(/\/+$/, "");

async function call(url: string, init: RequestInit & { json?: unknown } = {}) {
  const { json, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { Accept: "application/json", ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    const d = data as Record<string, unknown>;
    const msg = (d.message as string) || ((d.errors as { message?: string }[] | undefined)?.[0]?.message ?? "") || (d.raw as string) || res.statusText;
    throw new Error(`${res.status}: ${String(msg).slice(0, 300)}`);
  }
  return { data, headers: res.headers };
}

// ─────────────── WordPress ───────────────

const wpAuth = (c: Config) => ({ Authorization: `Basic ${Buffer.from(`${c.username}:${c.appPassword.replace(/\s+/g, "")}`).toString("base64")}` });
type WpPost = { id: number; link: string; title: { raw: string }; content: { raw: string }; date: string; modified: string; author: number; arrowsterr?: { title: string; description: string; schema: string } };

/** The Arrowsterr Connector plugin, if installed: its version and the SEO plugin it writes through. */
export async function wpPlugin(c: Config): Promise<{ version: string; seo: string } | null> {
  try {
    const { data } = await call(`${base(c.siteUrl)}/wp-json/arrowsterr/v1/status`, { headers: wpAuth(c) });
    return data as { version: string; seo: string };
  } catch {
    return null;
  }
}

async function wpList(c: Config, max: number): Promise<Item[]> {
  const out: Item[] = [];
  const users = new Map<number, string>();
  for (const type of ["posts", "pages"] as const) {
    for (let page = 1; out.length < max; page++) {
      const fields = "id,link,title,content,date,modified,author,arrowsterr";
      const { data, headers } = await call(`${base(c.siteUrl)}/wp-json/wp/v2/${type}?per_page=50&page=${page}&status=publish&context=edit&_fields=${fields}`, { headers: wpAuth(c) });
      for (const p of data as WpPost[]) out.push(wpItem(type === "posts" ? "post" : "page", p));
      if (page >= Number(headers.get("x-wp-totalpages") ?? 1)) break;
    }
  }
  // Author names, for structured data.
  const ids = [...new Set(out.map((i) => Number(i.author)).filter(Boolean))].slice(0, 50);
  if (ids.length) {
    const { data } = await call(`${base(c.siteUrl)}/wp-json/wp/v2/users?include=${ids.join(",")}&_fields=id,name`, { headers: wpAuth(c) }).catch(() => ({ data: [] }));
    for (const u of data as { id: number; name: string }[]) users.set(u.id, u.name);
    for (const i of out) if (i.author) i.author = users.get(Number(i.author)) ?? undefined;
  }
  return out.slice(0, max);
}

function wpItem(type: ItemType, p: WpPost): Item {
  return {
    type,
    id: String(p.id),
    url: p.link,
    title: p.title?.raw ?? "",
    html: p.content?.raw ?? "",
    date: p.date,
    modified: p.modified,
    author: String(p.author ?? ""),
    ...(p.arrowsterr ? { meta: { title: p.arrowsterr.title ?? "", description: p.arrowsterr.description ?? "" }, schema: p.arrowsterr.schema ?? "" } : {}),
  };
}

async function wpGet(c: Config, type: ItemType, id: string): Promise<Item> {
  const { data } = await call(`${base(c.siteUrl)}/wp-json/wp/v2/${type}s/${id}?context=edit&_fields=id,link,title,content,date,modified,author,arrowsterr`, { headers: wpAuth(c) });
  return wpItem(type, data as WpPost);
}

async function wpWrite(c: Config, type: ItemType, id: string, f: Fields): Promise<string> {
  const body: Record<string, unknown> = {};
  if (f.html !== undefined) body.content = f.html;
  const aw: Record<string, string> = {};
  if (f.metaTitle !== undefined) aw.title = f.metaTitle;
  if (f.metaDescription !== undefined) aw.description = f.metaDescription;
  if (f.schema !== undefined) aw.schema = f.schema;
  if (Object.keys(aw).length) body.arrowsterr = aw;
  const { data } = await call(`${base(c.siteUrl)}/wp-json/wp/v2/${type}s/${id}?_fields=id,modified`, { method: "POST", headers: wpAuth(c), json: body });
  return (data as { modified: string }).modified;
}

// ─────────────── Ghost ───────────────

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
function ghostToken(adminKey: string) {
  const [kid, secret] = adminKey.split(":");
  if (!kid || !secret) throw new Error("The Admin API key looks like id:secret.");
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid }));
  const body = b64url(JSON.stringify({ iat: now, exp: now + 300, aud: "/admin/" }));
  return `${head}.${body}.${b64url(createHmac("sha256", Buffer.from(secret, "hex")).update(`${head}.${body}`).digest())}`;
}
const ghHead = (c: Config) => ({ Authorization: `Ghost ${ghostToken(c.adminKey)}`, "Accept-Version": "v5.0" });
type GhPost = { id: string; url: string; title: string; html: string; published_at: string; updated_at: string; meta_title: string | null; meta_description: string | null; codeinjection_head: string | null; feature_image: string | null; primary_author?: { name: string } };

// Structured data lives in the page's head code, between these markers, so we only ever touch our own part.
const MARK = /<!-- arrowsterr:schema -->[\s\S]*?<!-- \/arrowsterr:schema -->\n?/;
const schemaIn = (head: string | null) => {
  const m = (head ?? "").match(/<!-- arrowsterr:schema --><script type="application\/ld\+json">([\s\S]*?)<\/script><!-- \/arrowsterr:schema -->/);
  return m ? m[1] : "";
};
const withSchema = (head: string | null, json: string) => {
  const rest = (head ?? "").replace(MARK, "");
  return json ? `${rest}${rest && !rest.endsWith("\n") ? "\n" : ""}<!-- arrowsterr:schema --><script type="application/ld+json">${json.replace(/<\//g, "<\\/")}</script><!-- /arrowsterr:schema -->\n` : rest;
};

const ghFields = "id,url,title,html,published_at,updated_at,meta_title,meta_description,codeinjection_head,feature_image";
function ghItem(type: ItemType, p: GhPost): Item {
  return {
    type,
    id: p.id,
    url: p.url,
    title: p.title,
    html: p.html ?? "",
    date: p.published_at,
    modified: p.updated_at,
    author: p.primary_author?.name,
    image: p.feature_image ?? undefined,
    meta: { title: p.meta_title ?? "", description: p.meta_description ?? "" },
    schema: schemaIn(p.codeinjection_head),
  };
}

async function ghList(c: Config, max: number): Promise<Item[]> {
  const out: Item[] = [];
  for (const type of ["posts", "pages"] as const) {
    const { data } = await call(`${base(c.siteUrl)}/ghost/api/admin/${type}/?limit=${Math.min(max, 200)}&filter=status:published&formats=html&include=authors&fields=${ghFields}`, { headers: ghHead(c) });
    for (const p of (data as Record<string, GhPost[]>)[type]) out.push(ghItem(type === "posts" ? "post" : "page", p));
  }
  return out.slice(0, max);
}

async function ghRaw(c: Config, type: ItemType, id: string): Promise<GhPost> {
  const { data } = await call(`${base(c.siteUrl)}/ghost/api/admin/${type}s/${id}/?formats=html&include=authors&fields=${ghFields}`, { headers: ghHead(c) });
  return (data as Record<string, GhPost[]>)[`${type}s`][0];
}

async function ghWrite(c: Config, type: ItemType, id: string, f: Fields): Promise<string> {
  const cur = await ghRaw(c, type, id);
  const post: Record<string, unknown> = { updated_at: cur.updated_at };
  if (f.html !== undefined) post.html = f.html;
  if (f.metaTitle !== undefined) post.meta_title = f.metaTitle || null;
  if (f.metaDescription !== undefined) post.meta_description = f.metaDescription || null;
  if (f.schema !== undefined) post.codeinjection_head = withSchema(cur.codeinjection_head, f.schema) || null;
  const { data } = await call(`${base(c.siteUrl)}/ghost/api/admin/${type}s/${id}/${f.html !== undefined ? "?source=html" : ""}`, { method: "PUT", headers: ghHead(c), json: { [`${type}s`]: [post] } });
  return (data as Record<string, GhPost[]>)[`${type}s`][0].updated_at;
}

// ─────────────── Shared ───────────────

export const EDITABLE: CmsKind[] = ["wordpress", "ghost"];

/** What Ask Arrowsterr can change through this connection. */
export async function capsOf(kind: CmsKind, c: Config): Promise<Caps> {
  if (kind === "ghost") return { alt: true, meta: true, schema: true, faq: true, links: true };
  if (kind === "wordpress") {
    const plugin = await wpPlugin(c);
    if (plugin) return { alt: true, meta: true, schema: plugin.seo === "none", faq: true, links: true, ...(plugin.seo !== "none" ? { note: `${plugin.seo === "yoast" ? "Yoast SEO" : "Rank Math"} already adds structured data, so Arrowsterr leaves schema to it.` } : {}) };
    return { alt: true, meta: false, schema: false, faq: true, links: true, note: "Install the Arrowsterr Connector plugin to let Arrowsterr set SEO titles, meta descriptions and structured data." };
  }
  return { alt: false, meta: false, schema: false, faq: false, links: false, note: "Editing existing pages works with WordPress and Ghost for now." };
}

export async function listItems(kind: CmsKind, c: Config, max = 300): Promise<Item[]> {
  if (kind === "wordpress") return wpList(c, max);
  if (kind === "ghost") return ghList(c, max);
  throw new Error("Editing existing pages works with WordPress and Ghost for now.");
}

export async function getItem(kind: CmsKind, c: Config, type: ItemType, id: string): Promise<Item> {
  if (kind === "wordpress") return wpGet(c, type, id);
  if (kind === "ghost") return ghItem(type, await ghRaw(c, type, id));
  throw new Error("Not supported.");
}

/** Write fields and return the page's new modified stamp. */
export async function writeItem(kind: CmsKind, c: Config, type: ItemType, id: string, f: Fields): Promise<string> {
  if (kind === "wordpress") return wpWrite(c, type, id, f);
  if (kind === "ghost") return ghWrite(c, type, id, f);
  throw new Error("Not supported.");
}

/** The current values of the fields a change will touch, to put back on undo. */
export function snapshot(item: Item, keys: (keyof Fields)[]): Fields {
  const f: Fields = {};
  if (keys.includes("html")) f.html = item.html;
  if (keys.includes("metaTitle")) f.metaTitle = item.meta?.title ?? "";
  if (keys.includes("metaDescription")) f.metaDescription = item.meta?.description ?? "";
  if (keys.includes("schema")) f.schema = item.schema ?? "";
  return f;
}

export { addLink, faqHtml, faqsIn, imagesWithoutAlt, linksIn, setAlts, textOf } from "./htmlEdit.ts";
