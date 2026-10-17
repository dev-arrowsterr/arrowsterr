import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanDomain, cleanKeyword, cleanUrl, freeBlock, freeLimits, utcDayStart } from "../src/lib/freeLimits.ts";

const L = freeLimits("keyword");
const none = { mineTool: 0, mineAll: 0, toolToday: 0, spentToday: 0 };

test("a visitor gets 5 keyword runs a day and 40 across tools, then is asked to sign up", () => {
  assert.equal(freeBlock(none, L), null);
  assert.equal(freeBlock({ ...none, mineTool: 4 }, L), null);
  assert.equal(freeBlock({ ...none, mineTool: 5 }, L)?.kind, "visitor");
  assert.equal(freeBlock({ ...none, mineAll: 40 }, L)?.kind, "visitor");
});

test("tools that cost nothing keep working when the paid tools hit the day's spend", () => {
  const crawl = freeLimits("crawlers", { FREE_SPEND_DAY: "1", FREE_PER_TOOL: "1" });
  assert.equal(crawl.perTool, 20, "FREE_PER_TOOL only changes paid tools");
  assert.equal(freeBlock({ ...none, spentToday: 99 }, crawl), null);
  assert.equal(freeBlock({ ...none, toolToday: 3000 }, crawl)?.kind, "busy");
  assert.equal(freeLimits("links").cap, 300);
});

test("addresses are cleaned, and private or odd ones are refused", () => {
  assert.equal(cleanUrl("acme.com/pricing#top"), "https://acme.com/pricing");
  assert.equal(cleanUrl("http://www.acme.com"), "http://www.acme.com/");
  assert.equal(cleanDomain("https://www.Acme.com/blog"), "acme.com");
  for (const bad of ["localhost", "http://127.0.0.1", "http://169.254.169.254/latest", "http://[::1]/", "ftp://acme.com", "https://user:pw@acme.com", "https://acme.com:8080", "intranet.local", "http://10.0.0.1", "javascript:alert(1)", ""]) {
    assert.equal(cleanUrl(bad), null, bad);
  }
});

test("the tool's daily cap and the daily spend stop new paid runs for everyone", () => {
  assert.equal(L.cap, 500);
  assert.equal(freeBlock({ ...none, toolToday: 500 }, L)?.kind, "busy");
  assert.equal(freeBlock({ ...none, spentToday: 15 }, L)?.kind, "busy");
  assert.equal(freeBlock({ ...none, spentToday: 14.99 }, L), null);
});

test("server settings change the limits, and bad values fall back to the defaults", () => {
  const l = freeLimits("keyword", { FREE_CAP_KEYWORD: "50", FREE_PER_TOOL: "2", FREE_SPEND_DAY: "3", FREE_PER_VISITOR: "nope" });
  assert.deepEqual(l, { perTool: 2, perVisitor: 40, spendDay: 3, cap: 50, paid: true });
  assert.equal(freeLimits("keyword", { FREE_CAP_KEYWORD: "" }).cap, 500);
  assert.equal(freeLimits("keyword", { FREE_CAP_KEYWORD: "-1" }).cap, 500);
  assert.equal(freeBlock({ ...none, toolToday: 50 }, l)?.kind, "busy");
});

test("keywords are cleaned so junk can't make new paid lookups", () => {
  assert.equal(cleanKeyword("  Best   CRM  for Small Business "), "best crm for small business");
  assert.equal(cleanKeyword("café near me"), "café near me");
  assert.equal(cleanKeyword("phần mềm crm"), "phần mềm crm");
  assert.equal(cleanKeyword("a"), null);
  assert.equal(cleanKeyword("x".repeat(81)), null);
  assert.equal(cleanKeyword("https://acme.com"), null);
  assert.equal(cleanKeyword("<script>alert(1)</script>"), null);
  assert.equal(cleanKeyword("!!! ???"), null);
  assert.equal(cleanKeyword("one two three four five six seven eight nine ten eleven"), null);
  assert.equal(cleanKeyword(42), null);
});

test("the day resets at midnight UTC", () => {
  assert.equal(utcDayStart(Date.parse("2026-10-17T23:59:00Z")), "2026-10-17T00:00:00.000Z");
  assert.equal(utcDayStart(Date.parse("2026-10-18T00:00:01Z")), "2026-10-18T00:00:00.000Z");
});

import { privateIp } from "../src/lib/netCheck.ts";
test("private, local and cloud metadata addresses are refused, public ones pass", () => {
  for (const ip of ["127.0.0.1", "10.2.3.4", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1"]) assert.equal(privateIp(ip), true, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "104.18.2.3", "2606:4700::1111"]) assert.equal(privateIp(ip), false, ip);
});
