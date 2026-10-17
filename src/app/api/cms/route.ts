import { CMS_API } from "@/lib/cms";
import { CMS, mayPublish, showMoveNotice, type CmsKind, type Published, type PublishInput } from "@/lib/cmsTypes";
import { adminClient, requireRole } from "@/lib/serverAuth";
import { requireWriter } from "@/lib/entitlements";
import { dispatch } from "@/lib/integrations";
import type { DocPublishMeta } from "@/lib/writerAgent";
import type { SupabaseClient } from "@supabase/supabase-js";

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
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const min = body.action === "list" ? "viewer" : body.action === "publish" ? "editor" : "admin";
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
    const input: PublishInput = {
      title: str(body.title, 300) || "Untitled",
      html: String(body.html ?? "").slice(0, 2_000_000),
      slug: str(body.slug, 120),
      description: str(body.description, 400),
      image: /^https?:\/\//.test(str(body.image, 1000)) ? str(body.image, 1000) : "",
      schema: str(body.schema, 50_000),
      live: Boolean(body.live),
    };
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
