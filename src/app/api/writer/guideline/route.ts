import { buildGuideline } from "@/lib/guideline";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { meteredRoute } from "@/lib/meter";
import { requirePaid, take } from "@/lib/entitlements";
import { TASK_COST } from "@/lib/plans";

// Build the brand guideline for a website from its homepage, and save it. Uses one AI answer.
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const paid = await requirePaid(body.workspaceId);
  if (paid) return paid;
  const took = await take(body.workspaceId, "tasks", TASK_COST.guideline);
  if (!took.ok) return took.response;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY is not set on Render." }, { status: 500 });
  const { data: site, error } = await auth.sb.from("sites").select("id, domain, name").eq("id", body.siteId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!site) return Response.json({ error: "Website not found." }, { status: 404 });
  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;
  try {
    const guideline = await buildGuideline(site.domain, site.name);
    const res = await auth.sb.from("sites").update({ guideline, guideline_at: guideline.at }).eq("id", site.id);
    if (res.error) throw new Error(res.error.message + (/guideline/.test(res.error.message) ? " Run supabase/010_writer.sql in Supabase." : ""));
    return Response.json({ guideline });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Brand guideline failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = meteredRoute("brand guideline", handle);
