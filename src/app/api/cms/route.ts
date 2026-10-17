import { CMS_API } from "@/lib/cms";
import { CMS, mayPublish, showMoveNotice, type CmsKind, type Published, type PublishInput } from "@/lib/cmsTypes";
import { adminClient, requireRole } from "@/lib/serverAuth";
import { requireWriter } from "@/lib/entitlements";
import { dispatch } from "@/lib/integrations";
import type { DocPublishMeta } from "@/lib/writerAgent";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueue } from "@/lib/jobs";
import { PublishError, publishToWp, scheduleKey, statusFor, syncPub, versionAtLeast, PLUGIN_MIN, type Mode, type Pub } from "@/lib/wpSync";
import { mirrorMeta, PUB_COLS, pubStore, pubView, SYNC_SETUP, wpClient } from "@/lib/wpSyncServer";

const str = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const err = (error: string, status = 400) => Response.json({ error }, { status });
const COLS = "id, kind, name, created_at, brand_id, backfilled";
const SETUP = "Run supabase/048_brand_integrations.sql in Supabase so each brand has its own publishing sites.";

/** A draft and the brand it belongs to (draft → website → brand), read with the person's own access. */
async function draftBrand(
  sb: SupabaseClient,
  docId: string,
): Promise<{ failed: { message: string } } | { doc: { id: string; site_id: string; calendar_item_id: string | null; meta: unknown }; workspace_id: string; brand_id: string | null } | null> {
  const { data: doc, error } = await sb.from("docs").select("id, site_id, calendar_item_id, meta").eq("id", docId).maybeSingle();
  if (error) return { failed: error };
  if (!doc) return null;
  const { data: site } = await sb.from("sites").select("workspace_id, brand_id").eq("id", doc.site_id).maybeSingle();
  return { doc, workspace_id: (site?.workspace_id as string | undefined) ?? "", brand_id: (site?.brand_id as string | null | undefined) ?? null };
}

