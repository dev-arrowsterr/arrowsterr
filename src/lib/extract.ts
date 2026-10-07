import "server-only";
import { askClaude, parseJson } from "./claude";

export type BrandMention = { name: string; position: number; sentiment: number };

const PROMPT = (brand: string, domain: string, answer: string) => `Read this answer from an AI assistant. List every brand, company or product it names as an option for the reader.

Tracked brand: ${brand} (${domain})

Answer:
"""
${answer}
"""

Return JSON only, in this shape: {"brands": [{"name": "Brand", "sentiment": 75}]}

Rules:
- Put brands in the order they first appear in the answer.
- Use each brand's common name, like "HubSpot" instead of "HubSpot CRM Free plan".
- If the tracked brand appears under any name or spelling, use exactly "${brand}".
- Skip websites that are only cited as sources, and skip generic words like "CRM software".
- sentiment is how positively the answer talks about that brand: 100 strongly recommended, 50 neutral, 0 warned against.
- If no brands are named, return {"brands": []}.`;

/** Have Claude Haiku pull out brands, their position and their sentiment from one answer. */
export async function extractBrands(brand: string, domain: string, answer: string): Promise<BrandMention[]> {
  if (!answer.trim()) return [];
  const { text } = await askClaude(PROMPT(brand, domain, answer.slice(0, 15000)), {
    model: process.env.EXTRACT_MODEL || "claude-haiku-4-5",
    maxTokens: 4000,
  });
  const data = parseJson(text);
  const list = Array.isArray(data.brands) ? data.brands : [];
  const seen = new Set<string>();
  const out: BrandMention[] = [];
  for (const b of list) {
    const name = typeof b?.name === "string" ? b.name.trim() : "";
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const s = Number(b.sentiment);
    out.push({ name, position: out.length + 1, sentiment: Number.isFinite(s) ? Math.max(0, Math.min(100, Math.round(s))) : 50 });
  }
  return out;
}
