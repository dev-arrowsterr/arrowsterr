// Chat results and run history. Runs are saved in Supabase (see db.ts). The browser copy is only read once, to import old data.
import type { Source } from "./sources";

export type BrandMention = { name: string; position: number; sentiment: number; domain?: string };

export type Chat = {
  engine: string;
  prompt: string;
  text: string;
  sources: Source[];
  brands: BrandMention[];
  error: string | null;
  answered?: boolean; // set when saved, because saved chats drop their full text to save space
};

export type Run = { at: string; engines: string[]; chats: Chat[] };

export function isAnswered(c: Chat) {
  return c.answered ?? Boolean(c.text);
}

/** The tracked brand's entry in a chat, if the answer named it. */
export function ownMention(chat: Chat, brandName: string): BrandMention | null {
  const name = brandName.toLowerCase();
  return chat.brands.find((b) => b.name.toLowerCase() === name) ?? null;
}

const key = (brandId: string) => `arrowsterr.runs.${brandId}`;
const MAX_RUNS = 120;

export function loadRuns(brandId: string): Run[] {
  try {
    const list = JSON.parse(localStorage.getItem(key(brandId)) || "null");
    if (Array.isArray(list)) return list;
    // Older versions kept only the latest run.
    const old = JSON.parse(localStorage.getItem(`arrowsterr.run.${brandId}`) || "null");
    return old ? [old] : [];
  } catch {
    return [];
  }
}

/** Keep the numbers, drop the long answer text, and trim the oldest runs if storage is full. */
export function saveRuns(brandId: string, runs: Run[]) {
  let slim = runs.slice(-MAX_RUNS).map((r) => ({
    ...r,
    chats: r.chats.map((c) => ({ ...c, answered: isAnswered(c), text: "" })),
  }));
  while (slim.length) {
    try {
      localStorage.setItem(key(brandId), JSON.stringify(slim));
      return;
    } catch {
      slim = slim.slice(1);
    }
  }
}
