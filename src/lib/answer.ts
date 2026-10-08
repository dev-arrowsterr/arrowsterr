import "server-only";
import type { Chat } from "./chats";
import { NO_AI_OVERVIEW, type DfsAnswer } from "./dataforseo";
import { askEngine, type Engine } from "./engines";
import { extractBrands } from "./extract";
import { quoteOf } from "./quote";

/** Pull the brands out of an answer we already have. Never throws. */
export async function readAnswer(engine: string, prompt: string, answer: DfsAnswer, brand: string, domain: string): Promise<Chat> {
  const chat: Chat = { engine, prompt, text: answer.text, sources: answer.sources, brands: [], error: null };
  if (answer.shown !== undefined) chat.shown = answer.shown;
  if (answer.organic) chat.organic = answer.organic;
  // Google showed no AI answer, so there is nothing to read.
  if (answer.text === NO_AI_OVERVIEW) return { ...chat, sources: [] };
  try {
    chat.brands = await extractBrands(brand, domain, answer.text);
    // Keep one sentence, since saved chats drop the full text.
    const you = chat.brands.find((b) => b.name.toLowerCase() === brand.toLowerCase());
    const target = you ?? [...chat.brands].sort((a, b) => a.position - b.position)[0];
    const text = target ? quoteOf(answer.text, target.name) : null;
    chat.quote = target && text ? { brand: target.name, text } : null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Brand extraction failed:", message);
    chat.error = `Reading the answer failed: ${message.slice(0, 300)}`;
  }
  return chat;
}

/** Ask one engine one prompt, then pull out the brands it named. Never throws. */
export async function answerChat(engine: Engine, prompt: string, brand: string, domain: string): Promise<Chat> {
  try {
    return await readAnswer(engine, prompt, await askEngine(engine, prompt), brand, domain);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`${engine} failed:`, message);
    return { engine, prompt, text: "", sources: [], brands: [], error: `${engine}: ${message.slice(0, 300)}` };
  }
}
