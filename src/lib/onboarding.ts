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

export const MAX_TOPICS = 8; // topics a brand can track
export const RECOMMENDED = 5; // the first 5 topics, and the first 5 prompts of each, are highly recommended
export const PROMPTS_PER_TOPIC = 5;
export const MAX_PROMPTS = 25; // prompts tracked by default, within the trial's limit
export const TOPIC_COUNT = 8;
export const PROMPT_COUNT = 8; // prompts written per topic: 5 highly recommended, 3 suggested

// ── Research, then the 8 topics, in one structured reply ────────────────────────

/** First pass, with web search: notes on the business, its offering, buyers and competitors. */
export const RESEARCH_PROMPT = (url: string, title: string, desc: string, text: string) => `You are a B2B market analyst. Research this business before planning its bottom-of-funnel keywords.

Website: ${url}
Page title: ${title}
Meta description: ${desc}
Website text (homepage and key pages):
${text}

Search the web to fill gaps. Write clear research notes on:
1. Every product and service it sells, in the words customers use, plus common synonyms.
2. What customers call the seller (software, agency, lawyer, supplier, clinic, and so on).
3. Its industry, and the area it serves: local (which cities), national or global.
4. Its target audiences and main use cases.
5. Its top 3 to 5 competitors, with their websites.
State every assumption you make.`;

export const BUCKETS = [
  { id: "shortlist", label: "Shortlist", page: "Listicle" },
  { id: "versus", label: "Head-to-head", page: "Comparison page" },
  { id: "alternatives", label: "Alternatives", page: "Alternatives page" },
  { id: "vetting", label: "Brand vetting", page: "Review page" },
  { id: "cost", label: "Cost", page: "Pricing page" },
  { id: "action", label: "Action", page: "Landing page" },
  { id: "deal", label: "Deal", page: "Offer page" },
  { id: "local", label: "Local and urgent", page: "Location page" },
  { id: "switching", label: "Switching", page: "Migration page" },
  { id: "fit", label: "Fit", page: "Use-case page" },
] as const;
export type Bucket = (typeof BUCKETS)[number]["id"];

/** Second pass: the business in a few fields, and its 8 best BOFU topics, following the BOFU keyword framework. */
export const PLAN_PROMPT = (url: string, notes: string, text: string) => `You plan the topics an AI search visibility tool will track for the business at ${url}. A topic is a bottom-of-funnel (BOFU) search: typed by someone ready to buy, hire, book or switch.

Research notes:
${notes}

Website text:
${text.slice(0, 6000)}

Part 1: the business.
- name: the brand name as customers say it.
- businessType: saas (software, apps, platforms), ecommerce (sells products online), service (agencies, firms, consultants), local (serves one city or area), marketplace (connects buyers and sellers), other.
- country: the main market, one of: ${COUNTRIES.join(", ")}.
- products, customers, features: short comma lists in the words customers use.
- competitors: the top 3 to 5, with their domains.

Part 2: the 8 best BOFU topics. Follow this method.
1. Seeds: every offering noun (each product, service and category, with synonyms), provider nouns (what customers call the seller) and competitor brand names. Never the business's own brand.
2. Run the seeds through the 10 modifier buckets. Each topic belongs to exactly one bucket:
${BUCKETS.map((b, i) => `   ${i + 1}. ${b.id}: ${b.label} → ${b.page}`).join("\n")}
   Patterns: shortlist "best / top [seed]"; versus "[brand] vs [brand]"; alternatives "[competitor] alternatives"; vetting "[competitor] reviews"; cost "[seed] pricing / cost"; action "[seed] free trial / demo / hire / book"; deal "[seed] discount"; local "[seed] in [city] / near me"; switching "switch from [competitor]"; fit "[seed] for [audience / use case / feature]".
3. Filter out anything with learning intent (how to, what is, guide, examples, template), anything no real buyer would type, and near duplicates.
4. Favor the buckets that matter most in this industry: B2B and SaaS 2, 3, 4, 9 plus 1 and 10; local services 5, 6, 8; ecommerce 1, 6, 7, 10; healthcare and legal 4, 5, 8.
5. Pick the 8 best. They must be strictly mutually exclusive and non-overlapping, and together cover the entire product suite and the widest spread of buyers. Be as diverse as possible: different products, audiences, use cases and buckets. Use at most 2 topics from any one bucket.
6. Rank from most relevant to least. The first 5 are the ones this business must win.
- topic: 2 to 6 words, lowercase except brand and place names, the way a buyer types it.
- seed: the seed the topic came from.
- reason: why a buyer here is ready to choose, and why this business fits, in under 18 words.

Use the words customers use. No internal jargon.`;

export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "businessType", "country", "products", "customers", "features", "competitors", "topics"],
  properties: {
    name: { type: "string" },
    businessType: { type: "string", enum: ["saas", "ecommerce", "service", "local", "marketplace", "other"] },
    country: { type: "string", enum: COUNTRIES },
    products: { type: "string" },
    customers: { type: "string" },
    features: { type: "string" },
    competitors: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["name", "domain"], properties: { name: { type: "string" }, domain: { type: "string" } } },
    },
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "bucket", "seed", "reason"],
        properties: { topic: { type: "string" }, bucket: { type: "string", enum: BUCKETS.map((b) => b.id) }, seed: { type: "string" }, reason: { type: "string" } },
      },
    },
  },
};

export type PickedTopic = { topic: string; bucket: Bucket; seed: string; reason: string; volume: number | null };

