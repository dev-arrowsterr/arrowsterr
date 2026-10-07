import "server-only";
import { askEngine, type Engine } from "./engines";
import { extractBrands } from "./extract";
import type { Chat } from "./chats";

/** Ask one engine one prompt, then pull out the brands it named. Never throws. */
export async function answerChat(engine: Engine, prompt: string, brand: string, domain: string): Promise<Chat> {
  const chat: Chat = { engine, prompt, text: "", sources: [], brands: [], error: null };
  try {
    const answer = await askEngine(engine, prompt);
    chat.text = answer.text;
    chat.sources = answer.sources;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`${engine} failed:`, message);
    return { ...chat, error: `${engine}: ${message.slice(0, 300)}` };
  }
  // No AI Overview was shown, so there is nothing to read.
  if (engine === "AI Overview" && chat.text.startsWith("_Google showed no AI Overview")) return { ...chat, sources: [] };
  try {
    chat.brands = await extractBrands(brand, domain, chat.text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Brand extraction failed:", message);
    chat.error = `Reading the answer failed: ${message.slice(0, 300)}`;
  }
  return chat;
}
