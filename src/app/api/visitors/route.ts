import { summarize, type Step, type Visitor } from "@/lib/journey";
import { requireRole } from "@/lib/serverAuth";
import { activity, events, sessions, umamiReady, type Activity } from "@/lib/umami";

// Visitors and buyer journeys for one brand's website, from Umami.
//   list: every visitor in the period, with a fun name, source, actions and buyer score. Cached 5 minutes.
//   journey: one visitor's full path, every visit and step.
const cache = new Map<string, { at: number; data: unknown }>();

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}
const toStep = (a: Activity): Step => ({ at: a.at, visitId: a.visitId, path: a.path, query: a.query, referrer: a.referrer, title: a.title, event: a.event });

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, "viewer");
  if ("denied" in auth) return auth.denied;
  if (!umamiReady()) return Response.json({ error: "Website tracking is not set up yet." }, { status: 500 });

  const { data: brand, error } = await auth.sb.from("brands").select("domain, umami_website_id").eq("id", body.brandId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const b = brand as { domain: string; umami_website_id: string | null } | null;
  if (!b?.umami_website_id) return Response.json({ error: "connect", message: "Connect the website in Analytics first." }, { status: 400 });
  const id = b.umami_website_id;
  const now = Date.now();

  try {
    if (body.action === "journey") {
      const sessionId = String(body.sessionId ?? "");
      if (!/^[\w-]{8,64}$/.test(sessionId)) return Response.json({ error: "Unknown visitor." }, { status: 400 });
      const range = { startAt: now - 180 * 864e5, endAt: now };
      const steps = (await activity(id, sessionId, range)).map(toStep);
      return Response.json({ steps });
    }

    const days = [7, 30, 60, 90].includes(Number(body.days)) ? Number(body.days) : 30;
    const key = `${id}:${days}`;
    const hit = cache.get(key);
    if (hit && now - hit.at < 5 * 60_000) return Response.json(hit.data);

    const range = { startAt: now - days * 864e5, endAt: now };
    const list = await sessions(id, range, 500);
    const bySession = new Map<string, Step[]>();
    let detail = "all";
    try {
      for (const a of await events(id, range)) if (a.sessionId) bySession.set(a.sessionId, [...(bySession.get(a.sessionId) ?? []), toStep(a)]);
    } catch {
      // This Umami has no event list. Read the 150 most recent visitors one by one.
      detail = "recent";
      await pool(list.slice(0, 150), 6, async (s) => {
        bySession.set(s.id, (await activity(id, s.id, range).catch(() => [])).map(toStep));
      });
    }
    const visitors: Visitor[] = list.map((s) => summarize(s, bySession.get(s.id) ?? [], b.domain));
    const data = { days, detail, visitors };
    cache.set(key, { at: now, data });
    return Response.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Visitors failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
