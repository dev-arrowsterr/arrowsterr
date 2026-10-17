// The free tools' checks (docs/free-tools.md). Pure: they take what was fetched and return the answer, so tests can
// cover every rule. The fetching lives in freeRunners.ts.

// ─────────────── AI crawlers ───────────────

export type CrawlerPurpose = "search" | "training" | "user";
/** AI crawlers worth knowing about, with who runs them and what they do. */
export const AI_CRAWLERS: { bot: string; owner: string; purpose: CrawlerPurpose }[] = [
  { bot: "OAI-SearchBot", owner: "OpenAI", purpose: "search" },
  { bot: "ChatGPT-User", owner: "OpenAI", purpose: "user" },
  { bot: "GPTBot", owner: "OpenAI", purpose: "training" },
  { bot: "Claude-SearchBot", owner: "Anthropic", purpose: "search" },
  { bot: "Claude-User", owner: "Anthropic", purpose: "user" },
  { bot: "ClaudeBot", owner: "Anthropic", purpose: "training" },
  { bot: "PerplexityBot", owner: "Perplexity", purpose: "search" },
  { bot: "Perplexity-User", owner: "Perplexity", purpose: "user" },
  { bot: "Google-Extended", owner: "Google (Gemini)", purpose: "training" },
  { bot: "Applebot-Extended", owner: "Apple", purpose: "training" },
  { bot: "Meta-ExternalAgent", owner: "Meta", purpose: "training" },
  { bot: "Amazonbot", owner: "Amazon", purpose: "search" },
  { bot: "Bytespider", owner: "ByteDance", purpose: "training" },
  { bot: "CCBot", owner: "Common Crawl", purpose: "training" },
];

type Rule = { allow: boolean; path: string; line: string };
type Group = { agents: string[]; rules: Rule[] };

/** robots.txt as groups of user agents and their rules. */
export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let cur: Group | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || cur.rules.length) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(val.toLowerCase());
    } else if (cur && (key === "allow" || key === "disallow")) {
      // "Disallow:" with nothing after it allows everything, so it is no rule at all.
      if (key === "disallow" && !val) continue;
      cur.rules.push({ allow: key === "allow", path: val, line: `${m[1]}: ${val}` });
    }
  }
  return groups;
}

/** Does a robots.txt path pattern (with * and $) match this path? */
export function robotsMatch(pattern: string, path: string): boolean {
  const end = pattern.endsWith("$");
  const body = (end ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${end ? "$" : ""}`).test(path);
}

export type Verdict = { bot: string; owner: string; purpose: CrawlerPurpose; verdict: "allowed" | "blocked" | "partial"; rule: string | null; group: string };

/** Each AI crawler's access to `path`, the way Google reads robots.txt: its own group wins, then *, then the longest rule. */
export function robotsVerdicts(robots: string | null, path = "/"): Verdict[] {
  const groups = robots ? parseRobots(robots) : [];
  return AI_CRAWLERS.map(({ bot, owner, purpose }) => {
    const own = groups.filter((g) => g.agents.includes(bot.toLowerCase()));
    const chosen = own.length ? own : groups.filter((g) => g.agents.includes("*"));
    const rules = chosen.flatMap((g) => g.rules);
    const group = own.length ? bot : chosen.length ? "*" : "none";
    const hits = rules.filter((r) => robotsMatch(r.path, path)).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
    const top = hits[0];
    if (top && !top.allow) return { bot, owner, purpose, verdict: "blocked", rule: top.line, group };
    const someBlocked = rules.some((r) => !r.allow && r.path && r.path !== "/");
    return { bot, owner, purpose, verdict: someBlocked ? "partial" : "allowed", rule: top?.line ?? (someBlocked ? rules.find((r) => !r.allow)!.line : null), group };
  });
}

/** Lines to add to robots.txt so the blocked crawlers can read the whole site. */
export function robotsFix(verdicts: Verdict[]): string | null {
  const blocked = verdicts.filter((v) => v.verdict === "blocked");
  if (!blocked.length) return null;
  return blocked.map((v) => `User-agent: ${v.bot}\nAllow: /`).join("\n\n");
}

// ─────────────── llms.txt ───────────────

export type LlmsPage = { url: string; title: string; description?: string };

const titleCase = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
/** A readable title from an address, for pages we didn't open: /blog/best-crm-tools → Best Crm Tools. */
export const titleFromUrl = (url: string) => {
  const last = new URL(url).pathname.split("/").filter(Boolean).pop();
  return last ? titleCase(decodeURIComponent(last).replace(/\.\w+$/, "")) : "Home";
};

/** An llms.txt file (llmstxt.org): the site's name and summary, then its pages in sections by top folder. */
export function buildLlmsTxt(site: { name: string; summary: string; url: string }, pages: LlmsPage[], maxLinks = 120): string {
  const seen = new Set<string>();
  const clean = pages.filter((p) => {
    const k = p.url.replace(/\/$/, "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const sections = new Map<string, LlmsPage[]>();
  for (const p of clean.slice(0, maxLinks)) {
    const first = new URL(p.url).pathname.split("/").filter(Boolean)[0];
    const name = !first ? "Main pages" : /^(blog|posts?|articles?|news|insights|guides?|resources|learn)$/i.test(first) ? "Articles" : /^(docs?|help|support|kb|knowledge-base|faq)$/i.test(first) ? "Docs" : /^(products?|features?|platform|solutions?|pricing|plans)$/i.test(first) ? "Product" : "Main pages";
    if (!sections.has(name)) sections.set(name, []);
    sections.get(name)!.push(p);
  }
  const order = ["Main pages", "Product", "Docs", "Articles"];
  const md = (s: string) => s.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();
  const out = [`# ${md(site.name)}`, "", `> ${md(site.summary) || `The website of ${md(site.name)}.`}`, ""];
  for (const name of order) {
    const list = sections.get(name);
    if (!list?.length) continue;
    out.push(`## ${name}`, "");
    for (const p of list) out.push(`- [${md(p.title) || titleFromUrl(p.url)}](${p.url})${p.description ? `: ${md(p.description).slice(0, 160)}` : ""}`);
    out.push("");
  }
  const rest = clean.slice(maxLinks);
  if (rest.length) {
    out.push("## Optional", "");
    for (const p of rest.slice(0, 200)) out.push(`- [${md(p.title) || titleFromUrl(p.url)}](${p.url})`);
    out.push("");
  }
  return out.join("\n").trimEnd() + "\n";
}

// ─────────────── AI answer-ready ───────────────

/** Flesch reading ease, 0 (hard) to 100 (easy). Syllables are counted by vowel groups, which is close enough. */
export function readingEase(text: string): number | null {
  const words = text.match(/[A-Za-z]+(?:'[a-z]+)?/g) ?? [];
  if (words.length < 30) return null;
  const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) ?? []).length);
  const syllables = words.reduce((n, w) => {
    const v = w.toLowerCase().replace(/e$/, "").match(/[aeiouy]+/g);
    return n + Math.max(1, v?.length ?? 1);
  }, 0);
  const score = 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / words.length);
  return Math.round(Math.max(0, Math.min(100, score)));
}

