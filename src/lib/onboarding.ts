// Claude prompts for onboarding: research the brand, pick topics, write prompts.
import type { BrandCard, BusinessType, Position, Profile, RivalCard } from "./db";

export const BUSINESS_TYPES: { id: BusinessType; label: string }[] = [
  { id: "saas", label: "SaaS / Software" },
  { id: "ecommerce", label: "Ecommerce / DTC brand" },
  { id: "service", label: "Service business / Agency" },
  { id: "local", label: "Local business" },
  { id: "marketplace", label: "Marketplace / Aggregator" },
  { id: "other", label: "Other / Not sure" },
];

export const COUNTRIES = [
  "United States",
  "United Kingdom",
  "Canada",
  "Australia",
  "Germany",
  "France",
  "Spain",
  "Netherlands",
  "India",
  "Singapore",
  "Vietnam",
  "Japan",
  "Brazil",
  "Mexico",
  "Global",
];

export const MAX_TOPICS = 5;
export const PROMPTS_PER_TOPIC = 5;
export const MAX_PROMPTS = MAX_TOPICS * PROMPTS_PER_TOPIC;

export const SUGGESTED_PER_TOPIC = 10; // prompts written per topic: the top 5 are tracked, the rest suggested
export const CANDIDATE_TOPICS = 50;

const PLAIN = `Write in plain, professional English that a busy founder reads in seconds. Short bullets, no filler, no hype words like "seamless", "robust" or "cutting-edge".`;

// ── Step 1: research the brand and its market ──────────────────────────────────

/** First pass, with web search: notes on the brand, its category and its closest competitors. */
export const RESEARCH_PROMPT = (url: string, title: string, desc: string, text: string) => `You are a B2B market analyst. Research this business and its market before a positioning review.

Website: ${url}
Page title: ${title}
Meta description: ${desc}
Website text (homepage and key pages):
${text}

Search the web to fill gaps. Find:
1. What the product is, who uses it, the job it does, its key features, and what it believes.
2. Its category, the way buyers name it.
3. Its 5 closest competitors: products a buyer would compare it with directly, not giant suites unless buyers really shortlist them. For each: who it serves, how it works, its price level, and how it differs from this business.
4. Its price level against those competitors, the company size it serves, and where its buyers are.

Write clear research notes. Name real competitors with their websites.`;

/** Second pass: turn the notes into the Brand Card, the competitor table and the category position. */
export const SITE_PROMPT = (url: string, notes: string, text: string) => `You turn research notes into a positioning review for the business at ${url}.

Research notes:
${notes}

Website text:
${text.slice(0, 6000)}

Fill in:
- name: the brand name as customers say it.
- businessType: saas (software, apps, platforms), ecommerce (sells products online), service (agencies, firms, consultants), local (serves one city or area), marketplace (connects buyers and sellers, or lists many providers), other.
- products, customers, features: short comma lists in the words customers use.
- card: the brand on one page, 2 to 4 bullets each, each bullet under 18 words.
  - who: what it is and who uses it.
  - whereTo: the outcome it helps them reach.
  - howTo: how it delivers that, with the key features that matter.
  - whySo: what it believes, and the problem it fights.
- competitors: exactly 5 closest competitors, closest first. who and howTo under 14 words each. price is "Budget", "Mid", "Premium" or a range like "Mid–Premium". difference is one sentence on how it differs from this brand, under 22 words.
- position: price level vs. these competitors, company size served (Solo, SMB, Mid-market, Enterprise, or a range like "Solo–SMB"), region where its buyers are, and a summary of 2 or 3 bullets on where the brand sits in its industry and where it can win.

${PLAIN}`;

