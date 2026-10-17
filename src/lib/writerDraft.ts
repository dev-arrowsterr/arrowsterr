// Agentic Writer, the draft (docs/content-v2.md, "How one article is made", steps 5 to 7).
//   1. Sections: the intro, each H2 of the approved brief and the FAQ, written one at a time in the Brand Voice,
//      citing the research's sources. Each is saved as it lands.
//   2. Check: one pass over the whole draft that names every sentence the saved sources don't support; they are cut.
//      Links that point outside the sources, the brief's internal links and the brand's site are unlinked.
//   3. Modules: each interactive module the brief planned, built as one self-contained HTML block, checked,
//      retried once with the reason, then dropped if it still fails.
//   4. Save: the draft goes into docs (010_writer.sql), so the plain editor, Export and Publish work on it.
// Every step saves its output, so a killed job restarts where it stopped and never pays twice for a finished step.
// Pure: the database and the paid calls come in as `store` and `deps` (writerServer.ts), so tests run it offline.
import type { BriefRow, Outcome, PlannedModule, ResearchPack, SourcePage, WriterBrief, WriterContext } from "./writerBrief.ts";
import { contextPrefix } from "./writerBrief.ts";
import { modulePrompt, validateModule, wrapModule, type Validation } from "./writerModules.ts";

// ─────────────── shapes ───────────────
export type BlockType = "p" | "h3" | "ul" | "ol" | "quote" | "table";
export type Block = { type: BlockType; text: string; items: string[]; rows: string[][] };
export type Section = { key: string; h2: string; blocks: Block[] };
export type ModuleState = { status: "ok" | "retry" | "dropped"; attempts: number; html: string | null; error: string | null };
export type Checked = { sections: Section[]; cut: { id: string; why: string }[]; unlinked: number };

export type DraftStatus = "generating" | "ready" | "failed";
export type DraftRow = {
  id: string;
  workspace_id: string;
  brand_id: string | null;
  site_id: string;
  item_id: string;
  brief_id: string;
  doc_id: string | null;
  status: DraftStatus;
  step: "sections" | "check" | "modules" | "save" | "done";
  version: number;
  note: string | null;
  sections: (Section | null)[];
  checked: Checked | null;
  check_at: string | null;
  modules: (ModuleState | null)[];
  period: string;
  words: number;
  error: string | null;
  ready_at: string | null;
};

export type DocOut = { title: string; content: Record<string, unknown>; words: number; meta: { title: string; description: string; slug: string } };

export type DraftStore = {
  draft(id: string): Promise<DraftRow | null>;
  brief(id: string): Promise<BriefRow | null>;
  update(id: string, patch: Partial<DraftRow>): Promise<void>;
  /** Write the finished draft into its doc (made the first time) and return the doc's id. */
  saveDoc(d: DraftRow, doc: DocOut, at: string): Promise<string>;
};
export type DraftDeps = {
  context(d: DraftRow, b: BriefRow): Promise<{ ctx: WriterContext; pack: ResearchPack }>;
  writeSection(prefix: string, prompt: string): Promise<unknown>;
  check(prefix: string, prompt: string): Promise<unknown>;
  buildModule(prefix: string, prompt: string): Promise<unknown>;
  validate?: (html: string) => Validation;
  model: string;
  now?: () => number;
  budgetMs?: number; // stop starting paid calls after this long, and come back for the rest
};

export const BUDGET_MS = 90_000; // a turn plus one long call stays under the worker route's 300 seconds
export const MODULE_TRIES = 2; // the first build and one retry
const FAQ = "Frequently asked questions";

// ─────────────── the plan ───────────────
export type SectionPlan = { key: string; kind: "intro" | "h2" | "faq"; h2: string; points: string[]; h3: { title: string; points: string[] }[]; sources: number[]; cta: boolean };

