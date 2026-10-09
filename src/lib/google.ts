import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Google sign-in for Google Analytics 4: the sign-in link, token storage and the GA4 APIs.
// Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. Tokens are encrypted with GOOGLE_TOKEN_KEY,
// or a key made from SUPABASE_SECRET_KEY when that is not set.

const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/analytics.readonly"];

export const googleReady = () => Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim() && secret());

function secret() {
  const raw = process.env.GOOGLE_TOKEN_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();
  return raw ? createHash("sha256").update(`arrowsterr-google:${raw}`).digest() : null;
}

/** Encrypt a refresh token for the database. */
export function seal(text: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", secret()!, iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}
export function unseal(sealed: string) {
  const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", secret()!, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");
}

/** A signed, short-lived note that rides through Google's sign-in and comes back to the callback. */
export type State = { brandId: string; workspaceId: string; userId: string; back: string; exp: number };
export function signState(s: Omit<State, "exp">) {
  const body = Buffer.from(JSON.stringify({ ...s, exp: Date.now() + 15 * 60_000 })).toString("base64url");
  return `${body}.${createHmac("sha256", secret()!).update(body).digest("base64url")}`;
}
export function readState(raw: string): State | null {
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", secret()!).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const s = JSON.parse(Buffer.from(body, "base64url").toString()) as State;
  return s.exp > Date.now() ? s : null;
}

export const redirectUri = (origin: string) => `${origin}/api/google/callback`;

export function authUrl(origin: string, state: string) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // always returns a refresh token, even on a second connect
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function token(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!.trim(), client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(), ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google sign-in failed: ${data.error_description || data.error || res.status}`);
  return data as { access_token: string; refresh_token?: string; id_token?: string; expires_in: number };
}

/** Trade the code from Google's sign-in for tokens, and read the account's email. */
export async function exchange(code: string, origin: string) {
  const t = await token({ code, grant_type: "authorization_code", redirect_uri: redirectUri(origin) });
  let email: string | null = null;
  try {
    email = JSON.parse(Buffer.from(t.id_token!.split(".")[1], "base64url").toString()).email ?? null;
  } catch {
    // No email in the token. The connection still works.
  }
  return { refresh: t.refresh_token ?? null, email };
}

// Access tokens last an hour. Keep them in memory and refresh a minute early.
const access = new Map<string, { token: string; until: number }>();
export async function accessToken(sealedRefresh: string) {
  const hit = access.get(sealedRefresh);
  if (hit && hit.until > Date.now()) return hit.token;
  const t = await token({ refresh_token: unseal(sealedRefresh), grant_type: "refresh_token" });
  access.set(sealedRefresh, { token: t.access_token, until: Date.now() + (t.expires_in - 60) * 1000 });
  return t.access_token;
}

async function api<T>(url: string, accessTok: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${accessTok}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Analytics: ${data.error?.message ?? res.status}`);
  return data as T;
}

/** Every GA4 property the signed-in account can read. */
export async function listProperties(accessTok: string) {
  type Summary = { displayName?: string; propertySummaries?: { property: string; displayName: string }[] };
  const out: { id: string; name: string; account: string }[] = [];
  let page = "";
  for (let i = 0; i < 10; i++) {
    const data = await api<{ accountSummaries?: Summary[]; nextPageToken?: string }>(`https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200${page ? `&pageToken=${page}` : ""}`, accessTok);
    for (const a of data.accountSummaries ?? []) for (const p of a.propertySummaries ?? []) out.push({ id: p.property.replace("properties/", ""), name: p.displayName, account: a.displayName ?? "" });
    if (!data.nextPageToken) break;
    page = data.nextPageToken;
  }
  return out;
}

export type ReportRequest = {
  dateRanges: { startDate: string; endDate: string; name?: string }[];
  dimensions?: { name: string }[];
  metrics: { name: string }[];
  dimensionFilter?: unknown;
  orderBys?: unknown[];
  limit?: number;
};
export type ReportRow = { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] };

/** Run up to 5 GA4 reports in one call. */
export async function runReports(accessTok: string, property: string, requests: ReportRequest[]) {
  const out: ReportRow[][] = [];
  for (let i = 0; i < requests.length; i += 5) {
    const data = await api<{ reports?: { rows?: ReportRow[] }[] }>(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:batchRunReports`, accessTok, { requests: requests.slice(i, i + 5) });
    for (const r of data.reports ?? []) out.push(r.rows ?? []);
  }
  return out;
}

/** People on the site right now. */
export async function activeNow(accessTok: string, property: string) {
  const data = await api<{ rows?: ReportRow[] }>(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runRealtimeReport`, accessTok, { metrics: [{ name: "activeUsers" }] });
  return Number(data.rows?.[0]?.metricValues?.[0]?.value ?? 0);
}
