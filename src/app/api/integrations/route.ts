import { entitlement } from "@/lib/entitlements";
import { newKey, slackSend } from "@/lib/integrations";
import { DEFAULT_ALERT_POINTS, SLACK_HOOK } from "@/lib/integrationTypes";
import { adminClient, requireRole } from "@/lib/serverAuth";

const err = (error: string, status = 400) => Response.json({ error }, { status });
const SETUP = "Run supabase/024_integrations.sql in Supabase first.";

// Slack, API keys and webhooks for a workspace. Secrets stay on the server; the page sees only names and prefixes.
//   get: {}                                  viewers
//   slack: { url, points }                   admins: save and send a test message
//   slackOff: {}                             admins
//   points: { points }                       admins
//   key: { name }                            admins: returns the key once
//   revoke: { id }                           admins
//   unhook: { id }                           admins
// One brand's Slack channel and alert size, each falling back to the workspace's:
//   brandGet: { brandId }                    viewers
//   brandSlack: { brandId, url }             admins: save and send a test message
//   brandSlackOff: { brandId }               admins: back to the workspace's channel
//   brandPoints: { brandId, points | null }  admins: null goes back to the workspace's alert size
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, body.action === "get" || body.action === "brandGet" ? "viewer" : "admin");
  if ("denied" in auth) return auth.denied;
  const db = adminClient();
  if (!db) return err("Add SUPABASE_SECRET_KEY to the server's settings.", 500);
  const ws = String(body.workspaceId);
  const e = await entitlement(ws);

  if (typeof body.action === "string" && body.action.startsWith("brand")) {
    const { data: brand } = await auth.sb.from("brands").select("id, name").eq("id", String(body.brandId ?? "")).eq("workspace_id", ws).maybeSingle();
    if (!brand) return err("That brand is not in this workspace.", 404);
    const BRAND_SETUP = "Run supabase/048_brand_integrations.sql in Supabase first.";
    const save = async (patch: { slack_channel?: string | null; alert_points?: number | null }) => {
      const { error } = await db.from("brand_settings").upsert({ brand_id: brand.id, workspace_id: ws, ...patch, updated_at: new Date().toISOString() }, { onConflict: "brand_id" });
      if (error) return err(/brand_settings/.test(error.message) ? BRAND_SETUP : error.message, 500);
      return Response.json({ ok: true });
    };
    if (body.action === "brandGet") {
      const [cfg, own] = await Promise.all([
        db.from("integrations").select("slack_webhook, alert_points").eq("workspace_id", ws).maybeSingle(),
        db.from("brand_settings").select("slack_channel, alert_points").eq("brand_id", brand.id).maybeSingle(),
      ]);
      if (own.error && /brand_settings/.test(own.error.message)) return Response.json({ allowed: e.limits.alerts, setup: BRAND_SETUP });
      return Response.json({
        allowed: e.limits.alerts,
        slack: Boolean(own.data?.slack_channel),
        workspaceSlack: Boolean(cfg.data?.slack_webhook),
        points: own.data?.alert_points ?? null,
        defaultPoints: cfg.data?.alert_points ?? DEFAULT_ALERT_POINTS,
      });
    }
    if (!e.limits.alerts) return Response.json({ error: "Slack, Zapier and the API are on Pro and up.", limit: true, boost: "scale" }, { status: 429 });
    if (body.action === "brandSlack") {
      const url = String(body.url ?? "").trim();
      if (!SLACK_HOOK.test(url)) return err("Paste a Slack webhook URL. It starts with https://hooks.slack.com/services/.");
      try {
        await slackSend(url, `Arrowsterr alerts for ${brand.name}`, [`You'll get a message here when ${brand.name}'s AI visibility moves or a competitor overtakes it.`]);
      } catch (x) {
        return err(`Slack said no: ${x instanceof Error ? x.message : String(x)}`);
      }
      return save({ slack_channel: url });
    }
    if (body.action === "brandSlackOff") return save({ slack_channel: null });
    if (body.action === "brandPoints") return save({ alert_points: body.points === null ? null : Math.min(50, Math.max(1, Number(body.points) || DEFAULT_ALERT_POINTS)) });
    return err("Unknown action.");
  }

  if (body.action === "get") {
    const [cfg, keys, hooks] = await Promise.all([
      db.from("integrations").select("slack_webhook, alert_points").eq("workspace_id", ws).maybeSingle(),
      db.from("api_keys").select("id, name, prefix, created_at, last_used_at").eq("workspace_id", ws).is("revoked_at", null).order("created_at"),
      db.from("webhooks").select("id, url, event, source, created_at").eq("workspace_id", ws).order("created_at"),
    ]);
    if (cfg.error && /integrations/.test(cfg.error.message)) return Response.json({ allowed: e.limits.alerts, setup: SETUP });
    return Response.json({
      allowed: e.limits.alerts,
      slack: Boolean(cfg.data?.slack_webhook),
      points: cfg.data?.alert_points ?? 5,
      keys: keys.data ?? [],
      hooks: (hooks.data ?? []).map((h) => ({ ...h, url: h.url.replace(/^(https?:\/\/[^/]+).*/, "$1/…") })),
    });
  }
  if (!e.limits.alerts) return Response.json({ error: "Slack, Zapier and the API are on Pro and up.", limit: true, boost: "scale" }, { status: 429 });

  if (body.action === "slack") {
    const url = String(body.url ?? "").trim();
    if (!/^https:\/\/hooks\.slack\.com\/services\/\S+$/.test(url)) return err("Paste a Slack webhook URL. It starts with https://hooks.slack.com/services/.");
    try {
      await slackSend(url, "Arrowsterr is connected", ["You'll get a message here when your AI visibility moves or a competitor overtakes you."]);
    } catch (x) {
      return err(`Slack said no: ${x instanceof Error ? x.message : String(x)}`);
    }
    const points = Math.min(50, Math.max(1, Number(body.points) || 5));
    const { error } = await db.from("integrations").upsert({ workspace_id: ws, slack_webhook: url, alert_points: points, updated_at: new Date().toISOString() });
    if (error) return err(/integrations/.test(error.message) ? SETUP : error.message, 500);
    return Response.json({ ok: true });
  }
  if (body.action === "slackOff") {
    await db.from("integrations").update({ slack_webhook: null }).eq("workspace_id", ws);
    return Response.json({ ok: true });
  }
  if (body.action === "points") {
    const points = Math.min(50, Math.max(1, Number(body.points) || 5));
    const { error } = await db.from("integrations").upsert({ workspace_id: ws, alert_points: points, updated_at: new Date().toISOString() });
    if (error) return err(/integrations/.test(error.message) ? SETUP : error.message, 500);
    return Response.json({ ok: true });
  }
  if (body.action === "key") {
    const name = String(body.name ?? "").trim().slice(0, 60) || "API key";
    const k = newKey();
    const { data, error } = await db.from("api_keys").insert({ workspace_id: ws, name, prefix: k.prefix, hash: k.hash }).select("id, name, prefix, created_at, last_used_at").single();
    if (error) return err(/api_keys/.test(error.message) ? SETUP : error.message, 500);
    return Response.json({ key: k.key, row: data });
  }
  if (body.action === "revoke") {
    await db.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", String(body.id)).eq("workspace_id", ws);
    return Response.json({ ok: true });
  }
  if (body.action === "unhook") {
    await db.from("webhooks").delete().eq("id", String(body.id)).eq("workspace_id", ws);
    return Response.json({ ok: true });
  }
  return err("Unknown action.");
}
