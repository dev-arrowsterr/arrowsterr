import "server-only";
import type { BrandKit } from "./brandKit";
import { cleanVoice, distillPrompt, VOICE_SCHEMA, type BrandVoice } from "./brandVoice";
import { askJson } from "./claude";
import { pageText } from "./pageText";
import { safeFetch } from "./safeFetch";

/** One sample page's writing. Private addresses are refused by safeFetch; a page that fails comes back with its error. */
export async function readSample(url: string): Promise<{ url: string; text: string; error?: string }> {
  const r = await safeFetch(url, { timeout: 15_000, maxBytes: 2_000_000 });
  if (!r.ok) return { url, text: "", error: r.error ?? `It answered ${r.status}.` };
  const { text, words } = pageText(r.body);
  if (words < 80) return { url, text: "", error: "Too little writing on the page." };
  return { url, text };
}

/**
 * Distill a brand's voice from its sample pages and pasted text (docs/content-v2.md, Brand Voice).
 * Each page is read first; pages that fail are skipped and named in skipped. Needs at least one sample with writing.
 */
export async function distillVoice(
  brand: { name: string; domain: string },
  input: { urls: string[]; text: string },
  kit?: Pick<BrandKit, "voice"> | null,
): Promise<{ voice: BrandVoice; skipped: { url: string; error: string }[] }> {
  const pages = await Promise.all(input.urls.map(readSample));
  const samples = pages.filter((p) => p.text).map((p) => ({ source: p.url, text: p.text }));
  if (input.text.trim()) samples.push({ source: "pasted text", text: input.text.trim().slice(0, 12_000) });
  const skipped = pages.filter((p) => !p.text).map((p) => ({ url: p.url, error: p.error ?? "No writing found." }));
  if (!samples.length) throw new Error(skipped.length ? `None of the pages could be read: ${skipped.map((s) => `${s.url} (${s.error})`).join("; ")}` : "Add 3 to 5 links or paste some writing.");
  const out = await askJson<Record<string, unknown>>(distillPrompt(brand, samples, kit), VOICE_SCHEMA, { maxTokens: 1500 });
  return { voice: cleanVoice(out), skipped };
}
