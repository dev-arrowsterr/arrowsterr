import { forgetEntitlement } from "@/lib/entitlements";
import { dailyAnswers, limitsFor, TRACKS, type Extras, type Track } from "@/lib/plans";
import { adminClient, requireRole } from "@/lib/serverAuth";

const MONTH = 30 * 864e5;

// Pick the toolset a Starter plan opens: AI Visibility or SEO. It can change once every 30 days.
//   { track: "visibility" | "seo" }
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "admin");
  if ("denied" in auth) return auth.denied;
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY on Render." }, { status: 500 });
  const track = body.track as Track;
  if (!TRACKS[track]) return Response.json({ error: "Pick AI Visibility or SEO." }, { status: 400 });

  const { data: w, error } = await db.from("workspaces").select("plan, extras").eq("id", body.workspaceId).maybeSingle();
  if (error || !w) return Response.json({ error: error?.message ?? "Workspace not found." }, { status: 500 });
  const extras = (w.extras ?? {}) as Extras;
  if (extras.track === track) return Response.json({ track });
  if (w.plan === "foundation" && extras.track && extras.trackAt && Date.now() - Date.parse(extras.trackAt) < MONTH) {
    const next = new Date(Date.parse(extras.trackAt) + MONTH).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return Response.json({ error: `You can switch toolsets once a month. Next switch: ${next}. Or get both on Pro.` }, { status: 400 });
  }
  const next: Extras = { ...extras, track, trackAt: new Date().toISOString() };
  const limits = limitsFor(w.plan, next);
  const { error: e2 } = await db.from("workspaces").update({ extras: next, prompt_limit: limits.prompts, daily_answer_limit: dailyAnswers(limits) }).eq("id", body.workspaceId);
  if (e2) return Response.json({ error: e2.message }, { status: 500 });
  forgetEntitlement(body.workspaceId);
  return Response.json({ track });
}
