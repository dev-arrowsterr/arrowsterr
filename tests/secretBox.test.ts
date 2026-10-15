import { test } from "node:test";
import assert from "node:assert/strict";

process.env.GOOGLE_TOKEN_KEY = "test-key-one";
const { isSealed, openConfig, sealConfig } = await import("../src/lib/secretBox.ts");

const login = { siteUrl: "https://acme.com", username: "admin", appPassword: "abcd efgh ijkl" };

test("a sealed login opens to the same fields, and the database never holds the password", () => {
  const stored = sealConfig(login);
  assert.ok(isSealed(stored));
  assert.ok(!JSON.stringify(stored).includes("abcd"), "the password shows in the stored value");
  assert.deepEqual(openConfig(stored), login);
});

test("each save uses a fresh nonce, so the same login never looks the same twice", () => {
  assert.notEqual(sealConfig(login).sealed, sealConfig(login).sealed);
});

test("rows saved before encryption still open", () => {
  assert.deepEqual(openConfig(login), login);
  assert.deepEqual(openConfig({ siteUrl: "x", junk: 4 }), { siteUrl: "x" });
  assert.deepEqual(openConfig(null), {});
});

test("a changed or wrong key fails with a clear message, never with garbage", () => {
  const stored = sealConfig(login);
  const tampered = { sealed: stored.sealed.slice(0, -2) + (stored.sealed.endsWith("A") ? "BB" : "AA") };
  assert.throws(() => openConfig(tampered), /Connect it again/);
  process.env.GOOGLE_TOKEN_KEY = "test-key-two";
  try {
    assert.throws(() => openConfig(stored), /Connect it again/);
  } finally {
    process.env.GOOGLE_TOKEN_KEY = "test-key-one";
  }
});