/** The sections to write, in order: the intro, each H2 of the outline, and the FAQ when the brief has questions. */
export function planSections(b: WriterBrief): SectionPlan[] {
  const h2 = b.outline.map((p, i) => ({ key: `h2-${i}`, kind: "h2" as const, h2: p.h2, points: p.points, h3: p.h3, sources: p.sources, cta: false }));
  const ctaAt = h2.findIndex((s) => b.cta.where && s.h2.toLowerCase() === b.cta.where.toLowerCase());
  if (h2.length && b.cta.text) h2[ctaAt >= 0 ? ctaAt : h2.length - 1].cta = true;
  return [
    { key: "intro", kind: "intro", h2: "", points: [b.angle, b.searchIntent].filter(Boolean), h3: [], sources: b.outline[0]?.sources ?? [], cta: false },
    ...h2,
    ...(b.faqs.length ? [{ key: "faq", kind: "faq" as const, h2: FAQ, points: b.faqs.map((f) => `${f.question} ${f.answer}`), h3: b.faqs.map((f) => ({ title: f.question, points: [f.answer] })), sources: [], cta: false }] : []),
  ];
}

/** The brief, as the writer reads it. */
export function briefText(b: WriterBrief, notes: string): string {
  return [
    `The approved brief:`,
    `H1: ${b.h1}`,
    `Search intent: ${b.searchIntent}`,
    `Reader: ${b.reader}`,
    `Angle: ${b.angle}`,
    `Length: about ${b.wordTarget} words in all.`,
    `Outline:\n${b.outline.map((p) => `## ${p.h2} [sources ${p.sources.join(", ") || "none"}]\n${p.points.map((x) => `- ${x}`).join("\n")}${p.h3.map((h) => `\n### ${h.title}\n${h.points.map((x) => `- ${x}`).join("\n")}`).join("")}`).join("\n")}`,
    b.entities.length ? `Name these: ${b.entities.join(", ")}` : "",
    b.gaps.length ? `What the top pages miss, which this article covers:\n${b.gaps.map((g) => `- ${g}`).join("\n")}` : "",
    b.internalLinks.length ? `Internal links:\n${b.internalLinks.map((l) => `- "${l.anchor}" → ${l.url} (under ${l.where})`).join("\n")}` : "",
    b.cta.text ? `Call to action: ${b.cta.text}` : "",
    b.modules.length ? `Interactive modules (built separately, don't write them): ${b.modules.map((m) => `${m.title} after "${m.placement}"`).join("; ")}` : "",
    notes ? `The editor's notes:\n${notes}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ─────────────── step 1: sections ───────────────
const S = { type: "string" } as const;
export const SECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["blocks"],
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "text", "items", "rows"],
        properties: { type: { type: "string", enum: ["p", "h3", "ul", "ol", "quote", "table"] }, text: S, items: { type: "array", items: S }, rows: { type: "array", items: { type: "array", items: S } } },
      },
    },
  },
};

export function sectionPrompt(plan: SectionPlan[], i: number, b: WriterBrief, sources: SourcePage[], prev: Section | null, note: string | null): string {
  const s = plan[i];
  const words = Math.round(b.wordTarget / Math.max(1, plan.filter((p) => p.kind === "h2").length + 0.6));
  const cite = s.sources.length ? s.sources.map((n) => `[${n}] ${sources[n - 1]?.url ?? ""}`).join("\n") : "any source above that backs a claim";
  const links = b.internalLinks.filter((l) => l.where && s.h2 && l.where.toLowerCase() === s.h2.toLowerCase());
  const what =
    s.kind === "intro"
      ? `Write the intro: 2 or 3 short paragraphs, about ${Math.min(180, Math.round(words / 2))} words. Hook the reader with the problem, say what they'll get, and use the keyword naturally. No heading.`
      : s.kind === "faq"
        ? `Write the FAQ section "${s.h2}": each question as an h3 block, followed by a 2 to 4 sentence answer as a p block.\nQuestions:\n${s.h3.map((h) => `- ${h.title} (${h.points[0] ?? ""})`).join("\n")}`
        : `Write the section "${s.h2}", about ${words} words. Don't repeat the H2 itself.\nKey points:\n${s.points.map((p) => `- ${p}`).join("\n")}${s.h3.length ? `\nH3s (as h3 blocks, in order): ${s.h3.map((h) => `${h.title} (${h.points.join("; ")})`).join(" | ")}` : ""}`;
  return `${what}

The article's sections, for flow: ${plan.map((p) => (p.kind === "intro" ? "Intro" : p.h2)).join(" → ")}
${prev ? `The end of the section before this one:\n${sectionPlain(prev).slice(-1200)}\n` : ""}
Cite from:
${cite}
${links.length ? `Put these internal links in naturally: ${links.map((l) => `[${l.anchor}](${l.url})`).join(", ")}\n` : ""}${s.cta ? `End the section with the call to action: ${b.cta.text}\n` : ""}${note ? `The editor asked for this change: ${note}\n` : ""}
Rules:
- Write in the Brand Voice above. Sound like the brand, not like an AI: plain words, no filler, no "in today's fast-paced world", no "delve".
- Blocks: p (a paragraph), h3, ul or ol (items), quote, table (rows; the first row is the header). Fill only the field the block uses; leave the others empty.
- Inline formatting: **bold** for a few key terms, and links as [anchor](url).
- Cite a source for every fact, number or claim as a link on a few words of the sentence: [anchor](source url). Use only the source URLs above.
- Never invent numbers, quotes, studies or product details. If the sources don't say it, leave it out.
- Short paragraphs: 1 to 3 sentences.`;
}

// ─────────────── step 2: check ───────────────
const SENTENCE = /(?<=[.!?…])["”)\]]?\s+(?=["“(\[]?[A-Z0-9])/;
export const sentences = (text: string) => text.split(SENTENCE).map((s) => s.trim()).filter(Boolean);
export const stripLinks = (s: string) => s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 <$2>").replace(/\*\*([^*]+)\*\*/g, "$1");

/** Every sentence, list item and table row with an id the check can name: section.block.sentence. */
export function claimLines(sections: Section[]): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  sections.forEach((s, si) =>
    s.blocks.forEach((b, bi) => {
      if (b.type === "p" || b.type === "quote") sentences(b.text).forEach((t, k) => out.push({ id: `${si}.${bi}.${k}`, text: t }));
      else if (b.type === "ul" || b.type === "ol") b.items.forEach((t, k) => out.push({ id: `${si}.${bi}.i${k}`, text: t }));
      else if (b.type === "table") b.rows.slice(1).forEach((r, k) => out.push({ id: `${si}.${bi}.r${k + 1}`, text: r.join(" | ") }));
    }),
  );
  return out;
}

export const CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["cut"],
  properties: { cut: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "why"], properties: { id: S, why: S } } } },
};

