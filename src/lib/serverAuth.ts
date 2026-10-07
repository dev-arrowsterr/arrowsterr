import "server-only";
import { createClient } from "@supabase/supabase-js";

type Min = "owner" | "admin" | "editor" | "viewer";

/**
 * Check the caller is signed in and has at least `min` role in the workspace.
 * Returns null when allowed, or a Response to send back.
 */
export async function requireRole(request: Request, workspaceId: unknown, min: Min): Promise<Response | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase is not set up on the server." }, { status: 500 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "Please sign in again." }, { status: 401 });
  if (typeof workspaceId !== "string" || !workspaceId) return Response.json({ error: "Missing workspace." }, { status: 400 });

  const sb = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: user } = await sb.auth.getUser(token);
  if (!user?.user) return Response.json({ error: "Please sign in again." }, { status: 401 });
  const { data: ok, error } = await sb.rpc("has_role", { ws: workspaceId, min });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!ok) return Response.json({ error: `You need ${min} access in this workspace to do that.` }, { status: 403 });
  return null;
}
