import { test } from "node:test";
import assert from "node:assert/strict";
import { backoffSeconds, failureOf, MAX_ATTEMPTS, needsPerson, retryable, summarize } from "../src/lib/retryPolicy.ts";

test("a failing job keeps trying for about 7 hours, so a 1-hour outage loses nothing", () => {
  const waits = Array.from({ length: MAX_ATTEMPTS - 1 }, (_, i) => backoffSeconds(i + 1));
  const total = waits.reduce((a, b) => a + b, 0);
  assert.ok(total >= 6 * 3600 && total <= 8 * 3600, `total wait is ${total / 3600} hours`);
  assert.ok(waits.slice(0, 4).reduce((a, b) => a + b, 0) < 3600, "the first few tries come quickly");
  assert.ok(waits.every((w, i) => i === 0 || w >= waits[i - 1]!), "waits only grow");
  assert.equal(backoffSeconds(0), 60);
  assert.equal(backoffSeconds(99), backoffSeconds(MAX_ATTEMPTS - 1));
});

test("a spent account is told apart from a rate limit, for each provider", () => {
  // Anthropic: the monthly spend cap is a 429 with its own error code and no retry-after.
  const anthropicCap = Object.assign(new Error("429 You have reached your API usage limits"), { status: 429, error: { type: "error", error: { type: "rate_limit_error", details: { error_code: "enforced_spend_limit_reached" } } } });
  assert.equal(failureOf(anthropicCap).kind, "spend_cap");
  // OpenAI: out of credit is also a 429, with the code insufficient_quota.
  assert.equal(failureOf(Object.assign(new Error("429 You exceeded your current quota"), { status: 429, code: "insufficient_quota" })).kind, "spend_cap");
  assert.equal(failureOf(Object.assign(new Error("Payment required"), { status: 402 })).kind, "spend_cap");
  assert.equal(failureOf(new Error("Your credit balance is too low to access the API")).kind, "spend_cap");
  // A plain rate limit, with the wait the provider asked for.
  const limited = failureOf(Object.assign(new Error("429 rate_limit_error"), { status: 429, headers: new Headers({ "retry-after": "12" }) }));
  assert.deepEqual(limited, { kind: "rate_limit", retryAfter: 12 });
});

test("errors are sorted by what retrying can fix", () => {
  assert.equal(failureOf(Object.assign(new Error("401 invalid x-api-key"), { status: 401 })).kind, "auth");
  assert.equal(failureOf(Object.assign(new Error("Overloaded"), { status: 529 })).kind, "server");
  assert.equal(failureOf(new Error("DataForSEO returned 503")).kind, "server");
  assert.equal(failureOf(Object.assign(new Error("400 prompt is too long"), { status: 400 })).kind, "bad_request");
  assert.equal(failureOf(Object.assign(new TypeError("fetch failed"), { cause: "ECONNRESET" })).kind, "network");
  assert.equal(failureOf(new Error("This workspace can track 500 prompts. 498 are in use.")).kind, "unknown", "a number in a sentence is not a status code");
  assert.equal(failureOf("just a string").kind, "unknown");
  assert.equal(failureOf(null).kind, "unknown");
});

test("which failures retry soon, and which wait for a person", () => {
  assert.ok(retryable("rate_limit") && retryable("server") && retryable("network") && retryable("unknown"));
  assert.ok(!retryable("spend_cap") && !retryable("auth") && !retryable("bad_request"));
  assert.ok(needsPerson("spend_cap") && needsPerson("auth"));
  assert.ok(!needsPerson("rate_limit") && !needsPerson("bad_request"));
});

test("the alert groups jobs by kind, biggest first, with the latest error", () => {
  const lines = summarize([
    { kind: "check", last_error: "OpenAI 500", workspace_id: "a" },
    { kind: "check", last_error: "OpenAI 502", workspace_id: "b" },
    { kind: "brief", last_error: null, workspace_id: null },
  ]);
  assert.deepEqual(lines, ["2 check jobs in 2 workspaces: OpenAI 500", "1 brief job: no error saved"]);
  assert.deepEqual(summarize([]), []);
});
