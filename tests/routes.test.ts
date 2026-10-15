import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Routes that use the full-access database key skip row level security, so each one must check who is asking first.
// A route passes when it calls one of the checks below. Public routes are listed by name with the proof they use instead.

const CHECKS = [/requireRole\(/, /allowed\(request\)/, /apiAuth\(/];
const PUBLIC: Record<string, string> = {
  "billing/webhook": "Stripe signature",
  "google/callback": "signed sign-in state",
  "health": "answers up or down, a time and a count; no customer data",
  "notifications/unsubscribe": "signed unsubscribe link",
  "oauth/client": "reads public app names only",
  "oauth/register": "open app registration, the MCP way",
  "oauth/token": "one-time code with PKCE, or a refresh token",
  "snapshot": "free tool, limited per IP",
};

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routes(path) : name === "route.ts" ? [path] : [];
  });
}

test("every route with the full-access key checks the caller, or is a known public route", () => {
  const root = join(import.meta.dirname, "../src/app/api");
  const unchecked = routes(root)
    .filter((f) => /adminClient\(\)/.test(readFileSync(f, "utf8")))
    .map((f) => ({ name: f.slice(root.length + 1, -"/route.ts".length), code: readFileSync(f, "utf8") }))
    .filter((r) => !CHECKS.some((c) => c.test(r.code)) && !(r.name in PUBLIC))
    .map((r) => r.name);
  assert.deepEqual(unchecked, [], `These routes use the full-access key with no check: ${unchecked.join(", ")}`);
});

test("the public list only names routes that exist", () => {
  const root = join(import.meta.dirname, "../src/app/api");
  const names = new Set(routes(root).map((f) => f.slice(root.length + 1, -"/route.ts".length)));
  assert.deepEqual(Object.keys(PUBLIC).filter((n) => !names.has(n)), []);
});
