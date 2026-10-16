import { adminClient } from "@/lib/serverAuth";

// Count one view of a share link (docs/reports.md, section 13.3). The page calls this at most once a day
// per browser. No IP address or person is stored, only the count and the time.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const token = String(body.token ?? "");
  if (!/^[a-f0-9]{48,64}$/.test(token)) return Response.json({ ok: false }, { status: 400 });
  const db = adminClient();
  if (!db) return Response.json({ ok: false });
  await db.rpc("report_link_viewed", { p_token: token });
  return Response.json({ ok: true });
}
