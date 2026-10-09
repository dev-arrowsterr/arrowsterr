import { authUrl, googleReady, signState } from "@/lib/google";
import { requireRole } from "@/lib/serverAuth";

// Start connecting Google Analytics for one brand: returns Google's sign-in link. Editors only.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  if (!googleReady()) return Response.json({ error: "Google sign-in is not set up. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on Render." }, { status: 500 });
  const { data: user } = await auth.sb.auth.getUser(request.headers.get("authorization")!.replace(/^Bearer\s+/i, ""));
  const { data: brand } = await auth.sb.from("brands").select("id").eq("id", body.brandId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (!brand || !user?.user) return Response.json({ error: "Brand not found." }, { status: 404 });
  const host = request.headers.get("x-forwarded-host");
  const base = host ? `https://${host}` : new URL(request.url).origin;
  const back = typeof body.back === "string" && body.back.startsWith("/") && !body.back.startsWith("//") ? body.back : "/traffic";
  return Response.json({ url: authUrl(base, signState({ brandId: brand.id, workspaceId: body.workspaceId, userId: user.user.id, back })) });
}
