// Publishing an article to WordPress and keeping it in sync (docs/content-v2.md, Publish).
// One article and one site make one WordPress post, for good: publishing again updates that post, a post deleted in
// WordPress shows as deleted, and only an explicit "publish as new" makes another. Never two posts by accident:
//   - one publish at a time per article and site (lock_publication in 051_wp_sync.sql);
//   - the post id is saved the moment WordPress returns it;
//   - a publish that died after WordPress made the post but before its id was saved finds that post again
//     (the plugin tags each post with the article's id; without it, the same title made since that attempt).
// Pure: WordPress (`Wp`) and the database (`PubStore`) come in from wpSyncServer.ts, so tests run offline.
import { collectImages, htmlToBlocks, type Media } from "./wpConvert.ts";
import { hashId } from "./wpModules.ts";

export type WpStatus = "draft" | "pending" | "private" | "future" | "publish" | "trash" | "deleted";
export type Mode = "draft" | "publish" | "schedule";
export type PubOptions = { slug?: string; categoryId?: number | null; tags?: string[]; metaTitle?: string; metaDescription?: string; image?: string; schema?: string };
export type Pub = {
  id: string;
  workspace_id: string;
  doc_id: string;
  connection_id: string;
  remote_id: string | null;
  url: string | null;
  remote_status: WpStatus | null;
  remote_modified: string | null;
  pushed_modified: string | null;
  mode: Mode | null;
  scheduled_for: string | null;
  options: PubOptions;
  media: Media;
  creating_since: string | null;
  last_error: string | null;
  pushed_at: string | null;
  synced_at: string | null;
};

export type WpRes = { status: number; data: unknown };
/** A WordPress site's REST API, signed in. req never throws on an HTTP status; it throws when the site can't be reached. */
export type Wp = {
  siteUrl: string;
  req: (method: "GET" | "POST", path: string, body?: unknown) => Promise<WpRes>;
  /** Fetch an image (an address or a data: URI) and add it to the media library. Null when it can't. */
  upload: (src: string, alt: string) => Promise<{ id: number; url: string } | null>;
};
export type PubStore = {
  get: (docId: string, connectionId: string) => Promise<Pub | null>;
  byId: (id: string) => Promise<Pub | null>;
  /** The row for this article and site, made if missing (unique on doc_id + connection_id). */
  ensure: (row: { workspace_id: string; doc_id: string; connection_id: string }) => Promise<Pub>;
  lock: (id: string, seconds: number) => Promise<boolean>;
  update: (id: string, patch: Partial<Pub> & { locked_until?: string | null }) => Promise<void>;
};

export type PublishRequest = {
  workspaceId: string;
  docId: string;
  connectionId: string;
  title: string;
  html: string;
  mode: Mode;
  /** ISO time, with mode "schedule". */
  scheduleAt?: string | null;
  options: PubOptions;
  /** The post was deleted in WordPress: make a new one. */
  asNew?: boolean;
};
export type PublishResult = { pub: Pub; warnings: string[]; created: boolean };

export const PLUGIN_MIN = "1.1.0"; // modules, the article tag and find
export const MAX_IMAGES = 30;
const LOCK_S = 180;
const RECOVER_MS = 15 * 60_000; // a create in doubt this recent is looked for by title

