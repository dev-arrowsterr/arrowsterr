// Chat results, shared by the pages. Saved in the browser until the database step.
import type { Source } from "./sources";

export type BrandMention = { name: string; position: number; sentiment: number };

export type Chat = {
  engine: string;
  prompt: string;
  text: string;
  sources: Source[];
  brands: BrandMention[];
  error: string | null;
};

export type Run = { at: string; engines: string[]; chats: Chat[] };

/** The tracked brand's entry in a chat, if the answer named it. */
export function ownMention(chat: Chat, brandName: string): BrandMention | null {
  const name = brandName.toLowerCase();
  return chat.brands.find((b) => b.name.toLowerCase() === name) ?? null;
}

const key = (brandId: string) => `arrowsterr.run.${brandId}`;

export function loadRun(brandId: string): Run | null {
  try {
    return JSON.parse(localStorage.getItem(key(brandId)) || "null");
  } catch {
    return null;
  }
}

export function saveRun(brandId: string, run: Run) {
  try {
    localStorage.setItem(key(brandId), JSON.stringify(run));
  } catch {
    // Storage full or blocked. Results still show until the page reloads.
  }
}
