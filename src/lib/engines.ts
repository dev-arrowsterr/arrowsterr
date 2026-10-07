import "server-only";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { askClaude } from "./claude";
import { cleanSources, linksInText, type Source } from "./sources";

export const ENGINES = ["ChatGPT", "Claude", "Gemini", "Perplexity"] as const;
export type Engine = (typeof ENGINES)[number];

const KEYS: Record<Engine, string> = {
  ChatGPT: "OPENAI_API_KEY",
  Claude: "ANTHROPIC_API_KEY",
  Gemini: "GEMINI_API_KEY",
  Perplexity: "PERPLEXITY_API_KEY",
};

/** Engines that have an API key set on the server. */
export function availableEngines(): Engine[] {
  return ENGINES.filter((e) => process.env[KEYS[e]]);
}

type Answer = { text: string; sources: Source[] };

async function askChatGPT(prompt: string): Promise<Answer> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const resp = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5.2",
    input: prompt,
    tools: [{ type: "web_search" }],
  });
  const sources: Source[] = [];
  for (const item of resp.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content) {
      if (part.type !== "output_text") continue;
      for (const a of part.annotations ?? []) {
        if (a.type === "url_citation") sources.push({ url: a.url, title: a.title, domain: "" });
      }
    }
  }
  return { text: resp.output_text ?? "", sources };
}

async function askGemini(prompt: string): Promise<Answer> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const resp = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-3-flash-preview",
    contents: prompt,
    config: { tools: [{ googleSearch: {} }] },
  });
  const sources: Source[] = [];
  for (const chunk of resp.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) {
    const uri = chunk.web?.uri;
    if (!uri) continue;
    // Gemini links go through a Google redirect. The title holds the real site's domain.
    const title = chunk.web?.title ?? null;
    const domain = title && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(title) ? title.toLowerCase().replace(/^www\./, "") : "";
    sources.push({ url: uri, title, domain });
  }
  return { text: resp.text ?? "", sources };
}

async function askPerplexity(prompt: string): Promise<Answer> {
  const client = new OpenAI({ apiKey: process.env.PERPLEXITY_API_KEY, baseURL: "https://api.perplexity.ai" });
  const resp = await client.chat.completions.create({
    model: process.env.PERPLEXITY_MODEL || "sonar",
    messages: [{ role: "user", content: prompt }],
  });
  // Perplexity adds its sources as extra fields on the response.
  const extra = resp as unknown as { citations?: string[]; search_results?: { url?: string; title?: string }[] };
  const sources: Source[] = extra.search_results?.length
    ? extra.search_results.filter((s) => s.url).map((s) => ({ url: s.url!, title: s.title ?? null, domain: "" }))
    : (extra.citations ?? []).map((url) => ({ url, title: null, domain: "" }));
  return { text: resp.choices[0]?.message?.content ?? "", sources };
}

/** Every engine gets the same answer layout, so the ranked list can be read by code. */
export const ANSWER_FORMAT = `

Format your answer in markdown exactly like this:

## Recommendations
1. **Name** - one sentence on why you recommend it.
2. **Name** - one sentence on why you recommend it.
(List up to 10 options, best first. Put only the brand or product name in bold.)

## Summary
Two or three sentences with your overall advice.`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ask one engine one prompt with web search on, in the shared answer layout. Tries twice. */
export async function askEngine(engine: Engine, userPrompt: string): Promise<Answer> {
  const prompt = userPrompt + ANSWER_FORMAT;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const a =
        engine === "ChatGPT"
          ? await askChatGPT(prompt)
          : engine === "Claude"
            ? await askClaude(prompt, { searches: 1 })
            : engine === "Gemini"
              ? await askGemini(prompt)
              : await askPerplexity(prompt);
      const text = a.text.replace(/\[\d+\]/g, "");
      return { text, sources: cleanSources([...a.sources, ...linksInText(text)]) };
    } catch (e) {
      lastError = e;
      await sleep(2000);
    }
  }
  throw lastError;
}
