import "server-only";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { askClaude } from "./claude";
import { cleanSources, linksInText, type Source } from "./sources";

export const ENGINES = ["ChatGPT", "Claude", "Gemini", "Perplexity", "AI Overview"] as const;
export type Engine = (typeof ENGINES)[number];

// Settings each engine needs. Google AI Overview comes from DataForSEO, which needs a login and a password.
const KEYS: Record<Engine, string[]> = {
  ChatGPT: ["OPENAI_API_KEY"],
  Claude: ["ANTHROPIC_API_KEY"],
  Gemini: ["GEMINI_API_KEY"],
  Perplexity: ["PERPLEXITY_API_KEY"],
  "AI Overview": ["DFS_LOGIN", "DFS_PASSWORD"],
};

/** Engines that have their keys set on the server. */
export function availableEngines(): Engine[] {
  return ENGINES.filter((e) => KEYS[e].every((k) => process.env[k]));
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

type DfsItem = {
  type?: string;
  markdown?: string;
  text?: string;
  title?: string;
  items?: DfsItem[];
  references?: { url?: string; domain?: string; title?: string }[];
};

/**
 * Google's AI Overview for the prompt, searched as a normal Google query through DataForSEO.
 * Google decides when to show an AI Overview. When it shows none, the chat counts as answered with no brands.
 */
async function askAIOverview(prompt: string): Promise<Answer> {
  const auth = Buffer.from(`${process.env.DFS_LOGIN}:${process.env.DFS_PASSWORD}`).toString("base64");
  const res = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/advanced", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      {
        keyword: prompt.slice(0, 700),
        location_code: Number(process.env.DFS_LOCATION_CODE) || 2840, // United States
        language_code: process.env.DFS_LANGUAGE_CODE || "en",
        device: "desktop",
        load_async_ai_overview: true,
      },
    ]),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`DataForSEO returned ${res.status}`);
  const data = await res.json();
  const task = data?.tasks?.[0];
  if (data?.status_code !== 20000) throw new Error(`DataForSEO: ${data?.status_message ?? "unknown error"}`);
  if (task?.status_code !== 20000) throw new Error(`DataForSEO: ${task?.status_message ?? "unknown error"}`);

  const items: DfsItem[] = task.result?.[0]?.items ?? [];
  const aio = items.find((i) => i.type === "ai_overview");
  if (!aio) return { text: "_Google showed no AI Overview for this search._", sources: [] };

  const text =
    aio.markdown ||
    (aio.items ?? [])
      .map((i) => [i.title ? `## ${i.title}` : "", i.markdown || i.text || ""].filter(Boolean).join("\n"))
      .join("\n\n");
  const refs = [...(aio.references ?? []), ...(aio.items ?? []).flatMap((i) => i.references ?? [])];
  const sources: Source[] = refs.filter((r) => r.url).map((r) => ({ url: r.url!, title: r.title ?? null, domain: r.domain ?? "" }));
  return { text, sources };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ask one engine one prompt with web search on, in the shared answer layout. Tries twice. */
export async function askEngine(engine: Engine, userPrompt: string): Promise<Answer> {
  // AI Overview is a Google search, so it gets the plain prompt. Chat engines get the shared layout.
  const prompt = engine === "AI Overview" ? userPrompt : userPrompt + ANSWER_FORMAT;
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
              : engine === "Perplexity"
                ? await askPerplexity(prompt)
                : await askAIOverview(prompt);
      const text = a.text.replace(/\[\d+\]/g, "");
      return { text, sources: cleanSources([...a.sources, ...linksInText(text)]) };
    } catch (e) {
      lastError = e;
      await sleep(2000);
    }
  }
  throw lastError;
}
