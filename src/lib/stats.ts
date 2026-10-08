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

/** Visibility per brand for each run, oldest first. */
export function timeline(runs: Run[], names: string[], filter: (c: Chat) => boolean): DayPoint[] {
  const byDay = new Map<string, Chat[]>();
  for (const r of runs) {
    const day = r.at; // one point per run
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

export type MentionRow = {
  prompt: string;
  engine: string;
  position: number;
  sentiment: number;
  at: string;
  sources: { url: string; domain: string; title: string | null }[];
};

/** Chats where the tracked brand was mentioned, newest first. */
export function mentionRows(runs: Run[], you: string, filter: (c: Chat) => boolean): MentionRow[] {
  const out: MentionRow[] = [];
  for (const r of runs) {
    for (const c of r.chats) {
      if (!filter(c)) continue;
      const m = ownMention(c, you);
      if (m) out.push({ prompt: c.prompt, engine: c.engine, position: m.position, sentiment: m.sentiment, at: r.at, sources: c.sources });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.position - b.position);
}

export type SentimentRow = {
  name: string;
  score: number; // average sentiment, 0 to 100
  positive: number; // % of mentions scored 60 or more
  neutral: number; // % scored 40 to 59
  negative: number; // % scored under 40
  mentions: number;
};

function sentimentOf(name: string, scores: number[]): SentimentRow {
  const n = scores.length;
  const share = (f: (s: number) => boolean) => (n ? (scores.filter(f).length / n) * 100 : 0);
  return {
    name,
    mentions: n,
    score: avg(scores),
    positive: share((s) => s >= 60),
    neutral: share((s) => s >= 40 && s < 60),
    negative: share((s) => s < 40),
  };
}

const scoresFor = (chats: Chat[], match: (name: string) => boolean) =>
  chats.filter(isAnswered).flatMap((c) => c.brands.filter((b) => match(b.name.toLowerCase())).map((b) => b.sentiment));

/** Sentiment for each named brand. */
export function sentimentRows(chats: Chat[], names: string[]): SentimentRow[] {
  return names.map((n) => sentimentOf(n, scoresFor(chats, (b) => b === n.toLowerCase())));
}

/** Sentiment across every brand mention except yours: the market benchmark. */
export function marketSentiment(chats: Chat[], you: string, label = "Market benchmark"): SentimentRow {
  return sentimentOf(label, scoresFor(chats, (b) => b !== you.toLowerCase()));
}

export type CompetitorCard = {
  name: string;
  domain: string | null;
  isYou: boolean;
  prompts: number; // prompts that named this brand at least once
  position: number; // average position when mentioned
  mentions: number;
  byEngine: Record<string, number | null>; // % of that engine's answers, null when the engine had no answers
  before: Record<string, number | null>; // the same numbers from the run before, for change arrows
};

const ownsDomain = (sourceDomain: string, domain: string) => sourceDomain === domain || sourceDomain.endsWith(`.${domain}`);

/**
 * One card per brand from the latest run: how often each engine mentioned it, or cited its website.
 * `mode` "mentions" counts answers that name the brand. "citations" counts answers that link to its domain.
 */
export function competitorCards(latest: Run, previous: Run | null, you: { name: string; domain: string }, mode: "mentions" | "citations", limit = 12): CompetitorCard[] {
  const rows = brandRows(latest.chats, you.name);
  // Your brand always shows first, even when no answer named it.
  if (!rows.some((r) => r.isYou)) rows.push({ name: you.name, domain: you.domain, visibility: 0, position: 0, sentiment: 0, mentions: 0, isYou: true });
  const top = rows.sort((a, b) => Number(b.isYou) - Number(a.isYou) || b.mentions - a.mentions).slice(0, limit);

  const share = (run: Run, row: BrandRow, engine: string): number | null => {
    const answered = run.chats.filter((c) => c.engine === engine && isAnswered(c));
    if (!answered.length) return null;
    const domain = row.isYou ? you.domain : row.domain;
    const hit = (c: Chat) =>
      mode === "mentions"
        ? c.brands.some((b) => b.name.toLowerCase() === row.name.toLowerCase())
        : Boolean(domain) && c.sources.some((s) => ownsDomain(s.domain, domain!));
    return (answered.filter(hit).length / answered.length) * 100;
  };

  return top.map((row) => ({
    name: row.name,
    domain: row.isYou ? you.domain : row.domain,
    isYou: row.isYou,
    mentions: row.mentions,
    position: row.position,
    prompts: new Set(latest.chats.filter((c) => c.brands.some((b) => b.name.toLowerCase() === row.name.toLowerCase())).map((c) => c.prompt)).size,
    byEngine: Object.fromEntries(latest.engines.map((e) => [e, share(latest, row, e)])),
    before: Object.fromEntries(latest.engines.map((e) => [e, previous ? share(previous, row, e) : null])),
  }));
}
