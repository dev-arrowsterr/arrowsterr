import { entitlement, requireActive, requireTrack } from "@/lib/entitlements";
import { REFRESH_DAYS } from "@/lib/industry";
import { enqueue } from "@/lib/jobs";
import { adminClient, requireRole } from "@/lib/serverAuth";
import { audienceOf, NO_KEY, sparktoroReady } from "@/lib/sparktoro";

// Start (or refresh) a brand's Industry Research. The worker builds it from SparkToro in a few minutes.
// It is part of the plan, so it never costs tasks, and it refreshes at most once every 30 days.

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.brandId !== "string") return Response.json({ error: "Bad request" }, { status: 400 });
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const locked = (await requireTrack(body.workspaceId, "seo")) ?? (await requireActive(body.workspaceId));
  if (locked) return locked;
  const perMonth = (await entitlement(body.workspaceId)).limits.audiencePerMonth;
  if (perMonth <= 0) return Response.json({ error: "Audience research starts on Starter.", limit: true, boost: "foundation" }, { status: 429 });
  if (!sparktoroReady()) return Response.json({ error: NO_KEY }, { status: 500 });
  const db = adminClient();
  if (!db) return Response.json({ error: "Add SUPABASE_SECRET_KEY to the server's settings." }, { status: 500 });

  const { data: brand } = await auth.sb.from("brands").select("id, domain").eq("id", body.brandId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (!brand) return Response.json({ error: "Brand not found." }, { status: 404 });

  const { data: row, error } = await db.from("industry_research").select("status, started_at, updated_at").eq("brand_id", brand.id).maybeSingle();
  if (error) return Response.json({ error: /industry_research/.test(error.message) ? "Run supabase/039_industry_research.sql in Supabase." : error.message }, { status: 500 });
  if (row?.status === "running" && Date.now() - Date.parse(row.started_at) < 45 * 60_000) return Response.json({ status: "running" });
  if (row?.status === "done" && row.updated_at) {
    const next = Date.parse(row.updated_at) + REFRESH_DAYS * 864e5;
    if (next > Date.now()) {
      const on = new Date(next).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      return Response.json({ error: `Industry Research refreshes once every ${REFRESH_DAYS} days. You can refresh it on ${on}.`, limit: true }, { status: 429 });
    }
  }

  // Each plan includes a number of audience reports a month: one per brand, refreshes of the same brand included.
  const { count: others } = await db
    .from("industry_research")
    .select("brand_id", { count: "exact", head: true })
    .eq("workspace_id", body.workspaceId)
    .neq("brand_id", brand.id)
    .gte("started_at", new Date(Date.now() - REFRESH_DAYS * 864e5).toISOString());
  if ((others ?? 0) >= perMonth)
    return Response.json({ error: `Your plan includes ${perMonth} audience ${perMonth === 1 ? "report" : "reports"} a month, and ${perMonth === 1 ? "it's" : "they're"} used. Move up a plan for more.`, limit: true }, { status: 429 });

  const now = new Date().toISOString();
  const { error: err } = await db
    .from("industry_research")
    .upsert({ brand_id: brand.id, workspace_id: body.workspaceId, status: "running", error: null, audience: audienceOf(brand.domain), report_id: null, sections: {}, started_at: now }, { onConflict: "brand_id" });
  if (err) return Response.json({ error: err.message }, { status: 500 });
  await enqueue("industry", { brandId: brand.id }, { workspaceId: body.workspaceId, key: `industry:${brand.id}:${now}`, maxAttempts: 4 });
  return Response.json({ status: "running" });
}
