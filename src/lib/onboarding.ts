// Claude prompts for onboarding: read the website, pick topics, write prompts.
import type { BusinessType, Profile } from "./db";

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

export const SITE_PROMPT = (url: string, title: string, desc: string, text: string) => `You help a business see how AI assistants like ChatGPT talk about it. Read its website and describe the business.

Website: ${url}
Page title: ${title}
Meta description: ${desc}
Page text: ${text}

Return JSON only, with no other text, in exactly this shape:
{
  "name": "brand name as customers say it",
  "businessType": "saas" | "ecommerce" | "service" | "local" | "marketplace" | "other",
  "products": "the products or services it sells, as a short comma list in the words customers use",
  "customers": "its ideal customers, as a short comma list of personas or industries",
  "features": "its main features, benefits and differentiators, as a short comma list"
}

How to pick businessType:
- saas: sells software, an app, a platform or a tool.
- ecommerce: sells physical or digital products online to buyers (DTC brands, online stores).
- service: an agency, consultancy, studio or firm that sells services to clients anywhere.
- local: serves customers in one city or area (restaurants, clinics, salons, contractors, local shops).
- marketplace: connects buyers and sellers, or compares and lists many providers.
- other: none of these fit.`;

const TYPE_RULES: Record<BusinessType, string> = {
  saas: `This is a software business. Each topic names a software category, ending in "software", "platform", "tool" or "app". Example: "reputation management software", "review management software for restaurants".`,
  ecommerce: `This is an ecommerce or DTC brand. Each topic names the product a shopper is choosing, the way they would search for it. Example: "running shoes for flat feet", "organic dog food", "linen bedding sets".`,
  service: `This is a service business or agency. Each topic names the service a client hires for, ending in "agency", "services", "company", "consultant" or "firm". Example: "seo agency", "commercial cleaning services", "b2b content marketing agency".`,
  local: `This is a local business. Each topic names the service or place a customer is choosing, with the city or area when you know it. Example: "dentist in austin", "best ramen in hanoi", "emergency plumber in leeds".`,
  marketplace: `This is a marketplace or aggregator. Each topic names what buyers come to find or book. Example: "freelance web developers", "vacation rentals in bali", "used car marketplace".`,
  other: `Each topic names the category of product or service a buyer is choosing between, the way they would search for it.`,
};

const about = (name: string, site: string, p: Profile) => `Business: ${name} (${site})
Type: ${BUSINESS_TYPES.find((t) => t.id === p.businessType)?.label ?? "Not sure"}
Products and services: ${p.products || "Not given"}
Customers: ${p.customers || "Not given"}
Key features: ${p.features || "Not given"}
Market: ${p.country || "United States"}`;

export const TOPICS_PROMPT = (name: string, site: string, p: Profile) => `You choose the topics an AI search visibility tool will track for a business. A topic is the buying category a customer is in when they ask an AI assistant which option to choose. The business wants to be the answer.

${about(name, site, p)}

${TYPE_RULES[p.businessType ?? "other"]}

Rules:
- Return exactly ${MAX_TOPICS} topics.
- Bottom of the funnel only: categories people search when they are ready to compare and choose.
- Topic 1 is the broadest main category this business competes in.
- Topics 2 to ${MAX_TOPICS} are narrower categories real buyers search, split by customer type, industry, use case, feature or price. Use the customers and features above.
- 2 to 6 words each, lowercase except proper nouns and place names.
- Each topic must be a category many businesses compete in. Never include this brand's name or any competitor's name.
- No near duplicates.

Return JSON only: {"topics": ["...", "...", "...", "...", "..."]}`;

export const PROMPTS_PROMPT = (name: string, site: string, p: Profile, topics: string[]) => `You write the prompts an AI search visibility tool will send to ChatGPT, Gemini, Perplexity, Claude and Google every day, to see which brands they recommend. The business wants to show up in the answers.

${about(name, site, p)}

Topics:
${topics.map((t, i) => `${i + 1}. ${t}`).join("\n")}

For each topic, write exactly ${PROMPTS_PER_TOPIC} prompts:
- Prompt 1 is exactly the topic text, as a short search.
- Prompts 2 to ${PROMPTS_PER_TOPIC} are questions a real buyer would type into ChatGPT when they are ready to choose. Mix these kinds:
  - "best" or "top" picks for a specific customer or need ("What's the best ... for a ...?")
  - a problem the buyer has, then asking what can help ("We keep ... What ... can help us ...?")
  - what to look for when comparing options
  - options for a specific situation, size, budget or location
- Write for the customers listed above, in their words. Plain language, 8 to 25 words, one or two short sentences.
- The prompts must make the assistant recommend specific brands, products or providers.
- Never include this brand's name, its website or any competitor's name.
- If the market is not the United States or Global, write the prompts the way buyers in that market would ask, in English.
- No near duplicates across all topics.

Return JSON only: {"topics": [{"topic": "exact topic text", "prompts": ["...", "...", "...", "...", "..."]}]}`;

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
  return {
    products: str("products"),
    customers: str("customers"),
    features: str("features"),
    businessType: type,
    country: COUNTRIES.includes(str("country")) ? str("country") : "United States",
  };
}
