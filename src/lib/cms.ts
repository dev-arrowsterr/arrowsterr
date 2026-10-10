import "server-only";
import { createHmac } from "node:crypto";
import type { CmsKind, PublishInput } from "./cmsTypes";

type Config = Record<string, string>;
type Result = { id: string; url: string | null };

const base = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`).replace(/\/+$/, "");

async function call(url: string, init: RequestInit & { json?: unknown } = {}) {
  const { json, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { Accept: "application/json", ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    const msg = (data.message as string) || ((data.errors as { message?: string }[] | undefined)?.[0]?.message ?? "") || (typeof data.errors === "string" ? data.errors : "") || (data.raw as string) || res.statusText;
    throw new Error(`${res.status}: ${String(msg).slice(0, 300)}`);
  }
  return data;
}

/** The FAQ schema as a script tag at the end of the post. */
const withSchema = (p: PublishInput) => (p.schema ? `${p.html}\n<script type="application/ld+json">\n${p.schema}\n</script>` : p.html);

// ─────────────── WordPress ───────────────

const wpAuth = (c: Config) => ({ Authorization: `Basic ${Buffer.from(`${c.username}:${c.appPassword.replace(/\s+/g, "")}`).toString("base64")}` });

async function wpImage(c: Config, src: string): Promise<number | null> {
  if (!src) return null;
  const img = await fetch(src, { signal: AbortSignal.timeout(20_000) });
  if (!img.ok) return null;
  const type = img.headers.get("content-type") ?? "image/jpeg";
  const name = (new URL(src).pathname.split("/").pop() || "featured").replace(/[^\w.-]/g, "") || "featured.jpg";
  const media = await call(`${base(c.siteUrl)}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: { ...wpAuth(c), "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"` },
    body: Buffer.from(await img.arrayBuffer()),
  });
  return Number(media.id) || null;
}

const wordpress = {
  test: async (c: Config) => {
    const me = await call(`${base(c.siteUrl)}/wp-json/wp/v2/users/me?context=edit`, { headers: wpAuth(c) });
    return `Signed in as ${me.name ?? c.username}`;
  },
  publish: async (c: Config, p: PublishInput, id?: string): Promise<Result> => {
    const featured = await wpImage(c, p.image).catch(() => null);
    const body = { title: p.title, content: withSchema(p), slug: p.slug || undefined, excerpt: p.description, status: p.live ? "publish" : "draft", ...(featured ? { featured_media: featured } : {}) };
    const post = await call(`${base(c.siteUrl)}/wp-json/wp/v2/posts${id ? `/${id}` : ""}`, { method: "POST", headers: wpAuth(c), json: body });
    return { id: String(post.id), url: (post.link as string) ?? null };
  },
};

// ─────────────── Webflow ───────────────

const wfHead = (c: Config) => ({ Authorization: `Bearer ${c.token}` });
const webflow = {
  test: async (c: Config) => {
    const col = await call(`https://api.webflow.com/v2/collections/${c.collectionId}`, { headers: wfHead(c) });
    return `Collection: ${col.displayName ?? c.collectionId}`;
  },
  publish: async (c: Config, p: PublishInput, id?: string): Promise<Result> => {
    const fieldData: Record<string, unknown> = { name: p.title, slug: p.slug || undefined, [c.bodyField || "post-body"]: withSchema(p) };
    if (p.description) fieldData[c.summaryField || "post-summary"] = p.description;
    if (p.image && c.imageField) fieldData[c.imageField] = { url: p.image };
    const path = `https://api.webflow.com/v2/collections/${c.collectionId}/items${p.live ? "/live" : ""}`;
    const item = id
      ? await call(`${path}/${id}`, { method: "PATCH", headers: wfHead(c), json: { isDraft: !p.live, fieldData } })
      : await call(path, { method: "POST", headers: wfHead(c), json: { isDraft: !p.live, fieldData } });
    return { id: String(item.id), url: null };
  },
};

// ─────────────── Shopify ───────────────

