import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSources } from "../src/lib/sources.ts";

const s = (url: string, title: string | null = null) => ({ url, title, domain: "" });

test("cleanSources: drops asset links, unwraps redirects, strips tracking, merges repeats", () => {
  const out = cleanSources([
    s("https://api.dataforseo.com/cdn/i/10130736-1697-0139-0000-b21f300d0245:12"),
    s("https://example.com/cdn/i/abc:3"),
    s("https://joespizzanyc.com/menu/?utm_source=chatgpt.com"),
    s("https://www.joespizzanyc.com/menu"),
    s("https://www.google.com/url?q=https://www.yelp.com/biz/joes-pizza&sa=U"),
    s("https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC123", "eater.com"),
    s("https://vertexaisearch.cloud.google.com/grounding-api-redirect/XyZ", "Some article"),
    s("https://site.com/page?srsltid=abc&id=4#top"),
    s("https://images.openai.com/thumb.png"),
  ]);
  assert.deepEqual(
    out.map((x) => [x.url, x.domain]),
    [
      ["https://joespizzanyc.com/menu", "joespizzanyc.com"],
      ["https://www.yelp.com/biz/joes-pizza", "yelp.com"],
      ["https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC123", "eater.com"],
      ["https://site.com/page?id=4", "site.com"],
    ],
  );
});
