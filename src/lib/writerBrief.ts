// Agentic Writer, the brief (docs/content-v2.md, "How one article is made", step 4).
// A topic imported from the Editorial Calendar gets the article research (049) first, then one Claude call writes
// the brief: titles, intent, reader, angle, outline with the sources behind each part, FAQs, internal links, the CTA
// and the interactive modules to build. The research lives inside the brief.
// Pure: the database and the paid calls come in as `store` and `deps` (writerServer.ts), so tests run it offline.
import type { BrandKit } from "./brandKit.ts";
import { voiceText, type BrandVoice } from "./brandVoice.ts";

// ─────────────── shapes ───────────────
export type Outcome = { state: "done" } | { state: "failed"; error: string } | { state: "wait"; seconds: number; why: string };

export const MODULE_TYPES = ["calculator", "comparison", "checklist", "quiz", "roi", "timeline", "diagram"] as const;
export type ModuleType = (typeof MODULE_TYPES)[number];
export const MODULE_LABEL: Record<ModuleType, string> = {
  calculator: "Calculator",
  comparison: "Comparison table with filters",
  checklist: "Checklist",
  quiz: "Quiz",
  roi: "ROI estimator",
  timeline: "Timeline",
  diagram: "Interactive diagram or tabs",
};

export type PlannedModule = { type: ModuleType; title: string; purpose: string; placement: string; inputs: string[]; outputs: string[]; data: string; why: string };
export type OutlinePart = { h2: string; points: string[]; h3: { title: string; points: string[] }[]; sources: number[] };

/** A source the research read, numbered so the outline and the draft can point to it. */
export type ResearchSource = { n: number; url: string; title: string; domain: string; kind: "serp" | "ai"; position: number | null; words: number };
export type BriefResearch = {
  topPages: string; // what Google's top pages do, in a few lines
  aiAnswers: string; // what the AI answers say and who they cite
  sources: ResearchSource[];
  questions: string[]; // People Also Ask
  engines: string[];
};

export type WriterBrief = {
  titles: string[];
  h1: string;
  metaDescription: string;
  slug: string;
  searchIntent: string;
  reader: string;
  angle: string;
  wordTarget: number;
  outline: OutlinePart[];
  entities: string[];
  gaps: string[]; // what the top pages miss
  faqs: { question: string; answer: string }[];
  internalLinks: { url: string; anchor: string; where: string }[];
  cta: { text: string; where: string };
  modules: PlannedModule[];
  research: BriefResearch;
  model: string;
  at: string;
};

export type BriefStatus = "generating" | "ready" | "approved" | "failed";
export type BriefRow = {
  id: string;
  workspace_id: string;
  brand_id: string | null;
  site_id: string;
  item_id: string;
  keyword: string;
  research_run_id: string | null;
  status: BriefStatus;
  step: "research" | "writing" | "done";
  brief: WriterBrief | null;
  notes: string;
  note: string | null;
  version: number;
  error: string | null;
};

/** A page the research read, with its text, for the prompts. */
export type SourcePage = { url: string; title: string | null; domain: string; kind: "serp" | "ai"; position: number | null; words: number; headings: string[]; body: string };
export type ResearchPack = {
  keyword: string;
  pages: SourcePage[];
  questions: { question: string; answer: string | null }[];
  aiOverview: string;
  answers: { engine: string; text: string; cited: string[] }[];
};

/** Who the brand is and how it writes. */
export type WriterContext = {
  brand: { name: string; domain: string };
  voice: BrandVoice | null;
  kit: BrandKit | null;
  guidelines: { body: string; links: string[] } | null;
  sitemap: string[]; // the brand's own pages, for internal links
};

export type BriefStore = {
  brief(id: string): Promise<BriefRow | null>;
  update(id: string, patch: Partial<BriefRow>): Promise<void>;
};
export type BriefDeps = {
  startResearch(b: BriefRow): Promise<string>; // the article research run for the topic, started or reused
  runStatus(runId: string): Promise<{ status: string; error: string | null } | null>;
  research(runId: string): Promise<ResearchPack>;
  context(b: BriefRow): Promise<WriterContext>;
  write(prefix: string, prompt: string): Promise<unknown>; // one Claude call with the brief schema
  model: string;
  now?: () => number;
};

export const POLL_S = 30; // how often the brief job looks at its research while it runs
export const MAX_SOURCES = 12; // pages the prompts read
export const EXCERPT = 4_500; // characters of each page the prompts read

