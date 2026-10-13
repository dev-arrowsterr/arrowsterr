import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeOf } from "../src/lib/scope.ts";

test("scopeOf: picks domain, subdomain, subfolder or exact page from the address", () => {
  const cases: [string, string | null][] = [
    ["momos.com", "domain"],
    ["https://www.momos.com/", "domain"],
    ["acme.co.uk", "domain"],
    ["blog.momos.com", "subdomain"],
    ["https://help.acme.co.uk", "subdomain"],
    ["momos.com/blog", "subfolder"],
    ["momos.com/blog/", "subfolder"],
    ["momos.com/en/blog", "subfolder"],
    ["momos.com/de", "subfolder"],
    ["momos.com/resources/guides/", "subfolder"],
    ["momos.com/pricing", "url"],
    ["momos.com/blog/restaurant-reviews", "url"],
    ["https://momos.com/blog/post?ref=x", "url"],
    ["momos.com/page.html", "url"],
    ["", null],
    ["not a site", null],
  ];
  for (const [input, want] of cases) assert.equal(scopeOf(input), want, input);
});
