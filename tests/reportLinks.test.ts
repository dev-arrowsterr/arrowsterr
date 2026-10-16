import assert from "node:assert/strict";
import { test } from "node:test";
import { reportLimits } from "../src/lib/plans.ts";
import { checkPassword, checkPrint, checkSig, guardWhiteLabel, hashPassword, linkProblem, printPath, sign, unlockValue } from "../src/lib/reportLinks.ts";

process.env.REPORT_LINK_SECRET = "test-secret";
const NOW = Date.parse("2026-10-16T12:00:00Z");
const range = { preset: "lastMonth" as const, compare: "previous" as const };

test("live links need Starter and a client report; passwords and expiry need Pro", () => {
  const free = reportLimits("free");
  const starter = reportLimits("foundation");
  const pro = reportLimits("scale");
  const ask = { mode: "frozen" as const, kind: "client" as const, password: "", expires: null };
  assert.equal(linkProblem(ask, free, NOW), null, "frozen links are on every plan");
  assert.equal(linkProblem({ ...ask, mode: "live" }, free, NOW)?.limit, true);
  assert.equal(linkProblem({ ...ask, mode: "live" }, starter, NOW), null);
  assert.equal(linkProblem({ ...ask, mode: "live", kind: "prompts" }, pro, NOW)?.limit, undefined, "only client reports are live, on any plan");
  assert.ok(linkProblem({ ...ask, mode: "live", kind: "prompts" }, pro, NOW));
  assert.equal(linkProblem({ ...ask, password: "secret1" }, starter, NOW)?.limit, true);
  assert.equal(linkProblem({ ...ask, expires: new Date(NOW + 864e5) }, starter, NOW)?.limit, true);
  assert.equal(linkProblem({ ...ask, password: "secret1", expires: new Date(NOW + 864e5) }, pro, NOW), null);
  assert.ok(linkProblem({ ...ask, password: "short" }, pro, NOW), "a password under 6 characters is refused");
  assert.ok(linkProblem({ ...ask, expires: new Date(NOW - 1000) }, pro, NOW), "an expiry in the past is refused");
  assert.ok(linkProblem({ ...ask, expires: new Date("not a date") }, pro, NOW), "a bad date is refused");
});

test("white label is refused below Agency, even when the browser asks for it", () => {
  const data = { kind: "client", style: { agency: "Acme", whiteLabel: true } };
  for (const plan of ["free", "foundation", "scale", "thrive", "trial"] as const) {
    assert.equal(reportLimits(plan).whiteLabel, false, plan);
    assert.equal(guardWhiteLabel(data, reportLimits(plan).whiteLabel).style.whiteLabel, false, plan);
  }
  assert.equal(guardWhiteLabel(data, reportLimits("agency").whiteLabel).style.whiteLabel, true);
  assert.equal(guardWhiteLabel({ ...data, style: { agency: "Acme", whiteLabel: false } }, true).style.whiteLabel, false);
  assert.deepEqual(guardWhiteLabel({ kind: "prompts" }, false), { kind: "prompts" }, "reports with no style pass through");
  assert.equal(data.style.whiteLabel, true, "the input is not changed");
});

test("passwords hash with a salt and check right", async () => {
  const a = await hashPassword("open sesame");
  const b = await hashPassword("open sesame");
  assert.notEqual(a, b, "each hash has its own salt");
  assert.equal(await checkPassword("open sesame", a), true);
  assert.equal(await checkPassword("open sesame ", a), false);
  assert.equal(await checkPassword("wrong", a), false);
  assert.equal(await checkPassword("open sesame", "plain"), false, "a stored value that isn't a hash never opens");
  assert.equal(await checkPassword("open sesame", "scrypt$$"), false);
});

test("the unlock cookie only fits its own link and password", () => {
  const v = unlockValue("a".repeat(64), "scrypt$x$y");
  assert.equal(checkSig(`unlock:${"a".repeat(64)}:scrypt$x$y`, v), true);
  assert.equal(checkSig(`unlock:${"b".repeat(64)}:scrypt$x$y`, v), false, "another link");
  assert.equal(checkSig(`unlock:${"a".repeat(64)}:scrypt$x$z`, v), false, "the password changed");
  assert.equal(checkSig(`unlock:${"a".repeat(64)}:scrypt$x$y`, "not-hex"), false);
  assert.equal(checkSig("x", ""), false);
});

test("print links open one report, with its dates, for 15 minutes", () => {
  const path = printPath("rep1", range, 15 * 60_000, NOW);
  const u = new URL(path, "https://app.test");
  const [r, exp, sig] = [u.searchParams.get("range")!, u.searchParams.get("exp")!, u.searchParams.get("sig")!];
  assert.equal(u.pathname, "/r/print/rep1");
  assert.deepEqual(JSON.parse(r), range);
  assert.equal(checkPrint("rep1", r, exp, sig, NOW + 60_000), true);
  assert.equal(checkPrint("rep1", r, exp, sig, NOW + 16 * 60_000), false, "expired");
  assert.equal(checkPrint("rep2", r, exp, sig, NOW), false, "another report");
  assert.equal(checkPrint("rep1", JSON.stringify({ ...range, preset: "last7" }), exp, sig, NOW), false, "other dates");
  assert.equal(checkPrint("rep1", r, String(Number(exp) + 3600_000), sig, NOW), false, "a longer life");
  assert.equal(sign("x").length, 64);
});