export type PageFacts = {
  title: string;
  description: string;
  h1: number;
  subheadings: number;
  questionHeadings: number;
  firstParagraph: string; // the first paragraph of the main content
  paragraphWords: number[];
  lists: number;
  tables: number;
  schemaTypes: string[];
  faq: boolean;
  words: number; // words in the main content, as served without JavaScript
  text: string; // the main content as plain text
  dated: boolean;
  author: boolean;
  aiBlocked: string[]; // AI search crawlers that robots.txt blocks
};

export type Check = { id: string; label: string; pass: boolean; detail: string; fix: string; weight: number };

/** Score a page on what AI answers quote: a direct answer up top, clear structure, proof of who and when, and access. */
export function answerReady(f: PageFacts): { score: number; checks: Check[]; ease: number | null } {
  const firstWords = f.firstParagraph.split(/\s+/).filter(Boolean).length;
  const avgPara = f.paragraphWords.length ? Math.round(f.paragraphWords.reduce((a, b) => a + b, 0) / f.paragraphWords.length) : 0;
  const ease = readingEase(f.text);
  const answerSchema = f.schemaTypes.filter((t) => /^(Article|BlogPosting|NewsArticle|FAQPage|HowTo|Product|QAPage|Organization|LocalBusiness|SoftwareApplication|Service|Recipe)$/i.test(t));
  const checks: Check[] = [
    { id: "access", weight: 15, label: "AI search crawlers can read it", pass: !f.aiBlocked.length, detail: f.aiBlocked.length ? `robots.txt blocks ${f.aiBlocked.join(", ")}.` : "No AI search crawler is blocked.", fix: "Allow OAI-SearchBot, Claude-SearchBot and PerplexityBot in robots.txt." },
    { id: "server", weight: 12, label: "The text is there without JavaScript", pass: f.words >= 250, detail: `${f.words.toLocaleString("en-US")} words in the page as served.`, fix: "Render the main text on the server. Most AI crawlers don't run JavaScript." },
    { id: "answer", weight: 14, label: "It answers first", pass: firstWords >= 15 && firstWords <= 90 && !/\?\s*$/.test(f.firstParagraph), detail: firstWords ? `The first paragraph has ${firstWords} words.` : "No opening paragraph found.", fix: "Open with a 1 to 3 sentence answer (15 to 90 words) to the question the page targets." },
    { id: "h1", weight: 6, label: "One clear H1", pass: f.h1 === 1, detail: `${f.h1} H1 heading${f.h1 === 1 ? "" : "s"}.`, fix: "Use exactly one H1 that says what the page answers." },
    { id: "headings", weight: 8, label: "Sections with subheadings", pass: f.subheadings >= 3, detail: `${f.subheadings} subheadings, ${f.questionHeadings} written as questions.`, fix: "Break the page into sections with H2s, ideally phrased as the questions people ask." },
    { id: "lists", weight: 7, label: "Lists or tables", pass: f.lists + f.tables > 0, detail: `${f.lists} list${f.lists === 1 ? "" : "s"}, ${f.tables} table${f.tables === 1 ? "" : "s"}.`, fix: "Put steps, options and comparisons in lists or tables. AI quotes them often." },
    { id: "faq", weight: 7, label: "An FAQ section", pass: f.faq, detail: f.faq ? "Found an FAQ." : "No FAQ found.", fix: "Add 3 to 6 real buyer questions with short answers, and FAQPage schema." },
    { id: "schema", weight: 9, label: "Structured data", pass: answerSchema.length > 0, detail: f.schemaTypes.length ? `Schema: ${[...new Set(f.schemaTypes)].slice(0, 6).join(", ")}.` : "No schema found.", fix: "Add JSON-LD schema that fits the page: Article, FAQPage, HowTo or Product." },
    { id: "paragraphs", weight: 5, label: "Short paragraphs", pass: avgPara > 0 && avgPara <= 80, detail: avgPara ? `Paragraphs average ${avgPara} words.` : "No paragraphs found.", fix: "Keep paragraphs under 80 words so each one makes one point." },
    { id: "readable", weight: 6, label: "Plain words", pass: ease !== null && ease >= 45, detail: ease === null ? "Too little text to score." : `Reading ease ${ease} out of 100.`, fix: "Use shorter sentences and everyday words. Aim for 45 or more." },
    { id: "fresh", weight: 5, label: "A visible date", pass: f.dated, detail: f.dated ? "Has a published or updated date." : "No date found.", fix: "Show when the page was last updated, and add dateModified to the schema." },
    { id: "author", weight: 3, label: "A named author or company", pass: f.author, detail: f.author ? "Says who wrote it." : "No author found.", fix: "Name the author or company, with a link to who they are." },
    { id: "meta", weight: 3, label: "Title and description", pass: Boolean(f.title && f.description), detail: f.title && f.description ? "Both set." : `Missing ${!f.title ? "a title" : "a meta description"}.`, fix: "Write a clear title and a 140 to 155 character meta description." },
  ];
  const total = checks.reduce((n, c) => n + c.weight, 0);
  const got = checks.reduce((n, c) => n + (c.pass ? c.weight : 0), 0);
  return { score: Math.round((got / total) * 100), checks, ease };
}