const bullets = { type: "array", items: { type: "string" } };
export const SITE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "businessType", "products", "customers", "features", "card", "competitors", "position"],
  properties: {
    name: { type: "string" },
    businessType: { type: "string", enum: ["saas", "ecommerce", "service", "local", "marketplace", "other"] },
    products: { type: "string" },
    customers: { type: "string" },
    features: { type: "string" },
    card: {
      type: "object",
      additionalProperties: false,
      required: ["who", "whereTo", "howTo", "whySo"],
      properties: { who: bullets, whereTo: bullets, howTo: bullets, whySo: bullets },
    },
    competitors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "domain", "who", "howTo", "price", "difference"],
        properties: { name: { type: "string" }, domain: { type: "string" }, who: { type: "string" }, howTo: { type: "string" }, price: { type: "string" }, difference: { type: "string" } },
      },
    },
    position: {
      type: "object",
      additionalProperties: false,
      required: ["price", "size", "region", "summary"],
      properties: { price: { type: "string", enum: ["budget", "mid", "premium"] }, size: { type: "string" }, region: { type: "string" }, summary: { type: "array", items: { type: "string" } } },
    },
  },
};

// ── Step 2: 50 candidate topics, then the 5 best ───────────────────────────────

// How buyers usually phrase a category, by business type. Examples only: the research decides the topics.
const TYPE_RULES: Record<BusinessType, string> = {
  saas: `Buyers usually search like "best [category] software" or "best [category] tool for [use]".`,
  ecommerce: `Buyers usually search like "best [product]" or "best [product] for [need]".`,
  service: `Buyers usually search like "best [service] agency" or "[service] company for [industry]".`,
  local: `Buyers usually search like "best [service] in [city]".`,
  marketplace: `Buyers usually search like "best [thing] marketplace" or "best sites to [book or find thing]".`,
  other: `Buyers usually search like "best [category]".`,
};

const about = (name: string, site: string, p: Profile) => {
  const lines = [
    `Business: ${name} (${site})`,
    `Type: ${BUSINESS_TYPES.find((t) => t.id === p.businessType)?.label ?? "Not sure"}`,
    `Products and services: ${p.products || "Not given"}`,
    `Customers: ${p.customers || "Not given"}`,
    `Key features: ${p.features || "Not given"}`,
    `Market: ${p.country || "United States"}`,
  ];
  if (p.card) lines.push(`Who: ${p.card.who.join(" ")}`, `Where-to: ${p.card.whereTo.join(" ")}`, `How-to: ${p.card.howTo.join(" ")}`, `Why-so: ${p.card.whySo.join(" ")}`);
  if (p.position) lines.push(`Price level: ${p.position.price}. Company size served: ${p.position.size}. Region: ${p.position.region}.`);
  if (p.competitors?.length) lines.push(`Closest competitors and how they differ:\n${p.competitors.map((c) => `- ${c.name}: ${c.difference}`).join("\n")}`);
  return lines.join("\n");
};

export const TOPICS_PROMPT = (name: string, site: string, p: Profile) => `You pick the buying categories an AI search visibility tool will track for a business. A topic is the category a buyer is in when they ask ChatGPT which option to choose.

${about(name, site, p)}

${TYPE_RULES[p.businessType ?? "other"]}

Write ${CANDIDATE_TOPICS} candidate topics, based on the research above. Let the research decide what fits this business best.
- Bottom of the funnel: the buyer is ready to compare and choose.
- 5 words or fewer, lowercase except brand and place names. Simple, precise, real search phrases.
- Cover the whole market: the main category, then each distinct buyer type, use case, platform or need this business serves.
- No duplicates. Plurals, synonyms and reworded topics count as the same topic.
- Never include ${name} itself.
- group: a 2 to 4 word label for the buyer and need the topic serves, like "solo wordpress developers" or "enterprise localization teams". Topics that serve the same buyer and need share the exact same label.
- relevance 1 to 5: how likely a buyer in this topic would choose ${name}. Give 5 only when the topic matches how ${name} differs from its competitors.
- buyer: who searches this, in under 8 words.
- reason: why it fits, in under 15 words.`;

export const TOPICS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["topics"],
  properties: {
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "group", "relevance", "buyer", "reason"],
        properties: {
          topic: { type: "string" },
          group: { type: "string" },
          relevance: { type: "integer", enum: [1, 2, 3, 4, 5] },
          buyer: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
};

export type Candidate = { topic: string; group: string; relevance: number; buyer: string; reason: string; volume: number | null };
export type PickedTopic = Candidate & { score: number };

