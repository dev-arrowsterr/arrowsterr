// Brand Voice (docs/content-v2.md): how a brand writes, distilled from its best pages or pasted text.
// Every article is written from it. Shared by the server and the browser, and pure, so tests can cover it.
import type { BrandKit } from "./brandKit.ts";

export type BrandVoice = {
  tone: string[]; // up to 5 single words, like "plain", "warm", "direct"
  sentences: string; // sentence length and rhythm, like "Short, 8 to 15 words; one idea each"
  use: string[]; // words and phrases the brand uses
  avoid: string[]; // words and phrases it never uses
  naming: string; // how the brand names itself and its product, like "Acme (never ACME); the product is Acme Desk"
  reader: string; // the reader it writes for
};

/** A brand's saved voice row. voice is null before the first distill. */
export type VoiceRow = { brand_id: string; sample_urls: string[]; sample_text: string; voice: BrandVoice | null; distilled_at: string | null; updated_at: string };

export const EMPTY_VOICE: BrandVoice = { tone: [], sentences: "", use: [], avoid: [], naming: "", reader: "" };
export const MAX_URLS = 5;
export const MIN_URLS = 3;
export const MAX_TEXT = 30_000;

export const VOICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tone", "sentences", "use", "avoid", "naming", "reader"],
  properties: {
    tone: { type: "array", items: { type: "string" } },
    sentences: { type: "string" },
    use: { type: "array", items: { type: "string" } },
    avoid: { type: "array", items: { type: "string" } },
    naming: { type: "string" },
    reader: { type: "string" },
  },
};

const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
/** A list of short, distinct terms. Commas inside one string split it, so "a, b" from a form becomes two. */
const terms = (v: unknown, each: number, max: number) => {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  const out: string[] = [];
  for (const x of raw.flatMap((r) => (typeof r === "string" ? r.split(/[,\n]/) : []))) {
    const t = str(x, each);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= max) break;
  }
  return out;
};

/** The agent's reply or a person's edits, cleaned: missing or broken fields come back empty, lists trimmed and deduped. */
export function cleanVoice(x: unknown): BrandVoice {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  return {
    tone: terms(o.tone, 24, 5).map((t) => t.toLowerCase()),
    sentences: str(o.sentences, 200),
    use: terms(o.use, 60, 20),
    avoid: terms(o.avoid, 60, 20),
    naming: str(o.naming, 300),
    reader: str(o.reader, 300),
  };
}

/** True once the voice says enough to write from: a tone and a reader. */
export const voiceReady = (v: BrandVoice | null | undefined) => Boolean(v && v.tone.length && v.reader);

/**
 * The sample addresses a person pasted: split on spaces, commas and new lines, made https, deduped.
 * Anything that isn't a web address comes back in bad. At most MAX_URLS are kept.
 */
export function sampleUrls(input: string): { urls: string[]; bad: string[] } {
  const urls: string[] = [];
  const bad: string[] = [];
  for (const raw of input.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)) {
    let u: URL;
    try {
      u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      bad.push(raw);
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) {
      bad.push(raw);
      continue;
    }
    u.hash = "";
    const s = u.toString();
    if (!urls.includes(s)) urls.push(s);
  }
  return { urls: urls.slice(0, MAX_URLS), bad };
}

/** What the agent reads to distill the voice, from each page's text and the pasted text. */
export function distillPrompt(brand: { name: string; domain: string }, samples: { source: string; text: string }[], kit?: Pick<BrandKit, "voice"> | null) {
  const hint = kit?.voice.tone.length ? `\nThe brand's Brand Kit already says it sounds: ${kit.voice.tone.join(", ")}. Use it only if the samples agree.` : "";
  return `You distill a brand's writing voice from samples of its best writing, so new articles sound like the brand wrote them.

Brand: ${brand.name} (${brand.domain})${hint}

Samples:
${samples.map((s, i) => `--- Sample ${i + 1} (${s.source}) ---\n${s.text}`).join("\n\n")}

Rules:
- tone: 3 to 5 single words for how the brand sounds, like "plain", "warm", "confident".
- sentences: one line on sentence length and rhythm, with a number range, like "Short, 8 to 15 words; one idea per sentence".
- use: up to 12 words or short phrases the brand uses often or on purpose. Take them from the samples.
- avoid: up to 12 words or phrases the brand never uses and a writer might reach for, like jargon or hype the samples steer clear of.
- naming: how the brand writes its own name and its product's names: spelling, capitals, and what it calls the product.
- reader: one line on who the brand writes for: their role, what they know already and what they want.
- Base everything on the samples, not on what brands like this usually sound like.`;
}

/** The voice as instructions for a writer, for the article prompts. */
export function voiceText(v: BrandVoice | null | undefined) {
  if (!v) return "";
  return [
    v.tone.length ? `Tone: ${v.tone.join(", ")}.` : "",
    v.sentences ? `Sentences: ${v.sentences}.` : "",
    v.use.length ? `Words to use: ${v.use.join(", ")}.` : "",
    v.avoid.length ? `Never use: ${v.avoid.join(", ")}.` : "",
    v.naming ? `Naming: ${v.naming}.` : "",
    v.reader ? `Reader: ${v.reader}.` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .replace(/\.\./g, ".");
}
