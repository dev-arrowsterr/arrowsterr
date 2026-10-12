import { createHash, randomBytes } from "node:crypto";

// OAuth 2.1 for MCP clients: public clients, PKCE with S256, and API keys as access tokens.

export const SCOPE = "mcp";
export const CODE_TTL = 10 * 60_000;
export const token = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const b64sha = (s: string) => createHash("sha256").update(s).digest("base64url");

/** True when the verifier matches the challenge the app sent at the start. */
export const pkceOk = (verifier: string, challenge: string) => /^[A-Za-z0-9._~-]{43,128}$/.test(verifier) && b64sha(verifier) === challenge;

/** Apps may send people back to https addresses, a local port, or their own app scheme (like cursor://). */
export function redirectOk(uri: string) {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    if (u.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && !["javascript:", "data:", "file:", "vbscript:"].includes(u.protocol);
  } catch {
    return false;
  }
}

export const OAUTH_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
};

/** An OAuth error reply. */
export const oauthError = (error: string, description: string, status = 400) => Response.json({ error, error_description: description }, { status, headers: { ...OAUTH_CORS, "Cache-Control": "no-store" } });
