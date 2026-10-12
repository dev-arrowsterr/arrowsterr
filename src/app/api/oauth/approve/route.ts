import { entitlement } from "@/lib/entitlements";
import { CODE_TTL, sha256, token } from "@/lib/oauth";
import { adminClient, requireRole } from "@/lib/serverAuth";

// The person approved an app for one workspace. Admins only, the same as making an API key.
// Returns where to send the browser: back to the app with a one-time code.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "admin");
  if ("denied" in auth) return auth.denied;
  const db = adminClient();
  if (!db) return Response.json({ error: "OAuth is not set up on the server." }, { status: 500 });
  const clientId = String(body.client_id ?? "");
  const redirect = String(body.redirect_uri ?? "");
  const challenge = String(body.code_challenge ?? "");
  const state = typeof body.state === "string" ? body.state : null;
  if (body.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return Response.json({ error: "The app must use PKCE with S256." }, { status: 400 });
  const { data: client } = await db.from("oauth_clients").select("redirect_uris").eq("id", clientId).maybeSingle();
  if (!client || !(client.redirect_uris as string[]).includes(redirect)) return Response.json({ error: "Unknown app or return address." }, { status: 400 });
  const { data: user } = await auth.sb.auth.getUser(request.headers.get("authorization")!.replace(/^Bearer\s+/i, ""));
  if (!user.user) return Response.json({ error: "Please sign in again." }, { status: 401 });

  const back = new URL(redirect);
  if (!body.deny && !(await entitlement(body.workspaceId)).limits.alerts) return Response.json({ error: "Connecting AI apps is on the Pro plan and up. Upgrade this workspace, or pick another one." }, { status: 403 });
  if (body.deny) {
    back.searchParams.set("error", "access_denied");
  } else {
    const code = token(32);
    const { error } = await db.from("oauth_codes").insert({
      hash: sha256(code),
      client_id: clientId,
      redirect_uri: redirect,
      code_challenge: challenge,
      workspace_id: body.workspaceId,
      user_id: user.user.id,
      expires_at: new Date(Date.now() + CODE_TTL).toISOString(),
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    back.searchParams.set("code", code);
  }
  if (state) back.searchParams.set("state", state);
  back.searchParams.set("iss", new URL(request.url).origin);
  return Response.json({ redirect: back.toString() });
}
