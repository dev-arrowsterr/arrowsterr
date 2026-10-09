import { randomBytes } from "node:crypto";
import { inspectSite } from "@/lib/platform";
import { requireRole } from "@/lib/serverAuth";
import { active, createWebsite, stats, trackerOrigin, umamiReady } from "@/lib/umami";

type SiteRow = {
  id: string;
  name: string;
  domain: string;
  umami_website_id: string | null;
  site_platform: string | null;
  install_token: string | null;
  ga4_property?: string | null;
  ga4_property_name?: string | null;
  ga4_email?: string | null;
};

// Website tracking for one brand.
//   action "connect": create the brand's website in Umami and a private install link. Editors only.
//   action "status": is the snippet on the homepage, and has the first visit arrived?
//   action "verify": a step by step check of the install, with a fix for each step that fails.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = body.action === "connect" ? "connect" : body.action === "verify" ? "verify" : "status";
  const auth = await requireRole(request, body.workspaceId, action === "connect" ? "editor" : "viewer");
  if ("denied" in auth) return auth.denied;

  // Google Analytics comes first when it is connected. Older databases without the columns fall back to the script.
  const cols = "id, name, domain, umami_website_id, site_platform, install_token";
  let { data, error } = await auth.sb.from("brands").select(`${cols}, ga4_property, ga4_property_name, ga4_email`).eq("id", body.brandId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (error && /ga4_/.test(error.message)) ({ data, error } = await auth.sb.from("brands").select(cols).eq("id", body.brandId).eq("workspace_id", body.workspaceId).maybeSingle());
  const g = data as SiteRow | null;
  const ga4 = g?.ga4_email ? { email: g.ga4_email, property: g.ga4_property ?? null, name: g.ga4_property_name ?? null } : null;
  if (action === "status" && ga4?.property) return Response.json({ connected: true, live: true, source: "ga4", domain: g!.domain, ga4 });
  if (!umamiReady()) return action === "status" ? Response.json({ connected: false, ga4 }) : Response.json({ error: "Website tracking is not set up yet. Add UMAMI_API_KEY on Render." }, { status: 500 });
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
    if (!site.umami_website_id) return Response.json({ connected: false, ga4 });
    if (action === "verify") return Response.json(await verify(site.domain, site.umami_website_id));

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
      ga4,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Site tracking failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

type Check = { label: string; state: "ok" | "warn" | "fail"; note: string };

/** Walk through every place the install can break, in order, and say how to fix each one. */
async function verify(domain: string, id: string) {
  const now = Date.now();
  const [page, upstream, day, month, here] = await Promise.all([
    inspectSite(domain, id),
    fetch(`${trackerOrigin()}/script.js`, { method: "HEAD", signal: AbortSignal.timeout(10_000) }).then((r) => r.ok).catch(() => false),
    stats(id, { startAt: now - 864e5, endAt: now }).catch(() => null),
    stats(id, { startAt: now - 30 * 864e5, endAt: now }).catch(() => null),
    active(id).catch(() => null),
  ]);
  const checks: Check[] = [];
  const sn = page.snippet;
  const bare = domain.toLowerCase().replace(/^www\./, "");

  checks.push(
    page.reachable
      ? { label: "Your website opens", state: "ok", note: `We loaded https://${domain}.` }
      : { label: "Your website opens", state: "fail", note: `We could not load https://${domain}. Check that the brand's domain is right and the site is online.` },
  );
  if (page.reachable) {
    if (!sn) {
      checks.push(
        page.platform === "gtm"
          ? { label: "Code found on your homepage", state: "warn", note: "Your site uses Google Tag Manager, which hides the code from us. That is fine if visits show up below." }
          : {
              label: "Code found on your homepage",
              state: "fail",
              note: "The code is not on your homepage yet. Paste it into the site's head, save, then clear your site's cache (on WordPress: LiteSpeed Cache → Purge All).",
            },
      );
    } else {
      checks.push({ label: "Code found on your homepage", state: "ok", note: "The tracking code is on the page." });
      if (sn.tag) {
        checks.push(
          sn.delayed
            ? {
                label: "Code loads right away",
                state: "fail",
                note: "A speed plugin is delaying the code, so most visits are missed. In LiteSpeed Cache go to Page Optimization → Tuning and add t/script.js to JS Excludes, JS Deferred Excludes and JS Delayed Excludes. Then Purge All.",
              }
            : { label: "Code loads right away", state: "ok", note: "No speed plugin is holding it back." },
        );
        checks.push(
          sn.src && /\/t\/script\.js|umami/.test(sn.src)
            ? { label: "Code points to Arrowsterr", state: "ok", note: sn.src }
            : { label: "Code points to Arrowsterr", state: "fail", note: "The script address was changed. Copy the code again from the install steps and paste it as is." },
        );
        checks.push(
          !sn.domains || sn.domains.some((d) => d.replace(/^www\./, "") === bare)
            ? { label: "Domain matches", state: "ok", note: sn.domains ? `Counts visits on ${sn.domains.join(", ")}.` : "Counts visits on any domain." }
            : {
                label: "Domain matches",
                state: "fail",
                note: `The code only counts visits on ${sn.domains.join(", ")}, but your site is ${domain}. Copy the code again from the install steps.`,
              },
        );
      } else {
        checks.push({ label: "Code loads right away", state: "warn", note: "Your site ID is on the page, but a plugin has changed the code. If no visits show up below, exclude t/script.js from your speed plugin." });
      }
    }
  }
  checks.push(
    upstream
      ? { label: "Tracking server answers", state: "ok", note: "Arrowsterr can reach the tracking server." }
      : { label: "Tracking server answers", state: "fail", note: "The tracking server did not answer. Try again in a few minutes." },
  );
  const views = month?.pageviews ?? 0;
  checks.push(
    views > 0
      ? {
          label: "Visits are arriving",
          state: "ok",
          note: `${day?.pageviews ?? 0} pageviews in the last 24 hours, ${views} in the last 30 days${here ? `, ${here} on the site right now` : ""}.`,
        }
      : {
          label: "Visits are arriving",
          state: checks.some((c) => c.state === "fail") ? "fail" : "warn",
          note: `No visits yet. Open ${domain} in a new private window, click around, then verify again. Ad blockers in your own browser can block your visit.`,
        },
  );
  return { checks, live: views > 0, at: new Date().toISOString() };
}
