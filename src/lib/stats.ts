// Dashboard numbers from chats and runs. Pure functions, no network.
import { isAnswered, ownMention, type Chat, type Run } from "./chats";

export type BrandRow = {
  name: string;
  domain: string | null;
  visibility: number; // % of answered chats that mention the brand
  position: number; // average position when mentioned
  sentiment: number; // average sentiment when mentioned
  mentions: number;
  isYou: boolean;
};

export type SourceRow = { domain: string; used: number; chats: number };

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function brandRows(chats: Chat[], you: string): BrandRow[] {
  const answered = chats.filter(isAnswered);
  const map = new Map<string, { name: string; positions: number[]; sentiments: number[]; domains: Map<string, number> }>();
  for (const c of answered) {
    for (const b of c.brands) {
      const key = b.name.toLowerCase();
      const row = map.get(key) ?? { name: b.name, positions: [] as number[], sentiments: [] as number[], domains: new Map<string, number>() };
      row.positions.push(b.position);
      row.sentiments.push(b.sentiment);
      if (b.domain) row.domains.set(b.domain, (row.domains.get(b.domain) ?? 0) + 1);
      map.set(key, row);
    }
  }
  return [...map.values()].map((r) => ({
    name: r.name,
    domain: [...r.domains.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    mentions: r.positions.length,
    visibility: answered.length ? (r.positions.length / answered.length) * 100 : 0,
    position: avg(r.positions),
    sentiment: avg(r.sentiments),
    isYou: r.name.toLowerCase() === you.toLowerCase(),
  }));
}

export function sourceRows(chats: Chat[]): SourceRow[] {
  const answered = chats.filter(isAnswered);
  const map = new Map<string, number>();
  for (const c of answered) for (const d of new Set(c.sources.map((s) => s.domain))) map.set(d, (map.get(d) ?? 0) + 1);
  return [...map.entries()]
    .map(([domain, n]) => ({ domain, chats: n, used: answered.length ? (n / answered.length) * 100 : 0 }))
    .sort((a, b) => b.chats - a.chats);
}

export type DayPoint = { day: string; values: Record<string, number | null> };

/** Visibility per brand for each day that has runs. */
export function timeline(runs: Run[], names: string[], filter: (c: Chat) => boolean): DayPoint[] {
  const byDay = new Map<string, Chat[]>();
  for (const r of runs) {
    const day = r.at.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), ...r.chats.filter(filter)]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, chats]) => {
      const answered = chats.filter(isAnswered);
      const values: Record<string, number | null> = {};
      for (const n of names) {
        const hits = answered.filter((c) => c.brands.some((b) => b.name.toLowerCase() === n.toLowerCase())).length;
        values[n] = answered.length ? (hits / answered.length) * 100 : null;
      }
      return { day, values };
    });
}

export type MentionRow = { prompt: string; engine: string; position: number; sentiment: number; at: string };

/** Chats where the tracked brand was mentioned, newest first. */
export function mentionRows(runs: Run[], you: string, filter: (c: Chat) => boolean): MentionRow[] {
  const out: MentionRow[] = [];
  for (const r of runs) {
    for (const c of r.chats) {
      if (!filter(c)) continue;
      const m = ownMention(c, you);
      if (m) out.push({ prompt: c.prompt, engine: c.engine, position: m.position, sentiment: m.sentiment, at: r.at });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.position - b.position);
}
