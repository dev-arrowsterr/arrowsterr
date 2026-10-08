import { authUrl, gscReady, redirectUri, signState } from "@/lib/gsc";
import { requireRole } from "@/lib/serverAuth";

// Step 1 of connecting Search Console: check the person may connect this website, then send them to Google.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  if (!gscReady()) return Response.json({ error: "Search Console is not set up yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on Render." }, { status: 500 });

  const { data: site, error } = await auth.sb.from("sites").select("id").eq("id", body.siteId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!site) return Response.json({ error: "Website not found." }, { status: 404 });
  const { data: user } = await auth.sb.auth.getUser(request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));

  try {
    const state = signState({ siteId: site.id, workspaceId: body.workspaceId, userId: user.user?.id ?? "", exp: Date.now() + 15 * 60_000 });
    return Response.json({ url: authUrl(state, redirectUri(request)) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
