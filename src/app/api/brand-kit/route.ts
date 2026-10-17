import { learnKit } from "@/lib/brandKitServer";
import { take } from "@/lib/entitlements";
import { meteredRoute, streamed } from "@/lib/meter";
import { TASK_COST } from "@/lib/plans";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { normalizeSite } from "@/lib/site";

// Learn a Brand Kit from a website and save it (docs/reports.md, section 31). Every plan has a Brand Kit.
//   { website, brandId? }  brandId learns a client brand's kit; without it, the workspace's own.
//   { action: "confirm", brandId? }  marks the kit as looked at and right.
// The reply is one JSON object per line (KitPart in src/lib/brandKit.ts): each part as it lands, then the kit, or an error.
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  // { action: "confirm", brandId? }: someone said the learned kit looks right.
  if (body.action === "confirm") {
    const key = typeof body.brandId === "string" && body.brandId ? body.brandId : "workspace";
    const { error } = await auth.sb.from("brand_kits").update({ confirmed_at: new Date().toISOString() }).eq("workspace_id", body.workspaceId).eq("key", key);
    return error ? Response.json({ error: error.message }, { status: 500 }) : Response.json({ ok: true });
  }
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });
  const site = normalizeSite(String(body.website ?? ""));
  if (!site) return Response.json({ error: "Enter a website, like acme.com." }, { status: 400 });

  const brandId = typeof body.brandId === "string" && body.brandId ? body.brandId : null;
  if (brandId) {
    const { data } = await auth.sb.from("brands").select("id").eq("id", brandId).eq("workspace_id", body.workspaceId).maybeSingle();
    if (!data) return Response.json({ error: "That brand is not in this workspace." }, { status: 404 });
  }
  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;
  const took = await take(body.workspaceId, "tasks", TASK_COST.guideline);
  if (!took.ok) return took.response;

  // no-transform keeps gzip from holding lines back until the end.
  const out = new TransformStream<string, string>();
  const writer = out.writable.getWriter();
  const line = (x: unknown) => writer.write(JSON.stringify(x) + "\n").catch(() => {});
  const work = learnKit(site.domain, line)
    .then(async ({ kit, why }) => {
      const now = new Date().toISOString();
      const { error } = await auth.sb
        .from("brand_kits")
        .upsert({ workspace_id: body.workspaceId, key: brandId ?? "workspace", brand_id: brandId, website: site.domain, kit, learned_at: now, confirmed_at: null, updated_at: now }, { onConflict: "workspace_id,key" });
      if (error) console.error("Brand Kit save failed:", error.message);
      line({ part: "done", kit, why, saved: !error });
      return true;
    })
    .catch((e) => {
      const message = e instanceof Error ? e.message : String(e);
      console.error("Brand Kit failed:", message);
      line({ part: "error", error: message });
      return false;
    })
    .finally(() => writer.close().catch(() => {}));
  const headers = { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" };
  return streamed(new Response(out.readable.pipeThrough(new TextEncoderStream()), { headers }), work);
}

export const POST = meteredRoute("brand kit", handle);
