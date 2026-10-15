import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Website logins (WordPress, Shopify, Webflow, HubSpot, Ghost) are saved encrypted, as { sealed: "..." }.
// Same AES-256-GCM and the same server key as Google sign-ins (GOOGLE_TOKEN_KEY, else SUPABASE_SECRET_KEY),
// with its own purpose label so a website login and a Google token never share a key.
// Rows saved before encryption hold the plain fields; they still open, and the worker seals them.

export type CmsConfig = Record<string, string>;
export type StoredConfig = { sealed: string } | CmsConfig;

function key() {
  const raw = process.env.GOOGLE_TOKEN_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();
  if (!raw) throw new Error("Add GOOGLE_TOKEN_KEY or SUPABASE_SECRET_KEY to the server's settings.");
  return createHash("sha256").update(`arrowsterr-cms:${raw}`).digest();
}

export const isSealed = (raw: unknown): raw is { sealed: string } => !!raw && typeof raw === "object" && typeof (raw as { sealed?: unknown }).sealed === "string";

/** Encrypt a connection's fields for the database. */
export function sealConfig(config: CmsConfig): { sealed: string } {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(config), "utf8"), c.final()]);
  return { sealed: [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".") };
}

/** A connection's fields, from a sealed row or an older plain one. */
export function openConfig(raw: unknown): CmsConfig {
  if (isSealed(raw)) {
    try {
      const [iv, tag, body] = raw.sealed.split(".").map((p) => Buffer.from(p, "base64url"));
      const d = createDecipheriv("aes-256-gcm", key(), iv!);
      d.setAuthTag(tag!);
      const out = JSON.parse(Buffer.concat([d.update(body!), d.final()]).toString("utf8")) as unknown;
      return plain(out);
    } catch {
      throw new Error("The saved login for this website can't be read. Connect it again in Settings → Publishing.");
    }
  }
  return plain(raw);
}

const plain = (raw: unknown): CmsConfig =>
  Object.fromEntries(Object.entries(raw && typeof raw === "object" ? raw : {}).filter((e): e is [string, string] => typeof e[1] === "string"));