export function checkPrompt(sections: Section[]): string {
  return `Check this draft against the numbered sources above. A claim is supported when a source above says it, or it is common knowledge, or it is the brand describing itself in the Brand Voice.

List the id of every sentence, list item or table row that makes a claim the sources don't support: a number, a fact, a quote, a study, a product detail or a link to a page that doesn't say it. Opinions, advice, transitions and questions are fine. When in doubt about a number, cut it.

The draft (id: text, with links as <url>):
${claimLines(sections)
  .map((l) => `${l.id}: ${stripLinks(l.text)}`)
  .join("\n")}

Reply with cut: [{id, why}], and an empty list when everything is supported.`;
}

const linkKey = (u: string) => u.replace(/#.*$/, "").replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "").toLowerCase();
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

/** Cut what the check named, and unlink every link that isn't a saved source, an internal link or the brand's site. */
export function applyCheck(sections: Section[], cut: { id: string; why: string }[], allowed: { urls: string[]; domain: string }): Checked {
  const ids = new Set(cut.map((c) => c.id));
  const ok = new Set(allowed.urls.map(linkKey));
  const domain = allowed.domain.replace(/^www\./, "").toLowerCase();
  let unlinked = 0;
  const fix = (t: string) =>
    t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, anchor: string, url: string) => {
      const host = hostOf(url);
      if (ok.has(linkKey(url)) || (domain && (host === domain || host.endsWith(`.${domain}`)))) return all;
      unlinked++;
      return anchor;
    });
  const out = sections
    .map((s, si) => ({
      ...s,
      blocks: s.blocks
        .map((b, bi): Block | null => {
          if (b.type === "p" || b.type === "quote") {
            const kept = sentences(b.text).filter((_, k) => !ids.has(`${si}.${bi}.${k}`));
            return kept.length ? { ...b, text: fix(kept.join(" ")) } : null;
          }
          if (b.type === "ul" || b.type === "ol") {
            const items = b.items.filter((_, k) => !ids.has(`${si}.${bi}.i${k}`)).map(fix);
            return items.length ? { ...b, items } : null;
          }
          if (b.type === "table") {
            const rows = b.rows.filter((_, k) => k === 0 || !ids.has(`${si}.${bi}.r${k}`)).map((r) => r.map(fix));
            return rows.length > 1 ? { ...b, rows } : null;
          }
          return { ...b, text: fix(b.text) };
        })
        .filter((b): b is Block => b !== null),
    }))
    // An h3 left with nothing under it goes too.
    .map((s) => ({ ...s, blocks: s.blocks.filter((b, i, all) => b.type !== "h3" || (all[i + 1] && all[i + 1].type !== "h3")) }))
    .filter((s) => s.key === "intro" || s.blocks.length);
  return { sections: out, cut, unlinked };
}