const FILLER = new Set(["best", "top", "software", "tools", "tool", "app", "apps", "platform", "platforms", "services", "service", "agency", "agencies", "for", "the", "a", "an", "and", "of", "in", "to", "with", "near", "company", "companies", "online"]);
const termsOf = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !FILLER.has(w)).map((w) => w.replace(/s$/, "")));
function overlap(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
}

/**
 * Pick the topics to track. Score = Volume × Relevance × Diversity.
 * Volume is on a log scale so one huge topic cannot win on size alone. Diversity: each buyer
 * group gives at most one topic, and topics that share words with a pick score lower. So the
 * final set spreads across as many different buyers and needs as the candidates allow.
 */
export function pickTopics(cands: Candidate[], n = MAX_TOPICS): PickedTopic[] {
  const pool = cands.filter((c) => (c.volume ?? 0) > 0 || c.relevance >= 5);
  if (!pool.length) return [];
  const top = Math.log10(Math.max(...pool.map((c) => c.volume ?? 0)) + 10);
  const base = (c: Candidate) => (Math.log10((c.volume ?? 0) + 10) / top) * Math.pow(c.relevance / 5, 1.5);
  const terms = new Map(pool.map((c) => [c.topic, termsOf(c.topic)]));
  const groupOf = (c: Candidate) => c.group.trim().toLowerCase();
  const out: PickedTopic[] = [];
  const left = [...pool];
  while (out.length < n && left.length) {
    // A new buyer group first. Only reuse a group once every group has a topic.
    const fresh = left.filter((c) => !out.some((o) => groupOf(o) === groupOf(c)));
    const choices = fresh.length ? fresh : left;
    let best: Candidate | null = null;
    let bestScore = -1;
    for (const c of choices) {
      const near = Math.max(0, ...out.map((o) => overlap(terms.get(c.topic)!, terms.get(o.topic)!)));
      const score = base(c) * (1 - near);
      if (score > bestScore) [best, bestScore] = [c, score];
    }
    if (!best) break;
    out.push({ ...best, score: Math.round(bestScore * 100) / 100 });
    left.splice(left.indexOf(best), 1);
  }
  return out;
}

// ── Step 3: prompts by angle ───────────────────────────────────────────────────

export const ANGLES = [
  { id: "head", label: "Head search", hint: "the topic itself as a short search" },
  { id: "persona", label: "Persona", hint: "best pick for a specific type of buyer" },
  { id: "size", label: "Team size", hint: "fit for a company or team size" },
  { id: "industry", label: "Industry", hint: "fit for a specific industry" },
  { id: "problem", label: "Problem", hint: "a pain the buyer has, asking which tool fixes it" },
  { id: "feature", label: "Feature", hint: "must have a specific feature" },
  { id: "budget", label: "Budget", hint: "free, cheap or premium options" },
  { id: "platform", label: "Platform", hint: "works on a device or operating system" },
  { id: "integration", label: "Integration", hint: "works with another tool" },
  { id: "region", label: "Region", hint: "fit for a country, region or language" },
  { id: "alternatives", label: "Alternatives", hint: "alternatives to a named competitor" },
  { id: "versus", label: "Versus", hint: "two named options compared" },
  { id: "shortlist", label: "Shortlist", hint: "top options to compare" },
  { id: "switching", label: "Switching", hint: "replacing a current tool or method" },
] as const;
export type Angle = (typeof ANGLES)[number]["id"];

export const PROMPTS_PROMPT = (name: string, site: string, p: Profile, topics: string[]) => `You write the prompts an AI visibility tool sends to ChatGPT, Gemini, Perplexity, Claude and Google every day, to see which brands they recommend.

${about(name, site, p)}

Topics:
${topics.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Angles:
${ANGLES.map((a) => `- ${a.id}: ${a.hint}`).join("\n")}

For each topic, write ${SUGGESTED_PER_TOPIC} prompts, each from a different angle. Pick the angles that fit this niche best, best fit first. The first prompt is always "head": exactly the topic text.

Every prompt must:
- Make the AI answer with named brands, tools, products or providers. Use words like "best", "top", "which", "recommend", "alternatives to" or "vs".
- Never be a how-to, what-is or why question. Never ask "what should I look for".
- Be concise and natural, the way a real buyer types into ChatGPT.
- Fit ${name}'s price level, company size and region, using their buyers' words.
- Never include ${name} or ${site}. Competitor names are allowed only in alternatives and versus prompts.
- Differ from every other prompt in meaning, across all topics.`;

