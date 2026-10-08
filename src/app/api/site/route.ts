import { randomBytes } from "node:crypto";
import { inspectSite } from "@/lib/platform";
import { requireRole } from "@/lib/serverAuth";
import { createWebsite, stats, umamiReady } from "@/lib/umami";

type SiteRow = { id: string; name: string; domain: string; umami_website_id: string | null; site_platform: string | null; install_token: string | null };

// Website tracking for one brand.
//   action "connect": create the brand's website in Umami and a private install link. Editors only.
//   action "status": is the snippet on the homepage, and has the first visit arrived?
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = body.action === "connect" ? "connect" : "status";
  const auth = await requireRole(request, body.workspaceId, action === "connect" ? "editor" : "viewer");
  if ("denied" in auth) return auth.denied;
  if (!umamiReady()) return Response.json({ error: "Website tracking is not set up yet. Add UMAMI_API_KEY on Render." }, { status: 500 });

  const { data, error } = await auth.sb
    .from("brands")
    .select("id, name, domain, umami_website_id, site_platform, install_token")
    .eq("id", body.brandId)
    .eq("workspace_id", body.workspaceId)
    .maybeSingle();
  if (error) {
    const hint = /umami_website_id|install_token|site_platform/.test(error.message) ? " Run supabase/005_website_tracking.sql in Supabase." : "";
    return Response.json({ error: error.message + hint }, { status: 500 });
  }
  if (!data) return Response.json({ error: "Brand not found." }, { status: 404 });
  let site = data as SiteRow;

  try {
    if (action === "connect") {
      const websiteId = site.umami_website_id ?? (await createWebsite(site.name, site.domain));
      const { platform } = await inspectSite(site.domain);
      const update = { umami_website_id: websiteId, site_platform: platform, install_token: site.install_token ?? randomBytes(12).toString("hex") };
      const res = await auth.sb.from("brands").update(update).eq("id", site.id);
      if (res.error) throw new Error(res.error.message);
      site = { ...site, ...update };
    }
    if (!site.umami_website_id) return Response.json({ connected: false });

    const now = Date.now();
    const [page, recent] = await Promise.all([
      inspectSite(site.domain, site.umami_website_id),
      stats(site.umami_website_id, { startAt: now - 30 * 864e5, endAt: now }).catch(() => ({ pageviews: 0, visitors: 0, visits: 0 })),
    ]);
    return Response.json({
      connected: true,
      websiteId: site.umami_website_id,
      domain: site.domain,
      platform: site.site_platform ?? page.platform,
      token: site.install_token,
      installed: page.installed, // the snippet is in the homepage HTML (tag managers hide it, so this can be false while it works)
      live: recent.pageviews > 0,
      pageviews: recent.pageviews,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Site tracking failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
