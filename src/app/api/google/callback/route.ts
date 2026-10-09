import { exchange, googleReady, readState, seal } from "@/lib/google";
import { adminClient } from "@/lib/serverAuth";

// Google sends people back here after they allow access. Save the encrypted sign-in, then return to the app.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host");
  const base = host ? `https://${host}` : url.origin;
  const go = (path: string, q: Record<string, string>) => Response.redirect(`${base}${path}?${new URLSearchParams(q)}`, 302);
  const state = googleReady() ? readState(url.searchParams.get("state") ?? "") : null;
  if (!state) return go("/traffic", { ga4: "error", reason: "The sign-in link expired. Try again." });
  if (url.searchParams.get("error")) return go(state.back, { ga4: "error", reason: "Google access was not allowed." });

  const db = adminClient();
  if (!db) return go(state.back, { ga4: "error", reason: "Add SUPABASE_SECRET_KEY on Render." });
  try {
    // The person who started must still be an editor of the brand's workspace.
    const { data: member } = await db.from("workspace_members").select("role").eq("workspace_id", state.workspaceId).eq("user_id", state.userId).maybeSingle();
    if (!member || member.role === "viewer") return go(state.back, { ga4: "error", reason: "You need editor access to connect Google Analytics." });

    const { refresh, email } = await exchange(url.searchParams.get("code") ?? "", base);
    if (!refresh) return go(state.back, { ga4: "error", reason: "Google did not return access. Try again." });
    const res = await db.from("ga4_connections").upsert({ brand_id: state.brandId, workspace_id: state.workspaceId, refresh_token: seal(refresh), email, connected_by: state.userId });
    if (res.error) throw new Error(res.error.message + (/ga4_connections/.test(res.error.message) ? " Run supabase/014_google_analytics.sql in Supabase." : ""));
    await db.from("brands").update({ ga4_email: email, ga4_property: null, ga4_property_name: null }).eq("id", state.brandId);
    return go(state.back, { ga4: "connected" });
  } catch (e) {
    return go(state.back, { ga4: "error", reason: e instanceof Error ? e.message.slice(0, 200) : "Could not connect." });
  }
}
