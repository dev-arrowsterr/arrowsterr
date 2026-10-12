import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { normalizeLead, verifyFramerSignature } from "../src/lead.ts";
import { regionFromLocation } from "../src/regions.ts";
import { routeLead } from "../src/router.ts";
import type { Decision } from "../src/claude.ts";
import type { Checks } from "../src/verify.ts";

test("regions map to the right territory", () => {
  assert.equal(regionFromLocation("United States", "California"), "us_west");
  assert.equal(regionFromLocation("USA", "CO"), "us_west");
  assert.equal(regionFromLocation("US", "New York"), "us_east");
  assert.equal(regionFromLocation("United States", "Texas"), "us_east");
  assert.equal(regionFromLocation("United States", ""), "unknown");
  assert.equal(regionFromLocation("Canada", "British Columbia"), "us_west");
  assert.equal(regionFromLocation("Canada", "Ontario"), "us_east");
  assert.equal(regionFromLocation("United Arab Emirates"), "emea");
  assert.equal(regionFromLocation("United Kingdom"), "emea");
  assert.equal(regionFromLocation("Singapore"), "apac");
  assert.equal(regionFromLocation("Australia"), "apac");
  assert.equal(regionFromLocation("Brazil"), "unknown");
});

test("form fields are mapped from loose names", () => {
  const lead = normalizeLead({
    "Full Name": "Ana Maria Lopez",
    "Work Email": "ana@burgerco.com",
    "Company Name": "Burger Co",
    "Number of Locations": "24",
    Country: "United States",
    "State / Province": "Oregon",
  });
  assert.equal(lead.firstName, "Ana");
  assert.equal(lead.lastName, "Maria Lopez");
  assert.equal(lead.email, "ana@burgerco.com");
  assert.equal(lead.company, "Burger Co");
  assert.equal(lead.locations, "24");
  assert.equal(lead.state, "Oregon");
});

test("Framer signature check", () => {
  const body = '{"email":"a@b.com"}';
  const id = "sub_123";
  const sig = "sha256=" + createHmac("sha256", "s3cret").update(body + id).digest("hex");
  assert.equal(verifyFramerSignature(body, sig, id, "s3cret"), true);
  assert.equal(verifyFramerSignature(body, sig, id, "wrong"), false);
  assert.equal(verifyFramerSignature(body, undefined, id, "s3cret"), false);
});

const goodChecks: Checks = {
  emailValid: true,
  emailDomain: "burgerco.com",
  freeEmail: false,
  disposableEmail: false,
  domainAcceptsMail: true,
  websiteMatchesEmail: true,
  phoneLooksReal: true,
  looksLikeTest: false,
};

const decision = (over: Partial<Decision> = {}): Decision => ({
  summary: "",
  company: "Burger Co",
  locationCount: "24",
  region: "unknown",
  regionReason: "",
  legit: true,
  icpFit: "fit",
  icpReason: "",
  redFlags: [],
  ...over,
});

const deps = (d: Decision | Error, checks = goodChecks) => ({
  runChecks: async () => checks,
  decide: async () => {
    if (d instanceof Error) throw d;
    return d;
  },
  notify: async () => {},
});

test("form region wins over Claude's guess", async () => {
  const lead = normalizeLead({ email: "a@burgerco.com", country: "USA", state: "CA" });
  const r = await routeLead(lead, deps(decision({ region: "us_east" })));
  assert.equal(r.outcome, "routed");
  assert.equal(r.ae?.name, "James");
});

test("Claude fills in region when the form doesn't say", async () => {
  const lead = normalizeLead({ email: "a@burgerco.ae" });
  const r = await routeLead(lead, deps(decision({ region: "emea" })));
  assert.equal(r.ae?.name, "Jill");
});

test("APAC goes to James, East Coast to Jill", async () => {
  const sg = await routeLead(normalizeLead({ email: "a@x.sg", country: "Singapore" }), deps(decision()));
  assert.equal(sg.ae?.name, "James");
  const ny = await routeLead(normalizeLead({ email: "a@x.com", country: "US", state: "NY" }), deps(decision()));
  assert.equal(ny.ae?.name, "Jill");
});

test("not ICP and spam do not get a calendar", async () => {
  const lead = normalizeLead({ email: "a@agency.com", country: "US", state: "CA" });
  const notFit = await routeLead(lead, deps(decision({ icpFit: "not_fit" })));
  assert.equal(notFit.outcome, "not_fit");
  assert.equal(notFit.ae, undefined);
  const spam = await routeLead(lead, deps(decision({ legit: false })));
  assert.equal(spam.outcome, "rejected");
});

test("ICP maybe still gets routed", async () => {
  const lead = normalizeLead({ email: "a@x.com", country: "Japan" });
  const r = await routeLead(lead, deps(decision({ icpFit: "maybe" })));
  assert.equal(r.outcome, "routed");
  assert.equal(r.ae?.name, "James");
});

test("bad email is rejected before Claude runs", async () => {
  let called = false;
  const r = await routeLead(normalizeLead({ email: "x@mailinator.com" }), {
    runChecks: async () => ({ ...goodChecks, disposableEmail: true }),
    decide: async () => {
      called = true;
      return decision();
    },
    notify: async () => {},
  });
  assert.equal(r.outcome, "rejected");
  assert.equal(called, false);
});

test("Claude outage still routes on form fields", async () => {
  const lead = normalizeLead({ email: "a@x.com", country: "US", state: "WA" });
  const r = await routeLead(lead, deps(new Error("timeout")));
  assert.equal(r.outcome, "routed");
  assert.equal(r.ae?.name, "James");
  assert.equal(r.claudeError, "timeout");
});
