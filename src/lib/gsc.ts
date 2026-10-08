import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { adminClient } from "./serverAuth";

// Google Search Console. People sign in with Google once per website; we keep an encrypted
// refresh token and ask Google for fresh access when we need data. Read only.

const SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly", "openid", "email"];
export const gscReady = () => Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());

/** The secret behind state signing and token encryption. Set GSC_SECRET, or it falls back to the Supabase secret key. */
function secret() {
  const s = process.env.GSC_SECRET?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();
  if (!s) throw new Error("Add GSC_SECRET or SUPABASE_SECRET_KEY on Render.");
  return createHash("sha256").update(`arrowsterr-gsc:${s}`).digest();
}

export function encrypt(text: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", secret(), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}
export function decrypt(packed: string) {
  const [iv, tag, body] = packed.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", secret(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");
}

export type State = { siteId: string; workspaceId: string; userId: string; exp: number };
export function signState(s: State) {
  const body = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${body}.${createHmac("sha256", secret()).update(body).digest("base64url")}`;
}
export function readState(token: string): State | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", secret()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as State;
  return s.exp > Date.now() ? s : null;
}

/** Where Google sends people back. Must match a redirect URI in the Google Cloud OAuth client. */
export function redirectUri(request: Request) {
  const fixed = process.env.GSC_REDIRECT_URI?.trim();
  if (fixed) return fixed;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "app.arrowsterr.com";
  return `https://${host}/api/gsc/callback`;
}

export function authUrl(state: string, redirect: string) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    redirect_uri: redirect,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function token(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!.trim(), client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(), ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google sign-in failed: ${data.error_description ?? data.error ?? res.status}`);
  return data as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string };
}

export async function exchangeCode(code: string, redirect: string) {
  const t = await token({ grant_type: "authorization_code", code, redirect_uri: redirect });
  let email: string | null = null;
  try {
    email = JSON.parse(Buffer.from(t.id_token!.split(".")[1], "base64url").toString("utf8")).email ?? null;
  } catch {
    // No email in the sign-in. Not needed to work.
  }
  return { access: t.access_token, refresh: t.refresh_token ?? null, email };
}

const cache = new Map<string, { token: string; until: number }>();

/** A fresh Google access token for one website. */
export async function accessFor(siteId: string): Promise<string> {
  const hit = cache.get(siteId);
  if (hit && hit.until > Date.now()) return hit.token;
  const db = adminClient();
  if (!db) throw new Error("SUPABASE_SECRET_KEY is missing on Render.");
  const { data, error } = await db.from("gsc_connections").select("refresh_token").eq("site_id", siteId).maybeSingle();
  if (error) throw new Error(error.message + (/gsc_connections/.test(error.message) ? " Run supabase/008_search_console.sql in Supabase." : ""));
  if (!data) throw new Error("Search Console is not connected for this website.");
  const t = await token({ grant_type: "refresh_token", refresh_token: decrypt(data.refresh_token) });
  cache.set(siteId, { token: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000 });
  return t.access_token;
}
export const forget = (siteId: string) => cache.delete(siteId);

async function google<T>(access: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/webmasters/v3${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Search Console: ${data?.error?.message ?? res.status}`);
  return data as T;
}

export type Property = { siteUrl: string; permissionLevel: string };
export async function properties(access: string): Promise<Property[]> {
  const out = await google<{ siteEntry?: Property[] }>(access, "/sites");
  return (out.siteEntry ?? []).filter((p) => p.permissionLevel !== "siteUnverifiedUser");
}

/** The property for a domain: the whole domain first, then https with or without www. */
export function matchProperty(domain: string, list: Property[]): string | null {
  const d = domain.toLowerCase().replace(/^www\./, "");
  const order = [`sc-domain:${d}`, `https://${d}/`, `https://www.${d}/`, `http://${d}/`, `http://www.${d}/`];
  for (const want of order) if (list.some((p) => p.siteUrl.toLowerCase() === want)) return list.find((p) => p.siteUrl.toLowerCase() === want)!.siteUrl;
  return list.find((p) => p.siteUrl.toLowerCase().includes(d))?.siteUrl ?? null;
}

export type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };
const day = (offset: number) => new Date(Date.now() - offset * 864e5).toISOString().slice(0, 10);

/** Search analytics for a date range. Days count back from yesterday. */
export async function query(siteId: string, property: string, opts: { days: number; offset?: number; dimensions: string[]; limit?: number }): Promise<GscRow[]> {
  const access = await accessFor(siteId);
  const end = 1 + (opts.offset ?? 0);
  const out = await google<{ rows?: GscRow[] }>(access, `/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
    startDate: day(end + opts.days - 1),
    endDate: day(end),
    dimensions: opts.dimensions,
    rowLimit: opts.limit ?? 1000,
    dataState: "all",
  });
  return out.rows ?? [];
}