// ─────────────── the doc ───────────────
type PMNode = { type: string; attrs?: Record<string, unknown>; content?: PMNode[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };

/** Text with **bold**, *italic* and [links](url) as editor text nodes. */
export function inlineNodes(text: string): PMNode[] {
  const out: PMNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push({ type: "text", text: text.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ type: "text", text: m[1], marks: [{ type: "link", attrs: { href: m[2], target: "_blank", rel: "noopener noreferrer nofollow" } }] });
    else if (m[3] !== undefined) out.push({ type: "text", text: m[3], marks: [{ type: "bold" }] });
    else out.push({ type: "text", text: m[4], marks: [{ type: "italic" }] });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ type: "text", text: text.slice(at) });
  return out.filter((n) => n.text);
}

const para = (t: string): PMNode => {
  const content = inlineNodes(t);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};
const heading = (level: number, t: string): PMNode => ({ type: "heading", attrs: { level }, content: inlineNodes(t) });
const cellAttrs = { colspan: 1, rowspan: 1, colwidth: null };

function blockNodes(b: Block): PMNode[] {
  switch (b.type) {
    case "h3":
      return b.text.trim() ? [heading(3, b.text)] : [];
    case "ul":
    case "ol":
      return b.items.length ? [{ type: b.type === "ul" ? "bulletList" : "orderedList", ...(b.type === "ol" ? { attrs: { start: 1 } } : {}), content: b.items.map((i) => ({ type: "listItem", content: [para(i)] })) }] : [];
    case "quote":
      return b.text.trim() ? [{ type: "blockquote", content: [para(b.text)] }] : [];
    case "table": {
      const width = Math.max(0, ...b.rows.map((r) => r.length));
      if (b.rows.length < 2 || !width) return [];
      return [
        {
          type: "table",
          content: b.rows.map((r, ri) => ({
            type: "tableRow",
            content: Array.from({ length: width }, (_, ci) => ({ type: ri === 0 ? "tableHeader" : "tableCell", attrs: cellAttrs, content: [para(r[ci] ?? "")] })),
          })),
        },
      ];
    }
    default:
      return b.text.trim() ? [para(b.text)] : [];
  }
}

const plainOf = (b: Block) => (b.type === "table" ? b.rows.map((r) => r.join(" ")).join(" ") : b.type === "ul" || b.type === "ol" ? b.items.join(" ") : b.text);
export const sectionPlain = (s: Section) => [s.h2, ...s.blocks.map(plainOf)].filter(Boolean).join("\n\n").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*?/g, "");
const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** The finished draft as the editor's document: sections in order, each module after its H2. */
export function buildDoc(b: WriterBrief, sections: Section[], modules: { module: PlannedModule; html: string }[]): DocOut {
  const content: PMNode[] = [];
  const placed = new Set<number>();
  for (const s of sections) {
    if (s.h2) content.push(heading(2, s.h2));
    for (const blk of s.blocks) content.push(...blockNodes(blk));
    modules.forEach((m, i) => {
      if (!placed.has(i) && s.h2 && m.module.placement.toLowerCase() === s.h2.toLowerCase()) {
        content.push({ type: "embed", attrs: { html: m.html } });
        placed.add(i);
      }
    });
  }
  // A module whose section was cut goes before the FAQ, or at the end.
  const faq = content.findIndex((n) => n.type === "heading" && n.content?.[0]?.text === FAQ);
  const rest = modules.filter((_, i) => !placed.has(i)).map((m) => ({ type: "embed", attrs: { html: m.html } }));
  if (rest.length) content.splice(faq >= 0 ? faq : content.length, 0, ...rest);
  const words = countWords(sections.map(sectionPlain).join(" "));
  return { title: b.h1, content: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] }, words, meta: { title: b.titles[0] ?? b.h1, description: b.metaDescription, slug: b.slug } };
}

