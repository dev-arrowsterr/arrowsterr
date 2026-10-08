import { encrypt, exchangeCode, forget, matchProperty, properties, readState, redirectUri } from "@/lib/gsc";
import { adminClient } from "@/lib/serverAuth";

// Step 2: Google sends the person back here. Save the encrypted sign-in, pick the matching property,
// and return to the app.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = `https://${request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host}`;
  const back = (q: Record<string, string>) => Response.redirect(`${origin}/search-performance?${new URLSearchParams(q)}`, 302);

  const state = readState(url.searchParams.get("state") ?? "");
  if (!state) return back({ gsc: "error", reason: "The sign-in link expired. Try again." });
  if (url.searchParams.get("error")) return back({ gsc: "error", reason: "Google sign-in was cancelled." });
  const code = url.searchParams.get("code");
  if (!code) return back({ gsc: "error", reason: "Google did not send a sign-in code." });
  const db = adminClient();
  if (!db) return back({ gsc: "error", reason: "SUPABASE_SECRET_KEY is missing on Render." });

  try {
    const t = await exchangeCode(code, redirectUri(request));
    if (!t.refresh) throw new Error("Google did not give long-term access. Remove Arrowsterr at myaccount.google.com/permissions and connect again.");
    const { data: site, error } = await db.from("sites").select("id, domain, brand_id").eq("id", state.siteId).eq("workspace_id", state.workspaceId).single();
    if (error || !site) throw new Error(error?.message ?? "Website not found.");

    const list = await properties(t.access);
    const property = matchProperty(site.domain, list);
    const saved = await db.from("gsc_connections").upsert({
      site_id: site.id,
      workspace_id: state.workspaceId,
      refresh_token: encrypt(t.refresh),
      email: t.email,
      connected_by: state.userId || null,
    });
    if (saved.error) throw new Error(saved.error.message + (/gsc_connections/.test(saved.error.message) ? " Run supabase/008_search_console.sql in Supabase." : ""));
    await db.from("sites").update({ gsc_property: property, gsc_email: t.email }).eq("id", site.id);
    forget(site.id);
    return back({ gsc: property ? "connected" : "pick", brand: site.brand_id ?? "" });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error("Search Console connect failed:", reason);
    return back({ gsc: "error", reason });
  }
}
