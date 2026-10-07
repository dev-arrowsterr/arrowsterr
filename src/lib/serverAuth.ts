import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Min = "owner" | "admin" | "editor" | "viewer";

export const supabaseUrl = () => process.env.SUPABASE_URL?.trim().replace(/\/+$/, "") ?? "";

/**
 * Check the caller is signed in and has at least `min` role in the workspace.
 * Returns a Supabase client that acts as the caller, or a Response to send back.
 */
export async function requireRole(request: Request, workspaceId: unknown, min: Min): Promise<{ sb: SupabaseClient } | { denied: Response }> {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const deny = (error: string, status: number) => ({ denied: Response.json({ error }, { status }) });
  if (!url || !key) return deny("Supabase is not set up on the server.", 500);
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return deny("Please sign in again.", 401);
  if (typeof workspaceId !== "string" || !workspaceId) return deny("Missing workspace.", 400);

  const sb = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: user } = await sb.auth.getUser(token);
  if (!user?.user) return deny("Please sign in again.", 401);
  const { data: ok, error } = await sb.rpc("has_role", { ws: workspaceId, min });
  if (error) return deny(error.message, 500);
  if (!ok) return deny(`You need ${min} access in this workspace to do that.`, 403);
  return { sb };
}

/** Count one AI answer against the workspace's daily limit. Returns a Response when the limit is used up. */
export async function takeAnswer(sb: SupabaseClient, workspaceId: string): Promise<Response | null> {
  const { data, error } = await sb.rpc("take_answer", { p_ws: workspaceId });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Daily limit reached. This workspace used all its AI answers for today.", limit: true }, { status: 429 });
  return null;
}

/** A Supabase client with full access, for the daily job. Needs SUPABASE_SECRET_KEY. */
export function adminClient(): SupabaseClient | null {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
