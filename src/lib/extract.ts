import "server-only";
import { askClaude, parseJson } from "./claude";
import { brandTerms, isTracked, parseRanking } from "./parse";

export type BrandMention = { name: string; position: number; sentiment: number; domain?: string; topics?: string[] };

const topicRule = (topics: string[]) =>
  topics.length
    ? `- topics: which of these topics the answer links to that brand, based on what it says about it: ${JSON.stringify(topics)}. Use only these exact words. Use [] if none fit.`
    : "";

const TAG = (names: string[], answer: string, topics: string[]) => `Here is an answer from an AI assistant, and the brands it recommends.

Answer:
"""
${answer}
"""

Brands: ${JSON.stringify(names)}

For each brand:
- sentiment: how positively the answer talks about it. 100 strongly recommended, 50 neutral, 0 warned against.
- domain: the brand's main website domain, like "hubspot.com". Use "" if you are not sure.
${topicRule(topics)}
Return JSON only, like {"Brand A": {"sentiment": 80, "domain": "branda.com", "topics": []}}, using the exact brand names given.`;

const FULL = (brand: string, answer: string, topics: string[]) => `Read this answer from an AI assistant. List every brand, company or product it names as an option for the reader.

Answer:
"""
${answer}
"""

Return JSON only: {"brands": [{"name": "Brand", "sentiment": 75, "domain": "brand.com", "topics": []}]}
- Order brands by where they first appear. Use each brand's common name.
- If "${brand}" appears under any name, use exactly "${brand}".
- sentiment: 100 strongly recommended, 50 neutral, 0 warned against.
- domain: the brand's main website domain. Use "" if you are not sure.
${topicRule(topics)}
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

/** Keep only topics from the brand's list, spelled the way the list spells them. */
function cleanTopics(v: unknown, topics: string[]) {
  if (!Array.isArray(v)) return [];
  const byLower = new Map(topics.map((t) => [t.toLowerCase(), t]));
  return [...new Set(v.map((t) => byLower.get(String(t).toLowerCase().trim())).filter((t): t is string => Boolean(t)))];
}

type Info = { sentiment?: unknown; domain?: unknown; topics?: unknown };

/**
 * Brands named in an answer, with position, sentiment, website and topics.
 * Names and positions come from the ranked list in the shared layout. Claude Haiku adds the rest.
 * If an engine ignored the layout, Haiku reads the whole answer instead.
 */
export async function extractBrands(brand: string, domain: string, answer: string, topics: string[] = []): Promise<BrandMention[]> {
  if (!answer.trim()) return [];
  const terms = brandTerms(brand, domain);
  const text = answer.slice(0, 15000);
  const build = (name: string, i: number, info: Info | undefined): BrandMention => ({
    name,
    position: i + 1,
    sentiment: clamp(info?.sentiment),
    domain: name === brand ? domain : cleanDomain(info?.domain),
    topics: cleanTopics(info?.topics, topics),
  });

  let names = parseRanking(text);
  if (!names.length) {
    const { text: reply } = await askClaude(FULL(brand, text, topics), { model: haiku(), maxTokens: 4000 });
    const list = parseJson(reply).brands;
    const items = (Array.isArray(list) ? list : []).filter((b) => typeof b?.name === "string" && b.name.trim());
    const seen = new Set<string>();
    const out: BrandMention[] = [];
    for (const b of items) {
      const name = isTracked(b.name, terms) ? brand : String(b.name).trim();
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push(build(name, out.length, b));
    }
    return out;
  }

  // The tracked brand always shows under its own name, so the dashboard can find it.
  names = dedupe(names.map((n) => (isTracked(n, terms) ? brand : n)));
  let info: Record<string, unknown> = {};
  try {
    const { text: reply } = await askClaude(TAG(names, text, topics), { model: haiku(), maxTokens: 4000 });
    info = parseJson(reply);
  } catch (e) {
    console.error("Tagging failed, using defaults:", e instanceof Error ? e.message : e);
  }
  return names.map((name, i) => {
    const v = info[name];
    return build(name, i, typeof v === "object" && v ? (v as Info) : { sentiment: v });
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