// ─────────────── the research as text ───────────────
/** The pages the brief and draft use, best first: Google's results by rank, then the pages AI answers cite. */
export function pickSources(pages: SourcePage[], max = MAX_SOURCES): SourcePage[] {
  const serp = pages.filter((p) => p.kind === "serp").sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  const ai = pages.filter((p) => p.kind === "ai");
  return [...serp, ...ai].slice(0, max);
}

export const numbered = (pages: SourcePage[]): ResearchSource[] =>
  pages.map((p, i) => ({ n: i + 1, url: p.url, title: (p.title ?? p.url).slice(0, 200), domain: p.domain, kind: p.kind, position: p.position, words: p.words }));

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, "")} …` : s);

/** The brand, in the words every prompt starts with. */
export function brandText(c: WriterContext): string {
  const k = c.kit;
  return [
    `Brand: ${c.brand.name} (${c.brand.domain})`,
    c.voice ? `Brand Voice:\n${voiceText(c.voice)}` : "Brand Voice: not set. Write plainly and confidently, for a smart reader in a hurry.",
    k ? `Brand Kit: colors primary ${k.colors.primary}, secondary ${k.colors.secondary}, ink ${k.colors.ink}, text ${k.colors.text}; fonts ${k.fonts.heading} for headings, ${k.fonts.body} for text.` : "",
    c.guidelines?.body ? `Brand guidelines:\n${clip(c.guidelines.body, 6000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The research every prompt reads: numbered sources with their text, People Also Ask and the AI answers. */
export function researchText(pack: ResearchPack, sources: SourcePage[]): string {
  const pages = sources
    .map((p, i) => {
      const heads = p.headings.slice(0, 25).join(" | ");
      return `[${i + 1}] ${p.title ?? p.url}\n${p.url}\n${p.kind === "serp" ? `Google rank ${p.position ?? "?"}` : "Cited by an AI answer"} · ${p.words} words\nHeadings: ${heads || "none"}\n${clip(p.body, EXCERPT)}`;
    })
    .join("\n\n");
  const paa = pack.questions.map((q) => `- ${q.question}${q.answer ? ` (Google's answer: ${clip(q.answer, 300)})` : ""}`).join("\n");
  const answers = pack.answers.map((a) => `--- ${a.engine} ---\n${clip(a.text, 2500)}\nCited: ${a.cited.slice(0, 10).join(", ") || "nothing"}`).join("\n\n");
  return [
    `Keyword: ${pack.keyword}`,
    `Sources (cite them by number):\n\n${pages || "none"}`,
    paa ? `People Also Ask:\n${paa}` : "",
    pack.aiOverview ? `Google AI Overview:\n${clip(pack.aiOverview, 3000)}` : "",
    answers ? `AI answers to the keyword as a question:\n\n${answers}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The stable start of every prompt for a topic: the brand and the research. Claude caches it. */
export const contextPrefix = (c: WriterContext, pack: ResearchPack, sources: SourcePage[]) =>
  `You are the senior content strategist and writer for ${c.brand.name}.\n\n${brandText(c)}\n\n${researchText(pack, sources)}`;

// ─────────────── the brief call ───────────────
const S = { type: "string" } as const;
const LIST = { type: "array", items: S } as const;
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });

export const BRIEF_SCHEMA = obj({
  titles: LIST,
  h1: S,
  metaDescription: S,
  slug: S,
  searchIntent: S,
  reader: S,
  angle: S,
  wordTarget: { type: "integer" },
  outline: { type: "array", items: obj({ h2: S, points: LIST, h3: { type: "array", items: obj({ title: S, points: LIST }) }, sources: { type: "array", items: { type: "integer" } } }) },
  entities: LIST,
  gaps: LIST,
  faqs: { type: "array", items: obj({ question: S, answer: S }) },
  internalLinks: { type: "array", items: obj({ url: S, anchor: S, where: S }) },
  cta: obj({ text: S, where: S }),
  modules: { type: "array", items: obj({ type: { type: "string", enum: [...MODULE_TYPES] }, title: S, purpose: S, placement: S, inputs: LIST, outputs: LIST, data: S, why: S }) },
  topPages: S,
  aiAnswers: S,
});

/** The instructions for the brief, after the cached brand and research. */
export function briefPrompt(b: Pick<BriefRow, "keyword" | "notes" | "note">, c: WriterContext, sourceCount: number): string {
  const links = c.sitemap.slice(0, 150);
  return `Write the content brief for an article on "${b.keyword}" for ${c.brand.name}. A writer and an AI will write the draft from it, so it must be complete and exact.
${b.notes ? `\nThe editor's notes:\n${b.notes}\n` : ""}${b.note ? `\nThe editor asked for this change: ${b.note}\n` : ""}
${links.length ? `The brand's own pages (internal links must come from this list):\n${links.join("\n")}\n` : "The brand's sitemap is not known: leave internalLinks empty.\n"}
Rules:
- titles: 3 title options, under 65 characters, with the keyword or close to it. h1 is the one you'd pick.
- metaDescription: under 155 characters. slug: short, lowercase, hyphens.
- searchIntent: what the searcher wants and the format that serves it, in 1 or 2 sentences.
- reader: who reads this, what they know, and what they want to do next.
- angle: the point of view that makes this article better than the top pages, in 1 or 2 sentences.
- wordTarget: a number, close to what the top pages need to cover the topic, plus what they miss.
- outline: 5 to 9 H2s in order, each with 2 to 5 key points, H3s where useful, and the numbers of the sources [1..${sourceCount}] that back it. Every H2 cites at least one source when one fits. The intro is not an H2.
- entities: the people, products, terms and concepts the article must name.
- gaps: what the top pages miss or get wrong, that this article will cover.
- faqs: 3 to 6 questions from People Also Ask and the AI answers, each with a one-line note on what the answer must say.
- internalLinks: up to 6, each with its anchor text and the H2 it goes under.
- cta: what the reader should do at the end, in ${c.brand.name}'s words, and where it goes.
- modules: 1 to 3 interactive modules that make the article more useful and fun to read: type (calculator, comparison, checklist, quiz, roi, timeline, diagram), a short title, its purpose, placement (the exact H2 it goes after), inputs and outputs (or, for a table, timeline or diagram, the rows or steps in data), and why it helps the reader. Pick what this reader would really use. All data must come from the sources.
- topPages: 3 to 5 sentences on what Google's top pages do: format, length, what they all cover.
- aiAnswers: 2 to 4 sentences on what the AI answers say and which sites they cite.
- Base every fact on the sources. Never invent numbers.`;
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const strs = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.map((x) => str(x, n)).filter(Boolean).slice(0, max) : []);
const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]).filter((x) => x && typeof x === "object") : []);
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
const same = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const linkKey = (u: string) => u.replace(/#.*$/, "").replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "").toLowerCase();

/** Claude's brief, cleaned: lists trimmed, sources and links checked against what the research and sitemap hold. */
export function cleanBrief(x: unknown, research: Omit<BriefResearch, "topPages" | "aiAnswers">, sitemap: string[], meta: { model: string; at: string; keyword: string }): WriterBrief {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const valid = new Set(research.sources.map((s) => s.n));
  const outline: OutlinePart[] = arr(o.outline)
    .map((p) => ({
      h2: str(p.h2, 160),
      points: strs(p.points, 400, 8),
      h3: arr(p.h3)
        .map((h) => ({ title: str(h.title, 160), points: strs(h.points, 400, 6) }))
        .filter((h) => h.title)
        .slice(0, 6),
      sources: [...new Set((Array.isArray(p.sources) ? p.sources : []).map(Number).filter((n) => valid.has(n)))].slice(0, 8),
    }))
    .filter((p) => p.h2)
    .slice(0, 12);
  const h2s = outline.map((p) => p.h2);
  const pages = new Map(sitemap.map((u) => [linkKey(u), u]));
  const modules: PlannedModule[] = arr(o.modules)
    .filter((m) => MODULE_TYPES.includes(m.type as ModuleType))
    .map((m) => {
      const want = str(m.placement, 160);
      const placement = h2s.find((h) => same(h, want)) ?? h2s.find((h) => want && h.toLowerCase().includes(want.toLowerCase())) ?? h2s[Math.min(1, h2s.length - 1)] ?? "";
      return { type: m.type as ModuleType, title: str(m.title, 120), purpose: str(m.purpose, 400), placement, inputs: strs(m.inputs, 200, 10), outputs: strs(m.outputs, 200, 10), data: str(m.data, 3000), why: str(m.why, 400) };
    })
    .filter((m) => m.title)
    .slice(0, 3);
  const titles = strs(o.titles, 120, 3);
  const h1 = str(o.h1, 160) || titles[0] || meta.keyword;
  const target = Math.round(Number(o.wordTarget));
  return {
    titles: titles.length ? titles : [h1],
    h1,
    metaDescription: str(o.metaDescription, 170),
    slug: slugify(str(o.slug, 120) || h1),
    searchIntent: str(o.searchIntent, 600),
    reader: str(o.reader, 600),
    angle: str(o.angle, 600),
    wordTarget: Number.isFinite(target) ? Math.min(6000, Math.max(600, target)) : 1800,
    outline,
    entities: strs(o.entities, 80, 40),
    gaps: strs(o.gaps, 300, 10),
    faqs: arr(o.faqs)
      .map((f) => ({ question: str(f.question, 200), answer: str(f.answer, 500) }))
      .filter((f) => f.question)
      .slice(0, 8),
    internalLinks: arr(o.internalLinks)
      .map((l) => ({ url: pages.get(linkKey(str(l.url, 500))) ?? "", anchor: str(l.anchor, 120), where: str(l.where, 160) }))
      .filter((l) => l.url && l.anchor)
      .slice(0, 8),
    cta: { text: str((o.cta as Record<string, unknown> | undefined)?.text, 300), where: str((o.cta as Record<string, unknown> | undefined)?.where, 160) },
    modules,
    research: { ...research, topPages: str(o.topPages, 1500), aiAnswers: str(o.aiAnswers, 1500) },
    model: meta.model,
    at: meta.at,
  };
}

// ─────────────── the job ───────────────
/**
 * Run (or resume) a brief as far as it can go now. While the research runs, it waits without paying anything;
 * once the research is done, one Claude call writes the brief and it is saved in one write.
 */
export async function runBrief(store: BriefStore, deps: BriefDeps, id: string, version?: number): Promise<Outcome> {
  const now = deps.now ?? Date.now;
  const b = await store.brief(id);
  if (!b) return { state: "failed", error: "This brief was deleted." };
  if (b.status !== "generating" || (version !== undefined && b.version !== version)) return { state: "done" }; // finished, or a newer Regenerate took over
  const fail = async (error: string): Promise<Outcome> => {
    await store.update(id, { status: "failed", error: error.slice(0, 1000) });
    return { state: "failed", error };
  };

  // Step 1: the article research. Starting it is free; waiting on it never uses up an attempt.
  let runId = b.research_run_id;
  if (b.step === "research") {
    if (!runId) {
      runId = await deps.startResearch(b);
      await store.update(id, { research_run_id: runId });
    }
    const run = await deps.runStatus(runId);
    if (!run) {
      // The run was deleted: start a new one next time.
      await store.update(id, { research_run_id: null });
      return { state: "wait", seconds: 1, why: "research restarted" };
    }
    if (run.status === "failed") return fail(`The research didn't finish: ${run.error ?? "unknown error"}`);
    if (run.status !== "done") return { state: "wait", seconds: POLL_S, why: "research running" };
    await store.update(id, { step: "writing" });
  }
  if (!runId) return fail("This brief has no research.");

  // Step 2: the brief, in one call. The brand and the research are the cached prefix.
  const [pack, ctx] = await Promise.all([deps.research(runId), deps.context(b)]);
  const sources = pickSources(pack.pages);
  if (!sources.length) return fail("The research read no pages.");
  const raw = await deps.write(contextPrefix(ctx, pack, sources), briefPrompt(b, ctx, sources.length));
  const brief = cleanBrief(
    raw,
    { sources: numbered(sources), questions: pack.questions.map((q) => q.question).slice(0, 10), engines: pack.answers.map((a) => a.engine) },
    ctx.sitemap,
    { model: deps.model, at: new Date(now()).toISOString(), keyword: b.keyword },
  );
  if (!brief.outline.length) return fail("The brief came back without an outline. Regenerate it.");
  await store.update(id, { brief, status: "ready", step: "done", error: null });
  return { state: "done" };
}

// ─────────────── the queue ───────────────
export type Queue = {
  finish(id: number): Promise<void>;
  retry(id: number, why: string, seconds: number, opts: { count: boolean }): Promise<void>;
};

/**
 * Run one step of a writer job and put the job back or finish it. Waiting (research running, the next section)
 * goes back on the queue without using up an attempt. An error is thrown back to the worker, which retries it
 * with a growing wait, until the last attempt: then onLast marks the brief or draft failed.
 */
export async function drive(job: { id: number; attempts: number; max_attempts: number }, q: Queue, step: () => Promise<Outcome>, onLast: (error: string) => Promise<void>) {
  let out: Outcome;
  try {
    out = await step();
  } catch (e) {
    if (job.attempts < job.max_attempts) throw e;
    await onLast(e instanceof Error ? e.message : String(e));
    return q.finish(job.id);
  }
  if (out.state === "wait") return q.retry(job.id, out.why, out.seconds, { count: false });
  return q.finish(job.id);
}
