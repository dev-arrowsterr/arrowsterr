import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pkceOk, redirectOk } from "../src/lib/oauth.ts";

test("PKCE: the verifier must hash to the challenge", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  assert.equal(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.equal(pkceOk(verifier, challenge), true);
  assert.equal(pkceOk(verifier + "x", challenge), false);
  assert.equal(pkceOk("short", createHash("sha256").update("short").digest("base64url")), false);
});

test("redirects: https, localhost and app schemes only", () => {
  assert.equal(redirectOk("https://claude.ai/api/mcp/auth_callback"), true);
  assert.equal(redirectOk("http://localhost:6274/oauth/callback"), true);
  assert.equal(redirectOk("http://127.0.0.1:33418/callback"), true);
  assert.equal(redirectOk("cursor://anysphere.cursor-retrieval/oauth/callback"), true);
  assert.equal(redirectOk("http://evil.com/callback"), false);
  assert.equal(redirectOk("javascript:alert(1)"), false);
  assert.equal(redirectOk("data:text/html,hi"), false);
  assert.equal(redirectOk("https://claude.ai/cb#frag"), false);
  assert.equal(redirectOk("not a url"), false);
});