// Publishing sites (CMS connections), one brand each, and publishing. Keys stay on the server: the browser only sees each site's name and kind.
//   list: { brandId? | docId? }                one brand's sites (the draft's brand with docId), or the whole workspace's   viewers
//   connect: { kind, name, config, brandId? }  admins, tested before it is saved; without brandId it goes to the first brand
//   move: { id, brandId }                      admins: give a site to another brand
//   dismiss: {}                                admins: hide the one-time notice to move sites
//   remove: { id }                             admins
//   publish: { docId, connectionId, live, title, html, slug, description, image, schema }   editors, only to the draft's own brand's sites
//            WordPress also takes { mode: draft|publish|schedule, scheduleAt, categoryId, tags, metaTitle, asNew }
//   publish_info: { docId }                    the draft's brand's sites, where the draft went (WordPress), and defaults from its plan
//   wp_site: { docId, connectionId }           a WordPress site's categories and whether the Arrowsterr plugin is on it
//   sync: { docId }                            read each WordPress post back: status, address, last edit, or deleted
const READS = new Set(["list", "publish_info", "wp_site", "sync"]);
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const min = READS.has(body.action) ? "viewer" : body.action === "publish" ? "editor" : "admin";
  const auth = await requireRole(request, body.workspaceId, min);
  if ("denied" in auth) return auth.denied;
  const db = adminClient();
  if (!db) return err("Add SUPABASE_SECRET_KEY to the server's settings to connect a CMS.", 500);
  const ws = String(body.workspaceId);
  const missing = (e: { message: string } | null) => e && /cms_connections|meta/.test(e.message);
  const noBrandCol = (e: { message: string } | null) => e && /brand_id|backfilled/.test(e.message);
  /** The brand's id, if it is in this workspace. */
  const brandIn = async (id: unknown) => {
    if (!id) return null;
    const { data } = await auth.sb.from("brands").select("id").eq("id", str(id, 60)).eq("workspace_id", ws).maybeSingle();
    return (data?.id as string | undefined) ?? null;
  };

  if (body.action === "list") {
    let brandId: string | null = null;
    if (body.docId) {
      const d = await draftBrand(auth.sb, str(body.docId, 60));
      if (!d || "failed" in d) return err("Draft not found.", 404);
      if (!d.brand_id) return Response.json({ connections: [] });
      brandId = d.brand_id;
    } else if (body.brandId) {
      brandId = await brandIn(body.brandId);
      if (!brandId) return err("That brand is not in this workspace.", 404);
    }
    const { data, error } = await db.from("cms_connections").select(COLS).eq("workspace_id", ws).order("created_at");
    if (noBrandCol(error)) return Response.json({ connections: [], setup: SETUP });
    if (missing(error)) return Response.json({ connections: [], setup: "Run supabase/021_doc_meta.sql in Supabase to connect a CMS." });
    if (error) return err(error.message, 500);
    const all = data ?? [];
    if (!brandId) return Response.json({ connections: all });
    const { count } = await auth.sb.from("brands").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
    return Response.json({ connections: all.filter((c) => c.brand_id === brandId), notice: showMoveNotice(count ?? 0, all) });
  }

  if (body.action === "connect") {
    const spec = CMS.find((c) => c.id === body.kind);
    if (!spec) return err("Pick a CMS.");
    // A site belongs to one brand. Without one named (an older screen), it goes to the first brand, like the sites from before.
    let brandId = await brandIn(body.brandId);
    if (body.brandId && !brandId) return err("That brand is not in this workspace.", 404);
    if (!brandId) {
      const { data: first } = await auth.sb.from("brands").select("id").eq("workspace_id", ws).order("created_at").limit(1).maybeSingle();
      brandId = (first?.id as string | undefined) ?? null;
    }
    if (!brandId) return err("Add a brand first.");
    const config: Record<string, string> = {};
    for (const f of spec.fields) {
      const v = str(body.config?.[f.id], 2000);
      if (!v && !f.optional) return err(`Enter the ${f.label.toLowerCase()}.`);
      if (v) config[f.id] = v;
    }
    let check: string;
    try {
      check = await CMS_API[spec.id].test(config);
    } catch (e) {
      return err(`${spec.label} said no: ${e instanceof Error ? e.message : String(e)}`);
    }
    const name = str(body.name, 80) || config.siteUrl || config.shop || spec.label;
    const { data, error } = await db.from("cms_connections").insert({ workspace_id: ws, brand_id: brandId, kind: spec.id, name, config }).select(COLS).single();
    if (noBrandCol(error)) return err(SETUP, 500);
    if (missing(error)) return err("Run supabase/021_doc_meta.sql in Supabase first.", 500);
    if (error) return err(error.message, 500);
    return Response.json({ connection: data, check });
  }

  if (body.action === "move") {
    const brandId = await brandIn(body.brandId);
    if (!brandId) return err("That brand is not in this workspace.", 404);
    const { data, error } = await db.from("cms_connections").update({ brand_id: brandId, backfilled: false }).eq("id", str(body.id, 60)).eq("workspace_id", ws).select(COLS).maybeSingle();
    if (noBrandCol(error)) return err(SETUP, 500);
    if (error) return err(error.message, 500);
    if (!data) return err("Site not found.", 404);
    return Response.json({ connection: data });
  }

  if (body.action === "dismiss") {
    const { error } = await db.from("cms_connections").update({ backfilled: false }).eq("workspace_id", ws).eq("backfilled", true);
    if (error && !noBrandCol(error)) return err(error.message, 500);
    return Response.json({ ok: true });
  }

  if (body.action === "remove") {
    const { error } = await db.from("cms_connections").delete().eq("id", str(body.id, 60)).eq("workspace_id", ws);
    if (error) return err(error.message, 500);
    return Response.json({ ok: true });
  }

  /** A site of the draft's own brand, with its keys. Null for anything else: another brand's site is never touched. */
  const brandSite = async (docId: unknown, connectionId: unknown) => {
    const d = await draftBrand(auth.sb, str(docId, 60));
    if (!d || "failed" in d) return null;
    const { data: conn } = await db.from("cms_connections").select("id, brand_id, kind, name, config").eq("id", str(connectionId, 60)).eq("workspace_id", ws).maybeSingle();
    if (!conn || !mayPublish({ workspace_id: ws, brand_id: (conn.brand_id as string | null) ?? null }, d)) return null;
    return { d, conn };
  };
  /** The draft's WordPress records, for its own brand's sites only. */
  const docPubs = async (docId: string, brandId: string | null) => {
    const none = { pubs: [] as Pub[], conns: new Map<string, Record<string, string>>() };
    if (!brandId) return none;
    const { data: conns } = await db.from("cms_connections").select("id, config").eq("workspace_id", ws).eq("brand_id", brandId).eq("kind", "wordpress");
    const ids = (conns ?? []).map((c) => c.id as string);
    if (!ids.length) return none;
    const { data, error } = await db.from("doc_publications").select(PUB_COLS).eq("doc_id", docId).in("connection_id", ids);
    if (error) throw new Error(/doc_publications/.test(error.message) ? SYNC_SETUP : error.message);
    return { pubs: (data ?? []) as Pub[], conns: new Map((conns ?? []).map((c) => [c.id as string, c.config as Record<string, string>])) };
  };

  if (body.action === "publish_info") {
    const d = await draftBrand(auth.sb, str(body.docId, 60));
    if (!d || "failed" in d) return err("Draft not found.", 404);
    const { data: all, error } = await db.from("cms_connections").select(COLS).eq("workspace_id", ws).order("created_at");
    if (noBrandCol(error)) return Response.json({ connections: [], publications: [], defaults: {}, setup: SETUP });
    const connections = d.brand_id ? (all ?? []).filter((c) => c.brand_id === d.brand_id) : [];
    let publications: ReturnType<typeof pubView>[] = [];
    let setup = "";
    try {
      publications = (await docPubs(d.doc.id, d.brand_id)).pubs.map(pubView);
    } catch (e) {
      setup = e instanceof Error ? e.message : String(e);
    }
    // Defaults from the plan piece the draft was written for: its date, and the brief's slug, title and description.
    let plan: { due_date?: string | null; slug?: string | null; meta?: string | null; titles?: unknown } = {};
    if (d.doc.calendar_item_id) {
      const { data } = await auth.sb.from("calendar_items").select("due_date, slug:brief->brief->>slug, meta:brief->brief->>metaDescription, titles:brief->brief->titles").eq("id", d.doc.calendar_item_id).maybeSingle();
      plan = (data ?? {}) as typeof plan;
    }
    const defaults = {
      dueDate: plan.due_date ?? null,
      slug: String(plan.slug ?? "").split("/").filter(Boolean).pop() ?? "",
      metaTitle: Array.isArray(plan.titles) ? String(plan.titles[0] ?? "") : "",
      metaDescription: String(plan.meta ?? ""),
    };
    return Response.json({ connections, publications, defaults, setup });
  }

  if (body.action === "wp_site") {
    const s = await brandSite(body.docId, body.connectionId);
    if (!s || s.conn.kind !== "wordpress") return err("Site not found.", 404);
    const wp = wpClient(s.conn.config as Record<string, string>);
    try {
      const status = await wp.req("GET", "/arrowsterr/v1/status").catch(() => ({ status: 0, data: {} }));
      const cats = await wp.req("GET", "/wp/v2/categories?per_page=100&orderby=name&_fields=id,name,parent");
      if (cats.status === 401 || cats.status === 403) return err("WordPress refused the sign-in. Check the site's username and application password in Settings → Brand.", 502);
      const version = status.status === 200 ? String((status.data as { version?: string }).version ?? "") : "";
      const categories = Array.isArray(cats.data) ? (cats.data as { id: number; name: string }[]).map((c) => ({ id: c.id, name: c.name.replace(/&amp;/g, "&").replace(/&#0?39;/g, "'") })) : [];
      return Response.json({ categories, plugin: version ? { version, current: versionAtLeast(version, PLUGIN_MIN) } : null });
    } catch (e) {
      return err(`Could not reach ${s.conn.name}: ${e instanceof Error ? e.message : String(e)}`, 502);
    }
  }

  if (body.action === "sync") {
    const d = await draftBrand(auth.sb, str(body.docId, 60));
    if (!d || "failed" in d) return err("Draft not found.", 404);
    let found: Awaited<ReturnType<typeof docPubs>>;
    try {
      found = await docPubs(d.doc.id, d.brand_id);
    } catch (e) {
      return Response.json({ publications: [], setup: e instanceof Error ? e.message : String(e) });
    }
    const store = pubStore(db);
    const errors: Record<string, string> = {};
    const out = await Promise.all(
      found.pubs.map(async (p) => {
        const config = found.conns.get(p.connection_id);
        if (!config || !p.remote_id) return p;
        try {
          return await syncPub(wpClient(config), store, p);
        } catch (e) {
          errors[p.connection_id] = e instanceof Error ? e.message : String(e);
          return p;
        }
      }),
    );
    await mirrorMeta(db, d.doc.id).catch(() => {});
    // A post WordPress put live on its own (a schedule it ran) marks the plan piece published.
    const live = out.find((p) => p.remote_status === "publish");
    if (live && d.doc.calendar_item_id) await auth.sb.from("calendar_items").update({ status: "published", ...(live.url ? { url: live.url } : {}) }).eq("id", d.doc.calendar_item_id).neq("status", "published");
    return Response.json({ publications: out.map((p) => ({ ...pubView(p), ...(errors[p.connection_id] ? { syncError: errors[p.connection_id] } : {}) })) });
  }

  if (body.action === "publish") {
    const locked = await requireWriter(ws);
    if (locked) return locked;
    const { data: conn, error: connErr } = await db.from("cms_connections").select("id, brand_id, kind, config").eq("id", str(body.connectionId, 60)).eq("workspace_id", ws).maybeSingle();
    if (noBrandCol(connErr)) return err(SETUP, 500);
    if (!conn) return err("Connect a publishing site in Settings → Brand first.", 404);
    // The draft must belong to this workspace; read it with the person's own access.
    const d = await draftBrand(auth.sb, str(body.docId, 60));
    if (d && "failed" in d) return err(missing(d.failed) ? "Run supabase/021_doc_meta.sql in Supabase first." : d.failed.message, 500);
    if (!d) return err("Draft not found.", 404);
    // A brand's article publishes only to that brand's sites.
    if (!mayPublish({ workspace_id: ws, brand_id: (conn.brand_id as string | null) ?? null }, d)) return err("That site belongs to another brand. Pick one of this brand's sites.", 403);
    const doc = d.doc;
    const meta = (doc.meta ?? {}) as DocPublishMeta & { published?: Published[] };
    // Never cut an article short: a cut can land inside a module or a tag.
    const html = String(body.html ?? "");
    if (html.length > 6_000_000) return err("This article is too large to publish.", 413);
    const input: PublishInput = {
      title: str(body.title, 300) || "Untitled",
      html,
      slug: str(body.slug, 120),
      description: str(body.description, 400),
      image: /^https?:\/\//.test(str(body.image, 1000)) ? str(body.image, 1000) : "",
      schema: str(body.schema, 50_000),
      live: Boolean(body.live),
    };
    if (conn.kind === "wordpress") return publishWordPress(db, auth.sb, ws, doc, conn as { id: string; config: Record<string, string> }, input, body);
    const before = meta.published?.find((p) => p.connectionId === conn.id);
    try {
      const out = await CMS_API[conn.kind as CmsKind].publish(conn.config as Record<string, string>, input, before?.id);
      const rec: Published = { connectionId: conn.id, kind: conn.kind as CmsKind, id: out.id, url: out.url, live: input.live, at: new Date().toISOString() };
      const next = { ...meta, title: input.title, slug: input.slug, description: input.description, image: input.image, schema: input.schema, published: [...(meta.published ?? []).filter((p) => p.connectionId !== conn.id), rec] };
      await auth.sb.from("docs").update({ meta: next }).eq("id", doc.id);
      if (input.live && doc.calendar_item_id) await auth.sb.from("calendar_items").update({ status: "published", ...(out.url ? { url: out.url } : {}) }).eq("id", doc.calendar_item_id);
      if (input.live) await dispatch(db, ws, "post.published", { title: input.title, url: out.url, cms: conn.kind }).catch(() => {});
      return Response.json({ published: rec });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("Publish failed:", message);
      return err(`Could not publish: ${message}`, 502);
    }
  }

  return err("Unknown action.");
}

const MODES: Mode[] = ["draft", "publish", "schedule"];

/** WordPress: one post per article and site, kept in sync (wpSync.ts). */
async function publishWordPress(
  db: SupabaseClient,
  sb: SupabaseClient,
  ws: string,
  doc: { id: string; calendar_item_id: string | null },
  conn: { id: string; config: Record<string, string> },
  input: PublishInput,
  body: Record<string, unknown>,
) {
  const mode: Mode = MODES.includes(body.mode as Mode) ? (body.mode as Mode) : input.live ? "publish" : "draft";
  let scheduleAt: string | null = null;
  if (mode === "schedule") {
    const t = Date.parse(str(body.scheduleAt, 40));
    if (!Number.isFinite(t)) return err("Pick a date and time to publish.");
    scheduleAt = new Date(t).toISOString();
  }
  const tags = (Array.isArray(body.tags) ? body.tags : String(body.tags ?? "").split(","))
    .map((t) => str(t, 60))
    .filter(Boolean)
    .slice(0, 20);
  const options = {
    slug: input.slug.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 120),
    categoryId: Number(body.categoryId) > 0 ? Math.floor(Number(body.categoryId)) : null,
    tags,
    metaTitle: str(body.metaTitle, 300),
    metaDescription: input.description,
    image: input.image,
    schema: input.schema,
  };
  try {
    const { pub, warnings } = await publishToWp(wpClient(conn.config), pubStore(db), { workspaceId: ws, docId: doc.id, connectionId: conn.id, title: input.title, html: input.html, mode, scheduleAt, options, asNew: Boolean(body.asNew) });
    await mirrorMeta(db, doc.id, { title: input.title, slug: options.slug, description: input.description, image: input.image, schema: input.schema }).catch((e) => console.error("Publish meta failed:", e instanceof Error ? e.message : e));
    const live = pub.remote_status === "publish";
    if (live && doc.calendar_item_id) await sb.from("calendar_items").update({ status: "published", ...(pub.url ? { url: pub.url } : {}) }).eq("id", doc.calendar_item_id);
    if (live) await dispatch(db, ws, "post.published", { title: input.title, url: pub.url, cms: "wordpress" }).catch(() => {});
    // On the date, make sure it went live with the article as it is then (WordPress's own schedule can miss).
    if (mode === "schedule" && scheduleAt && statusFor(mode, scheduleAt, new Date()).status === "future") {
      await enqueue("wp_publish", { pubId: pub.id, at: scheduleAt }, { workspaceId: ws, key: scheduleKey(pub.id, scheduleAt), runAt: new Date(Date.parse(scheduleAt) + 90_000), maxAttempts: 8 }).catch((e) =>
        console.error("Scheduling the publish job failed:", e instanceof Error ? e.message : e),
      );
    }
    const published: Published = { connectionId: conn.id, kind: "wordpress", id: pub.remote_id ?? "", url: pub.url, live, at: pub.pushed_at ?? new Date().toISOString(), status: pub.remote_status ?? undefined };
    return Response.json({ published, publication: pubView(pub), warnings });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof PublishError && (e.code === "busy" || e.code === "deleted")) return Response.json({ error: message, code: e.code }, { status: 409 });
    console.error("Publish failed:", message);
    return err(message.startsWith("WordPress") || message === SYNC_SETUP ? message : `Could not publish: ${message}`, 502);
  }
}
