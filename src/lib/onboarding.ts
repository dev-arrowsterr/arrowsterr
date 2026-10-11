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
export const PROMPTS_PER_TOPIC = 5;
export const MAX_PROMPTS = 25; // prompts tracked by default, within the trial's limit
export const TOPIC_COUNT = 5;
export const PROMPT_COUNT = 5; // one prompt of each type per topic

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

/** The 5 topics, each with its own job in the set. */
export const TOPIC_KINDS = [
  { id: "primary", label: "Primary category", hint: "the main category buyers search for, as customers name it" },
  { id: "primary2", label: "Second category", hint: "the other name buyers use for the same purchase, or the second product line" },
  { id: "variant", label: "Variant", hint: "the category narrowed by a key capability or setup the business is built for (multi-location, AI-powered, self-serve...)" },
  { id: "segment", label: "Segment", hint: "the category for the company size or buyer type it sells to (enterprise, small business, agencies...)" },
  { id: "vertical", label: "Vertical", hint: "the category for the industry it serves most (restaurants, healthcare, SaaS...)" },
] as const;
export type TopicKind = (typeof TOPIC_KINDS)[number]["id"];

/** Second pass: the business in a few fields, and its 5 BOFU topics. */
export const PLAN_PROMPT = (url: string, notes: string, text: string) => `You pick the topics an AI search visibility tool will track for the business at ${url}. A topic is a bottom-of-funnel category keyword: the product category a buyer is ready to purchase.

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

Part 2: exactly 5 topics, one of each kind, in this order:
${TOPIC_KINDS.map((k, i) => `${i + 1}. ${k.id}: ${k.hint}`).join("\n")}

Example for Momos (restaurant reputation software): reputation management software, review management software, multi-location review management software, enterprise reputation management software, restaurant reputation management software.

Rules:
- Pure category keywords that end in the product noun ("software", "platform", "agency", "services", "app"...). 2 to 5 words, lowercase.
- Never a brand name, never "alternatives", never "vs", never "best", never a question.
- Each topic must be a real search a buyer types. Use the words customers use, not the company's own jargon.
- The 5 must not repeat each other.`;

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
        required: ["topic", "kind"],
        properties: { topic: { type: "string" }, kind: { type: "string", enum: TOPIC_KINDS.map((k) => k.id) } },
      },
    },
  },
};

export type PickedTopic = { topic: string; kind: TopicKind };

/** The 5 topics, cleaned: no blanks, no duplicates, no brand name, no alternatives or comparisons. */
export function cleanTopics(v: unknown, brand: string): PickedTopic[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: PickedTopic[] = [];
  for (const t of v as Record<string, unknown>[]) {
    const topic = String(t?.topic ?? "").trim().replace(/\s+/g, " ").toLowerCase().slice(0, 80);
    if (!topic || seen.has(topic) || (brand && topic.includes(brand.toLowerCase())) || /\b(alternatives?|vs\.?|versus)\b/.test(topic)) continue;
    seen.add(topic);
    out.push({ topic, kind: (TOPIC_KINDS.some((k) => k.id === t.kind) ? t.kind : "primary") as TopicKind });
  }
  return out.slice(0, TOPIC_COUNT);
}

// ── Prompts: one of each type per topic ──────────────────────────────────────

/** The 5 prompt types. "jtbd" prompts start with "How"; daily checks ask the AI to name the tools it would use. */
export const ANGLES = [
  { id: "head", label: "Head term", hint: "exactly the topic text" },
  { id: "direct", label: "Direct", hint: 'a "What..." question straight to the point: which tool is best for this category' },
  { id: "pain", label: "ICP pain", hint: 'a "What..." question built on a specific pain the ideal customer has, naming their situation' },
  { id: "jtbd", label: "Job to be done", hint: 'a "How..." question about the job the buyer needs done' },
  { id: "looking", label: "Looking for", hint: 'starts with "I\'m looking for a tool that can" and names another specific pain for this category' },
] as const;
export type Angle = (typeof ANGLES)[number]["id"];

const about = (name: string, site: string, p: Profile) =>
  [
    `Business: ${name} (${site})`,
    `Type: ${BUSINESS_TYPES.find((t) => t.id === p.businessType)?.label ?? "Not sure"}`,
    `Products and services: ${p.products || "Not given"}`,
    `Customers: ${p.customers || "Not given"}`,
    `Key features: ${p.features || "Not given"}`,
    `Market: ${p.country || "United States"}`,
  ].join("\n");

export const PROMPTS_PROMPT = (name: string, site: string, p: Profile, topics: string[]) => `You write the prompts an AI visibility tool sends to ChatGPT, Gemini, Perplexity, Claude and Google every day, to see which brands they recommend.

${about(name, site, p)}

Topics:
${topics.map((t, i) => `${i + 1}. ${t}`).join("\n")}

For each topic, write exactly 5 prompts, one of each type, in this order:
${ANGLES.map((a, i) => `${i + 1}. ${a.id}: ${a.hint}`).join("\n")}

Example for "reputation management software" (Momos, restaurant chains):
- head: reputation management software
- direct: What's a good reputation management platform for a fast-food chain?
- pain: We're getting inconsistent reviews across our restaurants. What software can help us spot recurring issues and improve our ratings?
- jtbd: How can a restaurant brand track and respond to reviews across hundreds of locations?
- looking: I'm looking for a tool that can compare customer feedback across all our franchise locations.

Rules:
- Write as the ideal customer, in their words, one or two short sentences.
- Never include ${name} or ${site}, and never name any brand.
- No two prompts may mean the same thing, across all topics.`;

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

const FILLER = new Set(["best", "top", "software", "tools", "tool", "app", "apps", "platform", "platforms", "services", "service", "agency", "agencies", "for", "the", "a", "an", "and", "of", "in", "to", "with", "near", "company", "companies", "online", "which", "what", "is", "are"]);
const termsOf = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !FILLER.has(w)).map((w) => w.replace(/s$/, "")));
function overlap(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
}

// Questions whose answers explain ideas and seldom name brands. Job-to-be-done prompts are the exception: checks ask them for tools.
const NO_BRANDS = /^\s*(how (to|do|does|can|should)|what (is|are|does)|why|when|what should i look for|what to look for|tips?\b|guide to)\b/i;
/** Prompts the AI will answer with brand names. Drops how-to style prompts, prompts naming the brand, and near duplicates. */
export function cleanPrompts(list: { text: string; angle: string }[], topic: string, seen: Set<string>[], brand = "") {
  const out: { text: string; angle: Angle }[] = [];
  const own = termsOf(topic);
  for (const p of list) {
    const text = String(p.text ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
    if (!text || (p.angle !== "jtbd" && NO_BRANDS.test(text))) continue;
    // A prompt that names the brand itself always "finds" it, so it measures nothing.
    if (brand && text.toLowerCase().includes(brand.toLowerCase())) continue;
    // Every prompt shares the topic's words, so compare only what each prompt adds.
    const t = new Set([...termsOf(text)].filter((w) => !own.has(w)));
    if (p.angle !== "head" && (!t.size || seen.some((s) => overlap(s, t) >= 0.5))) continue;
    if (t.size) seen.push(t);
    out.push({ text, angle: (ANGLES.some((a) => a.id === p.angle) ? p.angle : "direct") as Angle });
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