export class PublishError extends Error {
  code: "busy" | "deleted" | "auth" | "wordpress";
  constructor(code: PublishError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const gmt = (s: unknown) => (typeof s === "string" && s ? (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? new Date(s) : new Date(`${s}Z`)).toISOString() : null);
const wpDate = (iso: string) => new Date(iso).toISOString().slice(0, 19); // date_gmt takes no zone
const obj = (d: unknown) => (d && typeof d === "object" ? (d as Record<string, unknown>) : {});
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#0?39;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** "1.10.0" ≥ "1.9.2", as versions. */
export function versionAtLeast(v: string | null | undefined, min: string) {
  if (!v) return false;
  const a = v.split(".").map((x) => parseInt(x, 10) || 0);
  const b = min.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
}

function failure(r: WpRes, what: string): PublishError {
  const d = obj(r.data);
  const msg = String(d.message ?? d.raw ?? "").replace(/<[^>]+>/g, "").slice(0, 300);
  if (r.status === 401 || r.status === 403) return new PublishError("auth", `WordPress refused ${what} (${r.status}${msg ? `: ${msg}` : ""}). Check the site's username and application password, and that the user can publish posts.`);
  return new PublishError("wordpress", `WordPress could not ${what} (${r.status}${msg ? `: ${msg}` : ""}).`);
}

/** A post id WordPress says doesn't exist. Only this counts as deleted: a refusal or an outage never does. */
const gone = (r: WpRes) => r.status === 404 && obj(r.data).code === "rest_post_invalid_id";

/** The Arrowsterr Connector plugin on this site, when it is 1.1.0 or later. */
export async function pluginOn(wp: Wp): Promise<{ version: string; seo: string } | null> {
  try {
    const r = await wp.req("GET", "/arrowsterr/v1/status");
    const d = obj(r.data);
    return r.status === 200 && versionAtLeast(String(d.version ?? ""), PLUGIN_MIN) ? { version: String(d.version), seo: String(d.seo ?? "none") } : null;
  } catch {
    return null;
  }
}

/** Tag names to WordPress tag ids, made when missing. */
export async function tagIds(wp: Wp, names: string[]): Promise<number[]> {
  const ids: number[] = [];
  const unique = names.map((n) => n.trim()).filter((n, i, a) => n && a.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i);
  for (const raw of unique.slice(0, 20)) {
    const found = await wp.req("GET", `/wp/v2/tags?search=${encodeURIComponent(raw)}&per_page=50&_fields=id,name`);
    const hit = Array.isArray(found.data) ? (found.data as { id: number; name: string }[]).find((t) => decode(t.name).toLowerCase() === raw.toLowerCase()) : undefined;
    if (hit) {
      ids.push(hit.id);
      continue;
    }
    const made = await wp.req("POST", "/wp/v2/tags", { name: raw });
    const d = obj(made.data);
    if (made.status < 300 && d.id) ids.push(Number(d.id));
    else if (d.code === "term_exists" && obj(d.data).term_id) ids.push(Number(obj(d.data).term_id));
    else throw failure(made, `add the tag "${raw}"`);
  }
  return ids;
}

/** The post's state on the site now. "deleted" only when WordPress says the post doesn't exist. */
export async function readPost(wp: Wp, id: string): Promise<{ status: WpStatus; url: string | null; modified: string | null }> {
  const r = await wp.req("GET", `/wp/v2/posts/${encodeURIComponent(id)}?context=edit&_fields=id,link,status,modified_gmt`);
  if (gone(r) || r.status === 410) return { status: "deleted", url: null, modified: null };
  if (r.status !== 200) throw failure(r, "read the post");
  const d = obj(r.data);
  return { status: String(d.status ?? "draft") as WpStatus, url: (d.link as string) || null, modified: gmt(d.modified_gmt) };
}

/** Read the post back and save what WordPress says: status, address, last edit, or deleted. */
export async function syncPub(wp: Wp, store: PubStore, pub: Pub, now = new Date()): Promise<Pub> {
  if (!pub.remote_id) return pub;
  const p = await readPost(wp, pub.remote_id);
  const patch: Partial<Pub> = { remote_status: p.status, synced_at: now.toISOString(), ...(p.status === "deleted" ? {} : { url: p.url, remote_modified: p.modified }) };
  await store.update(pub.id, patch);
  return { ...pub, ...patch };
}

/** Edited in WordPress since Arrowsterr last wrote it. */
export const editedInWp = (p: Pick<Pub, "remote_modified" | "pushed_modified">) => Boolean(p.remote_modified && p.pushed_modified && Date.parse(p.remote_modified) - Date.parse(p.pushed_modified) > 1000);

/** A post this article already made, after a publish that died before saving its id. */
async function findLost(wp: Wp, pub: Pub, title: string, plugin: boolean, now: Date): Promise<string | null> {
  if (plugin) {
    const r = await wp.req("GET", `/arrowsterr/v1/find?doc=${encodeURIComponent(pub.doc_id)}`);
    const d = obj(r.data);
    if (r.status === 200 && d.id && d.status !== "trash") return String(d.id);
    if (r.status === 200) return null;
  }
  if (!pub.creating_since || now.getTime() - Date.parse(pub.creating_since) > RECOVER_MS) return null;
  const after = new Date(Date.parse(pub.creating_since) - 120_000).toISOString().slice(0, 19);
  const r = await wp.req("GET", `/wp/v2/posts?search=${encodeURIComponent(title.slice(0, 100))}&status=draft,publish,future,pending,private&after=${after}&context=edit&per_page=20&_fields=id,title,status`);
  if (r.status !== 200 || !Array.isArray(r.data)) return null;
  const hit = (r.data as { id: number; title?: { raw?: string } }[]).find((x) => (x.title?.raw ?? "").trim() === title.trim());
  return hit ? String(hit.id) : null;
}

/** What WordPress is asked for: status and date from the mode. A schedule in the past publishes now. */
export function statusFor(mode: Mode, at: string | null | undefined, now: Date): { status: "draft" | "publish" | "future"; date_gmt?: string } {
  if (mode === "draft") return { status: "draft" };
  if (mode === "schedule" && at && Date.parse(at) > now.getTime() + 60_000) return { status: "future", date_gmt: wpDate(at) };
  return { status: "publish" };
}

/** Publish (or update) one article on one WordPress site. */
export async function publishToWp(wp: Wp, store: PubStore, req: PublishRequest, now = new Date()): Promise<PublishResult> {
  let pub = (await store.get(req.docId, req.connectionId)) ?? (await store.ensure({ workspace_id: req.workspaceId, doc_id: req.docId, connection_id: req.connectionId }));
  if (!(await store.lock(pub.id, LOCK_S))) throw new PublishError("busy", "This article is being published to this site right now. Try again in a minute.");
  const warnings: string[] = [];
  try {
    const plugin = Boolean(await pluginOn(wp));
    const title = req.title.trim() || "Untitled";

    // The post this article already has, if any.
    let postId: string | null = pub.remote_id;
    if (postId && (pub.remote_status === "deleted" || pub.remote_status === "trash")) {
      if (!req.asNew) throw new PublishError("deleted", pub.remote_status === "trash" ? "This post is in the WordPress trash. Restore it there, or publish it again as a new post." : "This post was deleted in WordPress. Publish it again as a new post.");
      postId = null;
    }
    if (!postId) postId = await findLost(wp, pub, title, plugin, now);

    // Images: the featured one and every one in the draft, uploaded once each. The map is kept for next time.
    const media: Media = { ...(pub.media ?? {}) };
    const own = (src: string) => {
      try {
        return new URL(src).host === new URL(wp.siteUrl).host;
      } catch {
        return false;
      }
    };
    const wanted = [...(req.options.image ? [req.options.image] : []), ...collectImages(req.html)].filter((s, i, a) => a.indexOf(s) === i && !own(s));
    let failed = 0;
    for (const src of wanted.slice(0, MAX_IMAGES)) {
      if (media[src]) continue;
      const alt = /alt="([^"]*)"/.exec(req.html.slice(Math.max(0, req.html.indexOf(src) - 400), req.html.indexOf(src) + src.length + 400))?.[1] ?? "";
      const up = await wp.upload(src, alt).catch(() => null);
      if (up) media[src] = up;
      else failed++;
    }
    if (failed) warnings.push(`${failed} image${failed === 1 ? "" : "s"} could not be added to the media library and stay at their original address.`);
    if (wanted.length > MAX_IMAGES) warnings.push(`Only the first ${MAX_IMAGES} images were added to the media library.`);
    // Save the uploads now, so a failure below never uploads them twice.
    await store.update(pub.id, { media });

    const { content, modules } = htmlToBlocks(req.html, { plugin, media, title });
    const dropped = (req.html.match(/data-aw-module=|data-embed=/g) ?? []).length - modules.length;
    if (dropped > 0) warnings.push(`${dropped} interactive module${dropped === 1 ? " was" : "s were"} left out: broken or over 500 KB.`);
    const o = req.options;
    const schema = (o.schema ?? "").trim();
    const fullContent = !plugin && schema ? `${content}\n\n<!-- wp:html -->\n<script type="application/ld+json">\n${schema.replace(/<\//g, "<\\/")}\n</script>\n<!-- /wp:html -->` : content;
    const featured = o.image ? (media[o.image]?.id ?? null) : null;
    if (o.image && !featured && !own(o.image)) warnings.push("The featured image could not be added.");
    const tags = o.tags?.length ? await tagIds(wp, o.tags) : [];
    const target = statusFor(req.mode, req.scheduleAt, now);
    const body: Record<string, unknown> = {
      title,
      content: fullContent,
      excerpt: o.metaDescription ?? "",
      ...(o.slug ? { slug: o.slug } : {}),
      ...(o.categoryId ? { categories: [o.categoryId] } : {}),
      tags,
      ...(featured ? { featured_media: featured } : {}),
      ...(plugin ? { arrowsterr: { title: o.metaTitle ?? "", description: o.metaDescription ?? "", schema, doc: req.docId } } : {}),
    };
    const fields = "_fields=id,link,status,modified_gmt";
    let created = false;
    let post: Record<string, unknown>;

    if (postId) {
      if (plugin && modules.length) await putModules(wp, postId, modules);
      const r = await wp.req("POST", `/wp/v2/posts/${encodeURIComponent(postId)}?${fields}`, { ...body, ...target });
      if (gone(r)) {
        await store.update(pub.id, { remote_status: "deleted" });
        throw new PublishError("deleted", "This post was deleted in WordPress. Publish it again as a new post.");
      }
      if (r.status >= 300) throw failure(r, "update the post");
      post = obj(r.data);
    } else {
      // Mark the create as in doubt, make the post, then save its id before anything else.
      await store.update(pub.id, { creating_since: now.toISOString() });
      const first = plugin && modules.length ? { status: "draft" as const } : target;
      const r = await wp.req("POST", `/wp/v2/posts?${fields}`, { ...body, ...first });
      if (r.status >= 300) throw failure(r, "create the post");
      post = obj(r.data);
      postId = String(post.id);
      created = true;
      await store.update(pub.id, { remote_id: postId, url: (post.link as string) || null, remote_status: String(post.status ?? "draft") as WpStatus, creating_since: null });
      if (plugin && modules.length) {
        await putModules(wp, postId, modules);
        if (target.status !== "draft") {
          const r2 = await wp.req("POST", `/wp/v2/posts/${postId}?${fields}`, target);
          if (r2.status >= 300) throw failure(r2, "publish the post");
          post = obj(r2.data);
        }
      }
    }

    const at = now.toISOString();
    const patch: Partial<Pub> = {
      remote_id: postId,
      url: (post.link as string) || null,
      remote_status: String(post.status ?? target.status) as WpStatus,
      remote_modified: gmt(post.modified_gmt),
      pushed_modified: gmt(post.modified_gmt),
      mode: req.mode,
      scheduled_for: req.mode === "schedule" ? (req.scheduleAt ?? null) : null,
      options: o,
      media,
      creating_since: null,
      last_error: null,
      pushed_at: at,
      synced_at: at,
    };
    await store.update(pub.id, patch);
    pub = { ...pub, ...patch };
    return { pub, warnings, created };
  } catch (e) {
    await store.update(pub.id, { last_error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }).catch(() => {});
    throw e;
  } finally {
    await store.update(pub.id, { locked_until: null }).catch(() => {});
  }
}

