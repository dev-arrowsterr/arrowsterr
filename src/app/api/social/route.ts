import { entitlement, requireActive, requireTrack } from "@/lib/entitlements";
import { NOT_SET_UP, queueListen, rankedCompetitors, targetsOf } from "@/lib/listen";
import { adminClient, requireRole } from "@/lib/serverAuth";
import type { ListenSettings } from "@/lib/social";

// Social listening settings for one brand.
// targets: who is tracked and who could be (viewers). save: turn it off or pick competitors (editors).
// start: queue today's listening now (editors). Tracking is part of the plan, so it never costs tasks.

const cleanPicks = (v: unknown): string[] | null =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 100)).filter(Boolean))].slice(0, 50) : null;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = body.action;
  if (!["targets", "save", "start"].includes(action) || typeof body.brandId !== "string") return Response.json({ error: "Bad request" }, { status: 400 });
  const auth = await requireRole(request, body.workspaceId, action === "targets" ? "viewer" : "editor");
  if ("denied" in auth) return auth.denied;
  const locked = await requireTrack(body.workspaceId, "visibility");
  if (locked) return locked;

  const { data: brand, error } = await auth.sb.from("brands").select("id, workspace_id, name, domain, category, listen, listened_on").eq("id", body.brandId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (error) return Response.json({ error: /listen/.test(error.message) ? NOT_SET_UP : error.message }, { status: 500 });
  if (!brand) return Response.json({ error: "Brand not found." }, { status: 404 });
  const e = await entitlement(body.workspaceId);
  const limit = e.limits.listenNames;

  try {
    if (action === "targets") {
      const [targets, ranked] = await Promise.all([targetsOf(auth.sb, brand, limit), rankedCompetitors(auth.sb, brand.id)]);
      return Response.json({ targets, ranked: ranked.slice(0, 50), limit, listen: brand.listen ?? {}, listenedOn: brand.listened_on });
    }

    const stopped = await requireActive(body.workspaceId);
    if (stopped) return stopped;

    if (action === "save") {
      const listen: ListenSettings = { off: body.off === true, picks: cleanPicks(body.picks) };
      const { error: err } = await auth.sb.from("brands").update({ listen }).eq("id", brand.id);
      if (err) throw new Error(err.message);
      return Response.json({ listen });
    }

    // start
    if (limit <= 0) return Response.json({ error: "Social listening starts on Starter.", limit: true, boost: "foundation" }, { status: 429 });
    const { data: all } = await auth.sb.from("brands").select("id").eq("workspace_id", body.workspaceId).order("created_at");
    if ((all ?? []).findIndex((x) => x.id === brand.id) >= e.limits.listenBrands)
      return Response.json({ error: `Your plan listens for your first ${e.limits.listenBrands} ${e.limits.listenBrands === 1 ? "brand" : "brands"}. Add a brand to your plan, or move up a plan.`, limit: true }, { status: 429 });
    const db = adminClient();
    if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, { status: 500 });
    const listen: ListenSettings = { ...(brand.listen ?? {}), off: false };
    const day = new Date().toISOString().slice(0, 10);
    const { error: err } = await db.from("brands").update({ listen, listened_on: day }).eq("id", brand.id);
    if (err) throw new Error(err.message);
    const targets = await queueListen(db, { ...brand, listen }, limit, day);
    return Response.json({ targets, listenedOn: day });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Social listening:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
