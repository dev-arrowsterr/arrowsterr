// Run: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../momos-router.html", import.meta.url), "utf8");
const code = html.match(/<script>([\s\S]*)<\/script>/)[1];
const ctx = vm.createContext({});
vm.runInContext(code, ctx);
const R = ctx.MomosRouter;

const base = { "Work Email": "ana@burgerco.com", Company: "Burger Co", "How Many Locations Does Your Business Have": "25" };
const go = (extra, tz = "") => R.decide({ ...base, ...extra }, tz);

test("West Coast and APAC go to James", () => {
  assert.equal(go({ Country: "United States", State: "California" }).ae, "James");
  assert.equal(go({ Country: "USA", State: "CO" }).ae, "James");
  assert.equal(go({ Country: "Canada", State: "British Columbia" }).ae, "James");
  assert.equal(go({ Country: "Singapore" }).ae, "James");
  assert.equal(go({ Country: "Australia" }).ae, "James");
});

test("East Coast and Middle East / Europe go to Jill", () => {
  assert.equal(go({ Country: "United States", State: "New York" }).ae, "Jill");
  assert.equal(go({ Country: "US", State: "TX" }).ae, "Jill");
  assert.equal(go({ Country: "United Arab Emirates" }).ae, "Jill");
  assert.equal(go({ Country: "United Kingdom" }).ae, "Jill");
  assert.equal(go({ Country: "Brazil" }).region, "unknown");
});

test("time zone fills in when state or country is missing", () => {
  assert.equal(go({ Country: "United States" }, "America/Los_Angeles").ae, "James");
  assert.equal(go({ Country: "United States" }, "America/New_York").ae, "Jill");
  assert.equal(go({}, "Asia/Singapore").region, "apac");
  assert.equal(go({}, "Asia/Dubai").region, "emea");
  assert.equal(go({}, "Europe/London").region, "emea");
  assert.equal(go({}, "America/Denver").region, "us_west");
});

test("ICP by locations", () => {
  assert.equal(go({ "How Many Locations Does Your Business Have": "1" }).icp, "not_fit");
  assert.equal(go({ "How Many Locations Does Your Business Have": "1" }).redirect_url, R.CONFIG.notFitUrl);
  assert.equal(go({ "How Many Locations Does Your Business Have": "2-5" }).icp, "fit");
  assert.equal(go({ "How Many Locations Does Your Business Have": "50+" }).icp, "fit");
  assert.equal(go({ "How Many Locations Does Your Business Have": "" }).icp, "maybe");
  assert.equal(go({ "How Many Locations Does Your Business Have": "" }).ae, "Jill");
});

test("junk is rejected", () => {
  assert.equal(go({ "Work Email": "x@mailinator.com" }).icp, "rejected");
  assert.equal(go({ "Work Email": "not-an-email" }).icp, "rejected");
  assert.equal(go({ Company: "test" }).icp, "rejected");
});

test("full name splits into first and last", () => {
  const d = go({ Name: "Ana Maria Lopez" });
  assert.equal(d.lead.first_name, "Ana");
  assert.equal(d.lead.last_name, "Maria Lopez");
});

test("decision takes well under a millisecond", () => {
  const n = 100000;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) go({ Country: "United States", State: "Oregon" }, "America/Los_Angeles");
  const each = (performance.now() - t0) / n;
  console.log(`decide(): ${(each * 1000).toFixed(2)} microseconds per lead`);
  assert.ok(each < 1);
});