const shop = (c: Config) => `https://${c.shop.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}/admin/api/2024-10`;
const shHead = (c: Config) => ({ "X-Shopify-Access-Token": c.token });
const shopify = {
  test: async (c: Config) => {
    const b = await call(`${shop(c)}/blogs/${c.blogId}.json`, { headers: shHead(c) });
    return `Blog: ${(b.blog as { title?: string })?.title ?? c.blogId}`;
  },
  publish: async (c: Config, p: PublishInput, id?: string): Promise<Result> => {
    const article = {
      title: p.title,
      body_html: withSchema(p),
      handle: p.slug || undefined,
      summary_html: p.description ? `<p>${p.description}</p>` : undefined,
      published: p.live,
      ...(p.image ? { image: { src: p.image } } : {}),
      metafields_global_title_tag: p.title,
      metafields_global_description_tag: p.description || undefined,
    };
    const url = `${shop(c)}/blogs/${c.blogId}/articles${id ? `/${id}` : ""}.json`;
    const out = await call(url, { method: id ? "PUT" : "POST", headers: shHead(c), json: { article } });
    const a = out.article as { id: number; handle: string };
    return { id: String(a.id), url: null };
  },
};

// ─────────────── HubSpot ───────────────

const hsHead = (c: Config) => ({ Authorization: `Bearer ${c.token}` });
const hubspot = {
  test: async (c: Config) => {
    await call("https://api.hubapi.com/cms/v3/blogs/posts?limit=1", { headers: hsHead(c) });
    return "Connected";
  },
  publish: async (c: Config, p: PublishInput, id?: string): Promise<Result> => {
    const body = {
      name: p.title,
      htmlTitle: p.title,
      slug: p.slug || undefined,
      postBody: withSchema(p),
      metaDescription: p.description,
      contentGroupId: c.blogId,
      ...(p.image ? { featuredImage: p.image, useFeaturedImage: true } : {}),
    };
    const post = id
      ? await call(`https://api.hubapi.com/cms/v3/blogs/posts/${id}/draft`, { method: "PATCH", headers: hsHead(c), json: body })
      : await call("https://api.hubapi.com/cms/v3/blogs/posts", { method: "POST", headers: hsHead(c), json: body });
    const postId = String(post.id ?? id);
    if (p.live) {
      if (id) await call(`https://api.hubapi.com/cms/v3/blogs/posts/${postId}/draft/push-live`, { method: "POST", headers: hsHead(c) });
      else await call("https://api.hubapi.com/cms/v3/blogs/posts/schedule", { method: "POST", headers: hsHead(c), json: { id: postId, publishDate: new Date(Date.now() + 60_000).toISOString() } });
    }
    return { id: postId, url: (post.url as string) ?? null };
  },
};

// ─────────────── Ghost ───────────────

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
/** Ghost's Admin API takes a short-lived token signed with the integration's secret. */
function ghostToken(adminKey: string) {
  const [kid, secret] = adminKey.split(":");
  if (!kid || !secret) throw new Error("The Admin API key looks like id:secret.");
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid }));
  const body = b64url(JSON.stringify({ iat: now, exp: now + 300, aud: "/admin/" }));
  const sig = b64url(createHmac("sha256", Buffer.from(secret, "hex")).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}
const ghHead = (c: Config) => ({ Authorization: `Ghost ${ghostToken(c.adminKey)}`, "Accept-Version": "v5.0" });
const ghost = {
  test: async (c: Config) => {
    const s = await call(`${base(c.siteUrl)}/ghost/api/admin/site/`, { headers: ghHead(c) });
    return `Site: ${(s.site as { title?: string })?.title ?? c.siteUrl}`;
  },
  publish: async (c: Config, p: PublishInput, id?: string): Promise<Result> => {
    const post: Record<string, unknown> = {
      title: p.title,
      html: p.html,
      slug: p.slug || undefined,
      status: p.live ? "published" : "draft",
      meta_title: p.title,
      meta_description: p.description || undefined,
      custom_excerpt: p.description ? p.description.slice(0, 300) : undefined,
      feature_image: p.image || undefined,
      codeinjection_foot: p.schema ? `<script type="application/ld+json">\n${p.schema}\n</script>` : undefined,
    };
    const root = `${base(c.siteUrl)}/ghost/api/admin/posts`;
    if (id) {
      const cur = await call(`${root}/${id}/`, { headers: ghHead(c) });
      post.updated_at = (cur.posts as { updated_at: string }[])[0].updated_at;
    }
    const out = await call(`${root}/${id ? `${id}/` : ""}?source=html`, { method: id ? "PUT" : "POST", headers: ghHead(c), json: { posts: [post] } });
    const g = (out.posts as { id: string; url?: string }[])[0];
    return { id: g.id, url: g.url ?? null };
  },
};

export const CMS_API: Record<CmsKind, { test: (c: Config) => Promise<string>; publish: (c: Config, p: PublishInput, id?: string) => Promise<Result> }> = { wordpress, webflow, shopify, hubspot, ghost };
