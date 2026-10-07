import "server-only";
import { askClaude, parseJson } from "./claude";
import { brandTerms, isTracked, parseRanking } from "./parse";

export type BrandMention = { name: string; position: number; sentiment: number; domain?: string };

const SENTIMENT = (names: string[], answer: string) => `Here is an answer from an AI assistant, and the brands it recommends.

Answer:
"""
${answer}
"""

Brands: ${JSON.stringify(names)}

For each brand:
- sentiment: how positively the answer talks about it. 100 strongly recommended, 50 neutral, 0 warned against.
- domain: the brand's main website domain, like "hubspot.com". Use "" if you are not sure.
Return JSON only, like {"Brand A": {"sentiment": 80, "domain": "branda.com"}}, using the exact brand names given.`;

const FULL = (brand: string, answer: string) => `Read this answer from an AI assistant. List every brand, company or product it names as an option for the reader.

Answer:
"""
${answer}
"""

Return JSON only: {"brands": [{"name": "Brand", "sentiment": 75, "domain": "brand.com"}]}
- Order brands by where they first appear. Use each brand's common name.
- If "${brand}" appears under any name, use exactly "${brand}".
- sentiment: 100 strongly recommended, 50 neutral, 0 warned against.
- domain: the brand's main website domain. Use "" if you are not sure.
- If no brands are named, return {"brands": []}.`;

const haiku = () => process.env.EXTRACT_MODEL || "claude-haiku-4-5";

function cleanDomain(d: unknown) {
  const v = typeof d === "string" ? d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] : "";
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(v) ? v : undefined;
}

function clamp(n: unknown) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 50;
}

/**
 * Brands named in an answer, with position and sentiment.
 * Names and positions come from the ranked list in the shared layout. Claude Haiku only scores sentiment.
 * If an engine ignored the layout, Haiku reads the whole answer instead.
 */
export async function extractBrands(brand: string, domain: string, answer: string): Promise<BrandMention[]> {
  if (!answer.trim()) return [];
  const terms = brandTerms(brand, domain);
  const text = answer.slice(0, 15000);
  let names = parseRanking(text);

  if (!names.length) {
    const { text: reply } = await askClaude(FULL(brand, text), { model: haiku(), maxTokens: 4000 });
    const list = parseJson(reply).brands;
    names = Array.isArray(list) ? list.map((b) => String(b?.name ?? "").trim()).filter(Boolean) : [];
    const info = Object.fromEntries((Array.isArray(list) ? list : []).map((b) => [String(b?.name ?? "").trim(), b]));
    return dedupe(names).map((n, i) => {
      const own = isTracked(n, terms);
      return { name: own ? brand : n, position: i + 1, sentiment: clamp(info[n]?.sentiment), domain: own ? domain : cleanDomain(info[n]?.domain) };
    });
  }

  // The tracked brand always shows under its own name, so the dashboard can find it.
  names = dedupe(names.map((n) => (isTracked(n, terms) ? brand : n)));
  let scores: Record<string, unknown> = {};
  try {
    const { text: reply } = await askClaude(SENTIMENT(names, text), { model: haiku(), maxTokens: 3000 });
    scores = parseJson(reply);
  } catch (e) {
    console.error("Sentiment failed, using 50:", e instanceof Error ? e.message : e);
  }
  return names.map((name, i) => {
    const v = scores[name] as { sentiment?: unknown; domain?: unknown } | number | undefined;
    const info = typeof v === "object" && v ? v : { sentiment: v };
    return { name, position: i + 1, sentiment: clamp(info.sentiment), domain: name === brand ? domain : cleanDomain(info.domain) };
  });
}

function dedupe(names: string[]) {
  const seen = new Set<string>();
  return names.filter((n) => {
    const k = n.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
