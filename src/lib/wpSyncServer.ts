import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Published } from "./cmsTypes";
import { docToHtml } from "./docHtml";
import { finish, retry, type Job } from "./jobs";
import { safeFetch } from "./safeFetch";
import { editedInWp, runScheduled, type Pub, type PubStore, type Wp, type WpRes } from "./wpSync";

// WordPress and the database behind wpSync.ts: the signed-in REST client, image uploads, the doc_publications
// store (051_wp_sync.sql), the mirror in docs.meta.published the library reads, and the wp_publish job.

type Config = Record<string, string>;
const MAX_IMAGE = 15_000_000;
export const SYNC_SETUP = "Run supabase/051_wp_sync.sql in Supabase to publish to WordPress.";
export const PUB_COLS = "id, workspace_id, doc_id, connection_id, remote_id, url, remote_status, remote_modified, pushed_modified, mode, scheduled_for, options, media, creating_since, last_error, pushed_at, synced_at";

const base = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`).replace(/\/+$/, "");

/** A signed-in client for one WordPress site. Sites without pretty links answer on ?rest_route= instead of /wp-json. */
export function wpClient(c: Config): Wp {
  let root = base(c.siteUrl);
  const auth = `Basic ${Buffer.from(`${c.username}:${(c.appPassword ?? "").replace(/\s+/g, "")}`).toString("base64")}`;
  let plain = false;
  const address = (path: string) => {
    if (!plain) return `${root}/wp-json${path}`;
    const [p, q] = path.split("?");
    return `${root}/?rest_route=${encodeURIComponent(p)}${q ? `&${q}` : ""}`;
  };
  async function send(method: "GET" | "POST", path: string, body?: unknown, raw?: { bytes: Buffer; type: string; name: string }): Promise<WpRes> {
    const res = await fetch(address(path), {
      method,
      headers: {
        Authorization: auth,
        Accept: "application/json",
        ...(raw ? { "Content-Type": raw.type, "Content-Disposition": `attachment; filename="${raw.name}"` } : body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: raw ? new Uint8Array(raw.bytes) : body !== undefined ? JSON.stringify(body) : undefined,
      // A POST that follows a redirect turns into a GET, so only reads follow. Publishing always reads first,
      // so a site that moved (http → https, www) is found before anything is written.
      redirect: method === "GET" ? "follow" : "manual",
      signal: AbortSignal.timeout(raw ? 60_000 : 30_000),
    });
    if (res.redirected && !plain) {
      const i = res.url.indexOf("/wp-json/");
      if (i > 0) root = res.url.slice(0, i);
    }
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text.slice(0, 300), notJson: true };
    }
    return { status: res.status, data };
  }
  async function req(method: "GET" | "POST", path: string, body?: unknown, raw?: { bytes: Buffer; type: string; name: string }) {
    const r = await send(method, path, body, raw);
    // A 404 page that isn't JSON: the REST API lives at ?rest_route= on this site.
    if (!plain && r.status === 404 && (r.data as { notJson?: boolean }).notJson) {
      plain = true;
      return send(method, path, body, raw);
    }
    return r;
  }
  return {
    siteUrl: root,
    req: (method, path, body) => req(method, path, body),
    upload: async (src, alt) => {
      let bytes: Buffer | undefined;
      let type = "image/jpeg";
      let name = "image";
      const data = /^data:(image\/[\w.+-]+);base64,([\s\S]*)$/i.exec(src);
      if (data) {
        type = data[1].toLowerCase();
        bytes = Buffer.from(data[2], "base64");
      } else {
        // A public address only: never the server's own network.
        const got = await safeFetch(src, { raw: true, maxBytes: MAX_IMAGE, timeout: 20_000, accept: "image/*" });
        if (!got.ok || !got.bytes?.length) return null;
        type = (got.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
        bytes = got.bytes;
        name = new URL(got.url).pathname.split("/").pop() || "image";
      }
      if (!bytes.length || bytes.length > MAX_IMAGE || !/^image\/(jpeg|png|gif|webp|avif|svg\+xml)$/.test(type) || type === "image/svg+xml") return null;
      const ext = type.split("/")[1].replace("jpeg", "jpg");
      name = name.replace(/[^\w.-]/g, "").replace(/\.[^.]*$/, "").slice(0, 60) || "image";
      const r = await req("POST", "/wp/v2/media?_fields=id,source_url", undefined, { bytes, type, name: `${name}.${ext}` });
      const d = r.data as { id?: number; source_url?: string };
      if (r.status >= 300 || !d.id || !d.source_url) return null;
      if (alt) await req("POST", `/wp/v2/media/${d.id}?_fields=id`, { alt_text: alt.slice(0, 200) }).catch(() => null);
      return { id: Number(d.id), url: d.source_url };
    },
  };
}

/** The doc_publications table as wpSync.ts needs it. */
export function pubStore(db: SupabaseClient): PubStore {
  const one = async (q: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = await q;
    if (error) throw new Error(/doc_publications|lock_publication/.test(error.message) ? SYNC_SETUP : error.message);
    return (data as Pub | null) ?? null;
  };
  return {
    get: (docId, connectionId) => one(db.from("doc_publications").select(PUB_COLS).eq("doc_id", docId).eq("connection_id", connectionId).maybeSingle()),
    byId: (id) => one(db.from("doc_publications").select(PUB_COLS).eq("id", id).maybeSingle()),
    ensure: async (row) => {
      const { error } = await db.from("doc_publications").upsert({ ...row, kind: "wordpress" }, { onConflict: "doc_id,connection_id", ignoreDuplicates: true });
      if (error) throw new Error(/doc_publications/.test(error.message) ? SYNC_SETUP : error.message);
      const pub = await one(db.from("doc_publications").select(PUB_COLS).eq("doc_id", row.doc_id).eq("connection_id", row.connection_id).maybeSingle());
      if (!pub) throw new Error("Could not save the publishing record.");
      return pub;
    },
    lock: async (id, seconds) => {
      const { data, error } = await db.rpc("lock_publication", { p_id: id, p_seconds: seconds });
      if (error) throw new Error(/lock_publication/.test(error.message) ? SYNC_SETUP : error.message);
      return Boolean(data);
    },
    update: async (id, patch) => {
      const { error } = await db.from("doc_publications").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw new Error(error.message);
    },
  };
}

/** What the browser sees of a publication. */
export const pubView = (p: Pub) => ({
  id: p.id,
  connectionId: p.connection_id,
  remoteId: p.remote_id,
  url: p.url,
  status: p.remote_status,
  modified: p.remote_modified,
  edited: editedInWp(p),
  mode: p.mode,
  scheduledFor: p.scheduled_for,
  options: p.options ?? {},
  error: p.last_error,
  pushedAt: p.pushed_at,
  syncedAt: p.synced_at,
});
export type PubView = ReturnType<typeof pubView>;

/** Keep docs.meta.published (what the library reads) in step with the WordPress records. Other CMSs' entries stay. */
export async function mirrorMeta(db: SupabaseClient, docId: string, extra: Record<string, unknown> = {}) {
  const [{ data: doc }, { data: pubs }] = await Promise.all([
    db.from("docs").select("meta").eq("id", docId).maybeSingle(),
    db.from("doc_publications").select(PUB_COLS).eq("doc_id", docId),
  ]);
  if (!doc) return;
  const meta = (doc.meta ?? {}) as { published?: Published[] };
  const wpIds = new Set(((pubs ?? []) as Pub[]).map((p) => p.connection_id));
  const others = (meta.published ?? []).filter((p) => !(p.kind === "wordpress" && wpIds.has(p.connectionId)));
  const mine: Published[] = ((pubs ?? []) as Pub[])
    .filter((p) => p.remote_id)
    .map((p) => ({
      connectionId: p.connection_id,
      kind: "wordpress",
      id: p.remote_id!,
      url: p.remote_status === "deleted" ? null : p.url,
      live: p.remote_status === "publish",
      at: p.pushed_at ?? new Date().toISOString(),
      status: p.remote_status ?? undefined,
      ...(p.remote_status === "deleted" || p.remote_status === "trash" ? { deleted: true } : {}),
      ...(p.scheduled_for && p.remote_status === "future" ? { scheduledFor: p.scheduled_for } : {}),
    }));
  await db.from("docs").update({ meta: { ...meta, ...extra, published: [...others, ...mine] } }).eq("id", docId);
}

/** The article as saved, as HTML: for publishing without the editor open. */
export async function savedDoc(db: SupabaseClient, docId: string) {
  const { data } = await db.from("docs").select("title, content, updated_at").eq("id", docId).maybeSingle();
  if (!data) return null;
  return { title: String(data.title ?? "Untitled"), html: docToHtml(data.content), updatedAt: String(data.updated_at) };
}

// ─────────────── wp_publish: publish on the calendar date ───────────────
export async function wpPublishJob(db: SupabaseClient, job: Job) {
  const p = job.payload as { pubId: string; at: string };
  const store = pubStore(db);
  const pub = await store.byId(p.pubId);
  if (!pub) return finish(job.id);
  const { data: conn } = await db.from("cms_connections").select("kind, config").eq("id", pub.connection_id).maybeSingle();
  if (!conn || conn.kind !== "wordpress") return finish(job.id); // the site was disconnected
  const out = await runScheduled({ wp: wpClient(conn.config as Config), store, doc: () => savedDoc(db, pub.doc_id) }, p);
  if (out === "busy") return retry(job.id, "publishing", 60, { count: false });
  await mirrorMeta(db, pub.doc_id).catch(() => {});
  if (out === "published" || out === "updated" || out === "unchanged") {
    const fresh = await store.byId(pub.id);
    const { data: doc } = await db.from("docs").select("calendar_item_id").eq("id", pub.doc_id).maybeSingle();
    if (doc?.calendar_item_id && fresh?.remote_status === "publish") await db.from("calendar_items").update({ status: "published", ...(fresh.url ? { url: fresh.url } : {}) }).eq("id", doc.calendar_item_id);
  }
  await finish(job.id);
}
