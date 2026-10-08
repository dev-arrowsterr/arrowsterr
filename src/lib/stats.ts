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

export type GooglePromptRow = {
  prompt: string;
  aioShown: boolean | null; // null when this run has no AI Overview answer for the prompt
  aioMentioned: boolean;
  aioCited: boolean;
  modeMentioned: boolean | null; // null when AI Mode was not checked
  modeCited: boolean;
  rank: number | null; // your best spot in Google's top 20, null when not in it
  topSources: string[]; // domains the AI Overview cited most
};

export type GoogleSummary = {
  prompts: number;
  aioShownRate: number | null; // % of searches where Google showed an AI Overview
  aioMentionRate: number | null; // % of shown AI Overviews that name you
  aioCitedRate: number | null; // % of shown AI Overviews that link to your site
  modeMentionRate: number | null;
  modeCitedRate: number | null;
  avgRank: number | null; // average Google rank where you rank in the top 20
  top10Rate: number | null; // % of searches where you are in Google's top 10
  rows: GooglePromptRow[];
  topDomains: { domain: string; count: number }[]; // sites cited most across AI Overviews
};

/** Google numbers from one run: AI Overview, AI Mode and regular rankings, per prompt and overall. */
export function googleSummary(run: Run, you: { name: string; domain: string }): GoogleSummary {
  const yours = (d: string) => d === you.domain || d.endsWith(`.${you.domain}`);
  const named = (c: Chat) => c.brands.some((b) => b.name.toLowerCase() === you.name.toLowerCase());
  const cites = (c: Chat) => c.sources.some((s) => yours(s.domain));
  const prompts = [...new Set(run.chats.map((c) => c.prompt))];
  const find = (engine: string, prompt: string) => run.chats.find((c) => c.engine === engine && c.prompt === prompt && isAnswered(c));

  const rows: GooglePromptRow[] = prompts.map((prompt) => {
    const aio = find("AI Overview", prompt);
    const mode = find("AI Mode", prompt);
    const ranks = (aio?.organic ?? []).filter((o) => yours(o.domain)).map((o) => o.rank);
    const shown = aio ? (aio.shown ?? (aio.brands.length > 0 || aio.sources.length > 0)) : null;
    return {
      prompt,
      aioShown: shown,
      aioMentioned: Boolean(aio && named(aio)),
      aioCited: Boolean(aio && cites(aio)),
      modeMentioned: mode ? named(mode) : null,
      modeCited: Boolean(mode && cites(mode)),
      rank: ranks.length ? Math.min(...ranks) : null,
      topSources: [...new Set((aio?.sources ?? []).map((s) => s.domain))].slice(0, 4),
    };
  });

  const rate = (list: boolean[]) => (list.length ? (list.filter(Boolean).length / list.length) * 100 : null);
  const withAio = rows.filter((r) => r.aioShown !== null);
  const shownRows = withAio.filter((r) => r.aioShown);
  const withMode = rows.filter((r) => r.modeMentioned !== null);
  const checkedRank = run.chats.some((c) => c.engine === "AI Overview" && c.organic);
  const ranked = rows.filter((r) => r.rank !== null).map((r) => r.rank!);

  const domains = new Map<string, number>();
  for (const c of run.chats) if (c.engine === "AI Overview") for (const d of new Set(c.sources.map((s) => s.domain))) domains.set(d, (domains.get(d) ?? 0) + 1);

  return {
    prompts: prompts.length,
    aioShownRate: rate(withAio.map((r) => Boolean(r.aioShown))),
    aioMentionRate: rate(shownRows.map((r) => r.aioMentioned)),
    aioCitedRate: rate(shownRows.map((r) => r.aioCited)),
    modeMentionRate: rate(withMode.map((r) => Boolean(r.modeMentioned))),
    modeCitedRate: rate(withMode.map((r) => r.modeCited)),
    avgRank: ranked.length ? avg(ranked) : null,
    top10Rate: checkedRank ? rate(withAio.map((r) => r.rank !== null && r.rank <= 10)) : null,
    rows,
    topDomains: [...domains.entries()].map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count).slice(0, 10),
  };
}
