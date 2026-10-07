import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRanking, brandTerms, isTracked } from "../src/lib/parse.ts";
const a = `Some intro with 2024 numbers.

## Recommendations
1. **Birdeye** - Great for multi-location restaurants. [link](https://birdeye.com)
2. **Momos AI** - Built for restaurants.
3. [Podium](https://podium.com) - SMS reviews.
4) **Yelp for Business**: free tier.

## Summary
1. Not a list item to count.`;
test("parses only the recommendations list", () => {
  assert.deepEqual(parseRanking(a), ["Birdeye", "Momos AI", "Podium", "Yelp for Business"]);
});
test("works without headings", () => {
  assert.deepEqual(parseRanking("1. **A** x\n2. **B** y"), ["A", "B"]);
});
test("tracked brand match", () => {
  const t = brandTerms("Momos", "momos.com");
  assert.ok(isTracked("Momos AI", t));
  assert.ok(!isTracked("Birdeye", t));
});