async function putModules(wp: Wp, postId: string, modules: { id: string; title: string; html: string; height: number }[]) {
  const r = await wp.req("POST", `/arrowsterr/v1/posts/${encodeURIComponent(postId)}/modules`, { modules });
  if (r.status >= 300) throw failure(r, "save the interactive modules");
}

// ─────────────── the wp_publish job: publish on the calendar date ───────────────

export type ScheduledDeps = {
  wp: Wp;
  store: PubStore;
  /** The article as saved now: its title, HTML and when it last changed. Null when it was deleted. */
  doc: () => Promise<{ title: string; html: string; updatedAt: string } | null>;
};
export type ScheduledOutcome = "stale" | "gone" | "edited" | "published" | "updated" | "unchanged" | "busy";

/**
 * At the scheduled time: make sure the post is live, with the article as it is now.
 * Idempotent: it never creates a post when one exists, runs again harmlessly, and does nothing if the schedule
 * was changed or cleared since it was queued.
 */
export async function runScheduled(deps: ScheduledDeps, payload: { pubId: string; at: string }, now = new Date()): Promise<ScheduledOutcome> {
  const { wp, store } = deps;
  let pub = await store.byId(payload.pubId);
  if (!pub || pub.mode !== "schedule" || !pub.scheduled_for || Date.parse(pub.scheduled_for) !== Date.parse(payload.at)) return "stale";
  const doc = await deps.doc();
  if (!doc) return "gone";
  if (pub.remote_id) {
    pub = await syncPub(wp, store, pub, now);
    // Deleted or trashed in WordPress: someone meant it. Never make a new post from a job.
    if (pub.remote_status === "deleted" || pub.remote_status === "trash") return "gone";
    const changed = !pub.pushed_at || Date.parse(doc.updatedAt) > Date.parse(pub.pushed_at) + 1000;
    if (editedInWp(pub)) {
      // Edited by hand in WordPress after it was scheduled: never overwrite that. Only finish WordPress's own schedule.
      if (pub.remote_status !== "future") return "edited";
      return (await setLive(wp, store, pub, now)) ? "published" : "busy";
    }
    if (!changed) {
      if (pub.remote_status === "publish") {
        await store.update(pub.id, { mode: "publish", scheduled_for: null });
        return "unchanged";
      }
      return (await setLive(wp, store, pub, now)) ? "published" : "busy";
    }
  }
  // The article changed since it was sent (or never reached the site): send it as it is now, live.
  const had = Boolean(pub.remote_id);
  try {
    await publishToWp(wp, store, { workspaceId: pub.workspace_id, docId: pub.doc_id, connectionId: pub.connection_id, title: doc.title, html: doc.html, mode: "publish", options: pub.options ?? {} }, now);
  } catch (e) {
    if (e instanceof PublishError && e.code === "busy") return "busy";
    throw e;
  }
  return had ? "updated" : "published";
}

/** Set an existing post live, nothing else. */
async function setLive(wp: Wp, store: PubStore, pub: Pub, now: Date): Promise<boolean> {
  if (!(await store.lock(pub.id, LOCK_S))) return false;
  try {
    const r = await wp.req("POST", `/wp/v2/posts/${encodeURIComponent(pub.remote_id!)}?_fields=id,link,status,modified_gmt`, { status: "publish", date_gmt: wpDate(now.toISOString()) });
    if (r.status >= 300) throw failure(r, "publish the post");
    const d = obj(r.data);
    const at = now.toISOString();
    await store.update(pub.id, { remote_status: String(d.status ?? "publish") as WpStatus, url: (d.link as string) || pub.url, remote_modified: gmt(d.modified_gmt), pushed_modified: gmt(d.modified_gmt), mode: "publish", scheduled_for: null, pushed_at: at, synced_at: at, last_error: null });
    return true;
  } finally {
    await store.update(pub.id, { locked_until: null }).catch(() => {});
  }
}

/** The job key: one job per publication and scheduled time. */
export const scheduleKey = (pubId: string, at: string) => `wp_publish:${pubId}:${hashId(new Date(at).toISOString())}`;
