import { checkPassword, unlockCookie, unlockValue } from "@/lib/reportServer";
import { adminClient } from "@/lib/serverAuth";

// Open a share link that has a password. A right password sets a cookie for 30 days.
// 10 tries an hour per link and address, so a password can't be guessed by brute force.
const tries = new Map<string, { n: number; at: number }>();

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const token = String(body.token ?? "");
  const password = String(body.password ?? "");
  if (!/^[a-f0-9]{48,64}$/.test(token) || !password) return Response.json({ error: "Enter the password." }, { status: 400 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = `${token}:${ip}`;
  const t = tries.get(key);
  const now = Date.now();
  if (t && now - t.at < 3600_000 && t.n >= 10) return Response.json({ error: "Too many tries. Wait an hour, or ask for a new link." }, { status: 429 });

  const db = adminClient();
  if (!db) return Response.json({ error: "This link can't be opened right now." }, { status: 500 });
  const { data } = await db.from("report_links").select("password_hash, revoked_at, expires_at").eq("token", token).maybeSingle();
  const link = data as { password_hash: string | null; revoked_at: string | null; expires_at: string | null } | null;
  if (!link?.password_hash || link.revoked_at || (link.expires_at && Date.parse(link.expires_at) < now)) return Response.json({ error: "This link is no longer shared." }, { status: 404 });

  if (!(await checkPassword(password, link.password_hash))) {
    tries.set(key, t && now - t.at < 3600_000 ? { n: t.n + 1, at: t.at } : { n: 1, at: now });
    if (tries.size > 5000) tries.delete(tries.keys().next().value!);
    return Response.json({ error: "That password is not right." }, { status: 403 });
  }
  tries.delete(key);
  const cookie = `${unlockCookie(token)}=${unlockValue(token, link.password_hash)}; Path=/r/${token}; Max-Age=${30 * 86400}; HttpOnly; Secure; SameSite=Lax`;
  return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie } });
}