/** The 8 topics, cleaned: no blanks, no duplicates, no brand name, in the AI's order. */
export function cleanTopics(v: unknown, brand: string): Omit<PickedTopic, "volume">[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: Omit<PickedTopic, "volume">[] = [];
  for (const t of v as Record<string, unknown>[]) {
    const topic = String(t?.topic ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
    const key = topic.toLowerCase();
    if (!topic || seen.has(key) || (brand && key.includes(brand.toLowerCase()))) continue;
    seen.add(key);
    const bucket = (BUCKETS.some((b) => b.id === t.bucket) ? t.bucket : "shortlist") as Bucket;
    out.push({ topic, bucket, seed: String(t.seed ?? "").slice(0, 80), reason: String(t.reason ?? "").slice(0, 200) });
  }
  return out.slice(0, TOPIC_COUNT);
}

// ── Prompts by angle ───────────────────────────────────────────────────────────

/** Content angles from the BOFU angle framework, plus the topic itself as a plain search. */
export const ANGLES = [
  { id: "head", label: "Head search", hint: "the topic itself, as a short search" },
  { id: "audience", label: "Audience fit", hint: "best for a specific audience, role or use case" },
  { id: "budget", label: "Budget", hint: "best for a budget or price range" },
  { id: "feature", label: "Feature", hint: "best for a specific feature or integration" },
  { id: "outcome", label: "Outcome", hint: "best for a specific business result" },
  { id: "comparison", label: "Comparison", hint: "named options compared on features, pricing or performance" },
  { id: "unhappy", label: "Unhappy switch", hint: "an alternative for people dissatisfied with a named tool" },
  { id: "outgrown", label: "Outgrown", hint: "an alternative for people who outgrew a named tool" },
  { id: "pros_cons", label: "Pros and cons", hint: "strengths and limits of the top options" },
  { id: "hidden_costs", label: "Hidden costs", hint: "total cost and pricing traps" },
  { id: "setup", label: "Easy setup", hint: "fastest or easiest to implement" },
  { id: "industry", label: "Industry needs", hint: "fits an industry's specific requirements" },
  { id: "risk", label: "Risk", hint: "avoiding purchase mistakes and objections" },
  { id: "specialized", label: "Specialized", hint: "specialized versus general-purpose options" },
  { id: "size", label: "Company size", hint: "fits a company size or stage" },
] as const;
export type Angle = (typeof ANGLES)[number]["id"];

export const MOTIVATIONS = ["price", "features", "alternatives", "comparison", "trust", "convenience", "specialization", "risk reduction", "performance", "availability"] as const;

const about = (name: string, site: string, p: Profile) =>
  [
    `Business: ${name} (${site})`,
    `Type: ${BUSINESS_TYPES.find((t) => t.id === p.businessType)?.label ?? "Not sure"}`,
    `Products and services: ${p.products || "Not given"}`,
    `Customers: ${p.customers || "Not given"}`,
    `Key features: ${p.features || "Not given"}`,
    `Market: ${p.country || "United States"}`,
    p.competitors?.length ? `Competitors: ${p.competitors.map((c) => c.name).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

export const PROMPTS_PROMPT = (name: string, site: string, p: Profile, topics: string[]) => `You write the prompts an AI visibility tool sends to ChatGPT, Gemini, Perplexity, Claude and Google every day, to see which brands they recommend.

${about(name, site, p)}

Topics:
${topics.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Method, for each topic:
1. Find why a buyer searches it. Motivations: ${MOTIVATIONS.join(", ")}.
2. Turn the strongest motivations into angles:
${ANGLES.map((a) => `   - ${a.id}: ${a.hint}`).join("\n")}
3. Keep only angles that address a distinct buyer decision. Drop anything generic that could apply to any business, and anything that repeats another angle in other words.
4. Rank by buying intent, fit with ${name}'s strongest capabilities, and commercial value.

Write ${PROMPT_COUNT} prompts per topic, each from a different angle, best first. The first prompt is always "head": exactly the topic text.
Every prompt must:
- Make the AI answer with named brands, tools, products or providers ("best", "top", "which", "recommend", "alternatives to", "vs").
- Never be a how-to, what-is or why question.
- Be concise and natural, the way a real buyer types into ChatGPT, in the words customers use.
- Never include ${name} or ${site}. Competitor names only in comparison, unhappy and outgrown prompts.
- Never claim features, prices or results you cannot back up.
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
              required: ["text", "angle", "motivation"],
              properties: { text: { type: "string" }, angle: { type: "string", enum: ANGLES.map((a) => a.id) }, motivation: { type: "string", enum: [...MOTIVATIONS] } },
            },
          },
        },
      },
    },
  },
};

const FILLER = new Set(["best", "top", "software", "tools", "tool", "app", "apps", "platform", "platforms", "services", "service", "agency", "agencies", "for", "the", "a", "an", "and", "of", "in", "to", "with", "near", "company", "companies", "online", "which", "what", "is", "are"]);
const termsOf = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !FILLER.has(w)).map((w) => w.replace(/s$/, "")));
function overlap(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
}

// Questions whose answers explain ideas and seldom name brands.
const NO_BRANDS = /^\s*(how (to|do|does|can|should)|what (is|are|does)|why|when|what should i look for|what to look for|tips?\b|guide to)\b/i;
/** Prompts the AI will answer with brand names. Drops how-to style prompts, prompts naming the brand, and near duplicates. */
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
    out.push({ text, angle: (ANGLES.some((a) => a.id === p.angle) ? p.angle : "audience") as Angle });
  }
  if (!out.some((p) => p.angle === "head")) out.unshift({ text: topic, angle: "head" });
  return out.slice(0, PROMPT_COUNT);
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