// ─────────────── Page speed ───────────────

type Psi = {
  lighthouseResult?: {
    categories?: { performance?: { score?: number | null } };
    audits?: Record<string, { title?: string; numericValue?: number; score?: number | null; displayValue?: string; details?: { type?: string; overallSavingsMs?: number } }>;
  };
  loadingExperience?: { overall_category?: string; metrics?: Record<string, { percentile?: number; category?: string }> };
};

const rate = (v: number | null, good: number, poor: number) => (v === null ? null : v <= good ? "good" : v <= poor ? "needs work" : "poor");

/** The parts of a PageSpeed Insights answer people need: the score, Core Web Vitals and the biggest fixes. */
export function speedSummary(psi: Psi) {
  const a = psi.lighthouseResult?.audits ?? {};
  const n = (id: string) => (typeof a[id]?.numericValue === "number" ? a[id]!.numericValue! : null);
  const lcp = n("largest-contentful-paint");
  const cls = n("cumulative-layout-shift");
  const tbt = n("total-blocking-time");
  const f = psi.loadingExperience?.metrics;
  const field = f
    ? {
        lcp: f.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
        inp: f.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
        cls: typeof f.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile === "number" ? f.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null,
        overall: psi.loadingExperience?.overall_category ?? null,
      }
    : null;
  const fixes = Object.values(a)
    .filter((x) => x.details?.type === "opportunity" && (x.details.overallSavingsMs ?? 0) >= 100 && x.title)
    .sort((x, y) => (y.details!.overallSavingsMs ?? 0) - (x.details!.overallSavingsMs ?? 0))
    .slice(0, 6)
    .map((x) => ({ title: x.title!, savingsMs: Math.round(x.details!.overallSavingsMs!) }));
  const score = psi.lighthouseResult?.categories?.performance?.score;
  return {
    score: typeof score === "number" ? Math.round(score * 100) : null,
    lab: {
      lcp: lcp === null ? null : { ms: Math.round(lcp), rating: rate(lcp, 2500, 4000) },
      cls: cls === null ? null : { value: Math.round(cls * 1000) / 1000, rating: rate(cls, 0.1, 0.25) },
      tbt: tbt === null ? null : { ms: Math.round(tbt), rating: rate(tbt, 200, 600) },
      fcp: n("first-contentful-paint") === null ? null : { ms: Math.round(n("first-contentful-paint")!) },
      si: n("speed-index") === null ? null : { ms: Math.round(n("speed-index")!) },
    },
    field: field && (field.lcp !== null || field.inp !== null)
      ? { lcp: field.lcp === null ? null : { ms: field.lcp, rating: rate(field.lcp, 2500, 4000) }, inp: field.inp === null ? null : { ms: field.inp, rating: rate(field.inp, 200, 500) }, cls: field.cls === null ? null : { value: field.cls, rating: rate(field.cls, 0.1, 0.25) }, overall: field.overall }
      : null,
    fixes,
  };
}