export const PROMPTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["topics"],
  properties: {
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "prompts"],
        properties: {
          topic: { type: "string" },
          prompts: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text", "angle"],
              properties: { text: { type: "string" }, angle: { type: "string", enum: ANGLES.map((a) => a.id) } },
            },
          },
        },
      },
    },
  },
};

// Questions whose answers explain ideas and seldom name brands.
const NO_BRANDS = /^\s*(how (to|do|does|can|should)|what (is|are|does)|why|when|what should i look for|what to look for|tips?\b|guide to)\b/i;
/** Prompts the AI will answer with brand names. Drops how-to style prompts and near duplicates. */
export function cleanPrompts(list: { text: string; angle: string }[], topic: string, seen: Set<string>[], brand = "") {
  const out: { text: string; angle: Angle }[] = [];
  const own = termsOf(topic);
  for (const p of list) {
    const text = String(p.text ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
    if (!text || NO_BRANDS.test(text)) continue;
    // A prompt that names the brand itself always "finds" it, so it measures nothing.
    if (brand && text.toLowerCase().includes(brand.toLowerCase())) continue;
    // Every prompt shares the topic's words, so compare only what each prompt adds.
    const t = new Set([...termsOf(text)].filter((w) => !own.has(w)));
    if (p.angle !== "head" && (!t.size || seen.some((s) => overlap(s, t) >= 0.5))) continue;
    if (t.size) seen.push(t);
    out.push({ text, angle: (ANGLES.some((a) => a.id === p.angle) ? p.angle : "shortlist") as Angle });
  }
  if (!out.some((p) => p.angle === "head")) out.unshift({ text: topic, angle: "head" });
  return out.slice(0, SUGGESTED_PER_TOPIC);
}

/** Clean a list of strings from Claude: trimmed, no blanks, no repeats. */
export function cleanList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const s = x.trim().replace(/\s+/g, " ");
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s.slice(0, 300));
  }
  return out.slice(0, max);
}

export function cleanProfile(v: unknown): Profile {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim().slice(0, 600) : "");
  const type = BUSINESS_TYPES.some((t) => t.id === o.businessType) ? (o.businessType as BusinessType) : "other";
  const list = (x: unknown, n: number) => cleanList(x, n).map((v) => v.slice(0, 240));
  const c = (o.card && typeof o.card === "object" ? o.card : null) as Record<string, unknown> | null;
  const card: BrandCard | undefined = c ? { who: list(c.who, 4), whereTo: list(c.whereTo, 4), howTo: list(c.howTo, 4), whySo: list(c.whySo, 4) } : undefined;
  const competitors: RivalCard[] | undefined = Array.isArray(o.competitors)
    ? (o.competitors as Record<string, unknown>[])
        .filter((r) => r && typeof r.name === "string" && r.name.trim())
        .slice(0, 8)
        .map((r) => {
          const f = (k: string) => (typeof r[k] === "string" ? (r[k] as string).trim().slice(0, 240) : "");
          return { name: f("name"), domain: f("domain").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase(), who: f("who"), howTo: f("howTo"), price: f("price"), difference: f("difference") };
        })
    : undefined;
  const q = (o.position && typeof o.position === "object" ? o.position : null) as Record<string, unknown> | null;
  const position: Position | undefined = q
    ? {
        price: (["budget", "mid", "premium"].includes(String(q.price)) ? q.price : "mid") as Position["price"],
        size: typeof q.size === "string" ? q.size.trim().slice(0, 60) : "",
        region: typeof q.region === "string" ? q.region.trim().slice(0, 80) : "",
        summary: list(q.summary, 3),
      }
    : undefined;
  return {
    ...(card ? { card } : {}),
    ...(competitors ? { competitors } : {}),
    ...(position ? { position } : {}),
    products: str("products"),
    customers: str("customers"),
    features: str("features"),
    businessType: type,
    country: COUNTRIES.includes(str("country")) ? str("country") : "United States",
  };
}
