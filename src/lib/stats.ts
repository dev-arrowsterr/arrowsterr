// Dashboard numbers from a list of chats. Pure functions, no network.
import type { Chat } from "./chats";

export type BrandRow = {
  name: string;
  visibility: number; // % of answered chats that mention the brand
  position: number; // average position when mentioned
  sentiment: number; // average sentiment when mentioned
  mentions: number;
  isYou: boolean;
};

export type SourceRow = { domain: string; used: number; chats: number };

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function brandRows(chats: Chat[], you: string): BrandRow[] {
  const answered = chats.filter((c) => c.text);
  const map = new Map<string, { name: string; positions: number[]; sentiments: number[] }>();
  for (const c of answered) {
    for (const b of c.brands) {
      const key = b.name.toLowerCase();
      const row = map.get(key) ?? { name: b.name, positions: [], sentiments: [] };
      row.positions.push(b.position);
      row.sentiments.push(b.sentiment);
      map.set(key, row);
    }
  }
  return [...map.values()].map((r) => ({
    name: r.name,
    mentions: r.positions.length,
    visibility: answered.length ? (r.positions.length / answered.length) * 100 : 0,
    position: avg(r.positions),
    sentiment: avg(r.sentiments),
    isYou: r.name.toLowerCase() === you.toLowerCase(),
  }));
}

export function sourceRows(chats: Chat[]): SourceRow[] {
  const answered = chats.filter((c) => c.text);
  const map = new Map<string, number>();
  for (const c of answered) for (const d of new Set(c.sources.map((s) => s.domain))) map.set(d, (map.get(d) ?? 0) + 1);
  return [...map.entries()]
    .map(([domain, n]) => ({ domain, chats: n, used: answered.length ? (n / answered.length) * 100 : 0 }))
    .sort((a, b) => b.chats - a.chats);
}
