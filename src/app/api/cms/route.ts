import { CMS_API } from "@/lib/cms";
import { CMS, type CmsKind, type Published, type PublishInput } from "@/lib/cmsTypes";
import { adminClient, requireRole } from "@/lib/serverAuth";
import type { DocPublishMeta } from "@/lib/writerAgent";

const str = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const err = (error: string, status = 400) => Response.json({ error }, { status });

// CMS connections and publishing. Keys stay on the server: the browser only sees each connection's name and kind.
//   list: {}                                   viewers
//   connect: { kind, name, config }            admins, tested before it is saved
//   remove: { id }                             admins
//   publish: { docId, connectionId, live, title, html, slug, description, image, schema }   editors
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const min = body.action === "list" ? "viewer" : body.action === "publish" ? "editor" : "admin";
  const auth = await requireRole(request, body.workspaceId, min);
  if ("denied" in auth) return auth.denied;
  const db = adminClient();
  if (!db) return err("Add SUPABASE_SECRET_KEY on Render to connect a CMS.", 500);
  const ws = String(body.workspaceId);
  const missing = (e: { message: string } | null) => e && /cms_connections|meta/.test(e.message);

  if (body.action === "list") {
    const { data, error } = await db.from("cms_connections").select("id, kind, name, created_at").eq("workspace_id", ws).order("created_at");
    if (missing(error)) return Response.json({ connections: [], setup: "Run supabase/021_doc_meta.sql in Supabase to connect a CMS." });
    if (error) return err(error.message, 500);
    return Response.json({ connections: data });
  }

  if (body.action === "connect") {
    const spec = CMS.find((c) => c.id === body.kind);
    if (!spec) return err("Pick a CMS.");
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
    const { data, error } = await db.from("cms_connections").insert({ workspace_id: ws, kind: spec.id, name, config }).select("id, kind, name, created_at").single();
    if (missing(error)) return err("Run supabase/021_doc_meta.sql in Supabase first.", 500);
    if (error) return err(error.message, 500);
    return Response.json({ connection: data, check });
  }

  if (body.action === "remove") {
    const { error } = await db.from("cms_connections").delete().eq("id", str(body.id, 60)).eq("workspace_id", ws);
    if (error) return err(error.message, 500);
    return Response.json({ ok: true });
  }

  if (body.action === "publish") {
    const { data: conn } = await db.from("cms_connections").select("id, kind, config").eq("id", str(body.connectionId, 60)).eq("workspace_id", ws).maybeSingle();
    if (!conn) return err("Connect a CMS in Workspace settings first.", 404);
    // The draft must belong to this workspace; read it with the person's own access.
    const { data: doc, error: docErr } = await auth.sb.from("docs").select("id, calendar_item_id, meta").eq("id", str(body.docId, 60)).maybeSingle();
    if (missing(docErr)) return err("Run supabase/021_doc_meta.sql in Supabase first.", 500);
    if (!doc) return err("Draft not found.", 404);
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
      return Response.json({ published: rec });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("Publish failed:", message);
      return err(`Could not publish: ${message}`, 502);
    }
  }

  return err("Unknown action.");
}
