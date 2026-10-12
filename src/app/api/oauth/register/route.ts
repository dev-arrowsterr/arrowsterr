import { OAUTH_CORS, oauthError, redirectOk, token } from "@/lib/oauth";
import { adminClient } from "@/lib/serverAuth";

// Dynamic client registration (RFC 7591): an AI app tells us its name and where to send people back.
export async function POST(request: Request) {
  const db = adminClient();
  if (!db) return oauthError("server_error", "OAuth is not set up on the server.", 500);
  const body = (await request.json().catch(() => ({}))) as { client_name?: unknown; redirect_uris?: unknown };
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string").slice(0, 10) : [];
  if (!uris.length || !uris.every(redirectOk)) return oauthError("invalid_redirect_uri", "Send redirect_uris: https addresses, a localhost port, or an app scheme.");
  const name = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 80) : "An AI app";
  const id = `awc_${token(18)}`;
  const { error } = await db.from("oauth_clients").insert({ id, name, redirect_uris: uris });
  if (error) return oauthError("server_error", error.message + (/oauth_clients/.test(error.message) ? " Run supabase/032_oauth.sql in Supabase." : ""), 500);
  return Response.json(
    {
      client_id: id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    { status: 201, headers: { ...OAUTH_CORS, "Cache-Control": "no-store" } },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS });
}