// ─────────────── the job ───────────────
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** Claude's section, cleaned: known block types only, empty blocks dropped. */
export function cleanSection(x: unknown, plan: SectionPlan): Section {
  const o = (x && typeof x === "object" ? x : {}) as { blocks?: unknown };
  const blocks = (Array.isArray(o.blocks) ? o.blocks : [])
    .map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>) : {}))
    .filter((r) => ["p", "h3", "ul", "ol", "quote", "table"].includes(String(r.type)))
    .map((r) => ({
      type: r.type as BlockType,
      text: str(r.text, 4000),
      items: (Array.isArray(r.items) ? r.items : []).map((i) => str(i, 1000)).filter(Boolean).slice(0, 30),
      rows: (Array.isArray(r.rows) ? r.rows : []).map((row) => (Array.isArray(row) ? row.map((c) => str(c, 400)).slice(0, 8) : [])).filter((row) => row.length).slice(0, 30),
    }))
    .filter((b) => b.text || b.items.length || b.rows.length);
  return { key: plan.key, h2: plan.h2, blocks };
}

/** The pages behind the brief, in the brief's numbering. */
export function sourcesFor(b: WriterBrief, pack: ResearchPack): SourcePage[] {
  return b.research.sources.map((s) => pack.pages.find((p) => p.url === s.url) ?? { url: s.url, title: s.title, domain: s.domain, kind: s.kind, position: s.position, words: s.words, headings: [], body: "" });
}

/**
 * Run (or resume) a draft as far as it can go in one turn. Finished steps are skipped; each paid call's output is
 * saved before the next. "wait" means come back for the rest (a time budget, so one turn stays short).
 */
export async function runDraft(store: DraftStore, deps: DraftDeps, id: string, version?: number): Promise<Outcome> {
  const now = deps.now ?? Date.now;
  const start = now();
  const over = () => now() - start > (deps.budgetMs ?? BUDGET_MS);
  const later: Outcome = { state: "wait", seconds: 1, why: "next step" };
  let d = await store.draft(id);
  if (!d) return { state: "failed", error: "This draft was deleted." };
  if (d.status !== "generating" || (version !== undefined && d.version !== version)) return { state: "done" };
  const b = await store.brief(d.brief_id);
  if (!b?.brief) {
    const error = "The brief behind this draft is gone.";
    await store.update(id, { status: "failed", error });
    return { state: "failed", error };
  }
  const brief = b.brief;
  const { ctx, pack } = await deps.context(d, b);
  const sources = sourcesFor(brief, pack);
  // The stable start of every call for this draft, cached by Claude: the brand, the research and the brief.
  const prefix = `${contextPrefix(ctx, pack, sources)}\n\n${briefText(brief, b.notes)}`;
  const plan = planSections(brief);
  const save = async (patch: Partial<DraftRow>) => {
    await store.update(id, patch);
    d = { ...d!, ...patch };
  };

  // Step 1: sections, one call each, saved one by one.
  const sections = [...d.sections];
  for (let i = 0; i < plan.length; i++) {
    if (sections[i]) continue;
    if (over()) return later;
    const raw = await deps.writeSection(prefix, sectionPrompt(plan, i, brief, sources, sections[i - 1] ?? null, d.note));
    sections[i] = cleanSection(raw, plan[i]);
    await save({ sections, step: i === plan.length - 1 ? "check" : "sections" });
  }
  const written = sections.filter((s): s is Section => Boolean(s));

  // Step 2: the check, one call over the whole draft.
  if (!d.checked) {
    if (over()) return later;
    const raw = (await deps.check(prefix, checkPrompt(written))) as { cut?: unknown };
    const cut = (Array.isArray(raw?.cut) ? raw.cut : []).map((c) => ({ id: str((c as { id?: unknown }).id, 40), why: str((c as { why?: unknown }).why, 300) })).filter((c) => c.id);
    const allowed = { urls: [...brief.research.sources.map((s) => s.url), ...brief.internalLinks.map((l) => l.url)], domain: ctx.brand.domain };
    await save({ checked: applyCheck(written, cut, allowed), check_at: new Date(now()).toISOString(), step: "modules" });
  }
  const final = d.checked!.sections;

  // Step 3: modules, each built, checked, retried once, or dropped.
  const validate = deps.validate ?? validateModule;
  const mods = [...d.modules];
  for (let j = 0; j < brief.modules.length; j++) {
    const m = brief.modules[j];
    const state = mods[j];
    if (state && state.status !== "retry") continue;
    if (over()) return later;
    const section = final.find((s) => s.h2.toLowerCase() === m.placement.toLowerCase());
    const raw = (await deps.buildModule(prefix, modulePrompt(m, { keyword: b.keyword, brand: ctx.brand.name, section: section ? sectionPlain(section) : "" }, state?.error))) as { html?: unknown };
    const html = str(raw?.html, 200_000);
    const v = validate(html);
    const attempts = (state?.attempts ?? 0) + 1;
    mods[j] = v.ok ? { status: "ok", attempts, html: wrapModule(html, m, ctx.kit), error: null } : { status: attempts >= MODULE_TRIES ? "dropped" : "retry", attempts, html: null, error: v.error };
    await save({ modules: mods, step: j === brief.modules.length - 1 && mods[j]!.status !== "retry" ? "save" : "modules" });
    if (mods[j]!.status === "retry") j--; // try it again now, with the reason
  }

  // Step 4: into the doc. Free, and safe to repeat.
  const built = brief.modules.map((module, j) => ({ module, html: mods[j]?.status === "ok" ? mods[j]!.html! : "" })).filter((m) => m.html);
  const doc = buildDoc(brief, final, built);
  const at = new Date(now()).toISOString();
  const docId = await store.saveDoc(d, doc, at);
  await save({ doc_id: docId, status: "ready", step: "done", words: doc.words, ready_at: at, error: null });
  return { state: "done" };
}

