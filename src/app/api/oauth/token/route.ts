import { newKey } from "@/lib/integrations";
import { OAUTH_CORS, oauthError, pkceOk, SCOPE, sha256, token } from "@/lib/oauth";
import { adminClient } from "@/lib/serverAuth";

// Swap a one-time code (or a refresh token) for an access token. The access token is a workspace
// API key, so it shows in Settings → Integrations, where it can be revoked like any other key.
export async function POST(request: Request) {
  const db = adminClient();
  if (!db) return oauthError("server_error", "OAuth is not set up on the server.", 500);
  const type = request.headers.get("content-type") ?? "";
  const raw = type.includes("application/json") ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : Object.fromEntries(new URLSearchParams(await request.text()));
  const p = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : "");
  const issue = (access: string, refresh: string) =>
    Response.json({ access_token: access, token_type: "Bearer", refresh_token: refresh, scope: SCOPE }, { headers: { ...OAUTH_CORS, "Cache-Control": "no-store", Pragma: "no-cache" } });

  if (p("grant_type") === "authorization_code") {
    const { data: code } = await db.from("oauth_codes").select("*").eq("hash", sha256(p("code"))).maybeSingle();
    if (!code || code.used_at || Date.parse(code.expires_at) < Date.now()) return oauthError("invalid_grant", "The code is wrong, used or expired. Connect again.");
    // Mark it used first, so the same code can never be swapped twice.
    const { data: claimed } = await db.from("oauth_codes").update({ used_at: new Date().toISOString() }).eq("hash", code.hash).is("used_at", null).select("hash");
    if (!claimed?.length) return oauthError("invalid_grant", "The code was already used.");
    if (code.client_id !== p("client_id") || code.redirect_uri !== p("redirect_uri")) return oauthError("invalid_grant", "The code was issued to a different app or return address.");
    if (!pkceOk(p("code_verifier"), code.code_challenge)) return oauthError("invalid_grant", "The code_verifier does not match.");
    const { data: client } = await db.from("oauth_clients").select("name").eq("id", code.client_id).maybeSingle();
    const k = newKey();
    const refresh = `awr_${token(32)}`;
    const { error } = await db.from("api_keys").insert({
      workspace_id: code.workspace_id,
      name: `${client?.name ?? "AI app"} (connected app)`.slice(0, 120),
      prefix: k.prefix,
      hash: k.hash,
      refresh_hash: sha256(refresh),
      client_id: code.client_id,
      created_by: code.user_id,
    });
    if (error) return oauthError("server_error", error.message, 500);
    return issue(k.key, refresh);
  }

  if (p("grant_type") === "refresh_token") {
    const { data: row } = await db.from("api_keys").select("id, client_id, revoked_at").eq("refresh_hash", sha256(p("refresh_token"))).maybeSingle();
    if (!row || row.revoked_at) return oauthError("invalid_grant", "This connection was removed. Connect again.");
    if (p("client_id") && row.client_id && p("client_id") !== row.client_id) return oauthError("invalid_grant", "The refresh token belongs to a different app.");
    // Rotate both: the old access token and refresh token stop working.
    const k = newKey();
    const refresh = `awr_${token(32)}`;
    const { error } = await db.from("api_keys").update({ prefix: k.prefix, hash: k.hash, refresh_hash: sha256(refresh) }).eq("id", row.id);
    if (error) return oauthError("server_error", error.message, 500);
    return issue(k.key, refresh);
  }

  return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS });
}