// ─────────────── the month's drafts ───────────────
export type DraftRef = { id: string; status: DraftStatus; doc_id: string | null; ready_at: string | null; version: number };
export type QuotaStore = {
  draftFor(itemId: string): Promise<DraftRef | null>;
  /** True when someone changed the draft's doc after the job last wrote it. */
  editedByHand(d: DraftRef): Promise<boolean>;
  /** Make the topic's first draft if the brand's month has room (writer_take_draft in 050). */
  take(row: { workspace_id: string; brand_id: string | null; site_id: string; item_id: string; brief_id: string; period: string; created_by: string | null }, limit: number): Promise<{ outcome: "created" | "exists" | "full"; id: string | null }>;
  /** Start the draft over from the brief: a new version, nothing counted. */
  regenerate(id: string, patch: { brief_id: string; note: string | null }): Promise<number>;
};
export type DraftAsk = { brief: BriefRow; limit: number; period: string; note?: string | null; confirm?: boolean; userId?: string | null };
export type DraftAnswer = { ok: true; draftId: string; version: number; counted: boolean; started: boolean } | { ok: false; status: number; error: string; edited?: boolean };

/**
 * Generate Draft and Regenerate. A topic's first draft counts against the brand's month; Regenerate never does,
 * and asks first when the draft was edited by hand.
 */
export async function requestDraft(store: QuotaStore, ask: DraftAsk): Promise<DraftAnswer> {
  const b = ask.brief;
  if (b.status !== "approved" || !b.brief) return { ok: false, status: 409, error: "Approve the brief first." };
  const note = ask.note?.trim().slice(0, 300) || null;
  for (let round = 0; round < 2; round++) {
    const have = await store.draftFor(b.item_id);
    if (have) {
      if (have.status === "generating") return { ok: true, draftId: have.id, version: have.version, counted: false, started: false };
      if (have.status === "ready" && !ask.confirm && (await store.editedByHand(have))) return { ok: false, status: 409, error: "This draft was edited by hand. Regenerating replaces those edits.", edited: true };
      const version = await store.regenerate(have.id, { brief_id: b.id, note });
      return { ok: true, draftId: have.id, version, counted: false, started: true };
    }
    if (ask.limit <= 0) return { ok: false, status: 429, error: "Your plan doesn't include drafts. They start on Pro." };
    const r = await store.take({ workspace_id: b.workspace_id, brand_id: b.brand_id, site_id: b.site_id, item_id: b.item_id, brief_id: b.id, period: ask.period, created_by: ask.userId ?? null }, ask.limit);
    if (r.outcome === "full") return { ok: false, status: 429, error: `This brand used this month's ${ask.limit} drafts.` };
    if (r.outcome === "created" && r.id) return { ok: true, draftId: r.id, version: 1, counted: true, started: true };
    // "exists": another click made it a moment ago. Look again.
  }
  return { ok: false, status: 409, error: "This topic's draft changed while starting. Try again." };
}
