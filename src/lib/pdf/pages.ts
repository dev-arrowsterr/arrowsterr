// What each page's PDF holds (docs/reports.md, section 32.3), built from the same functions the page uses, so a PDF
// and the screen show the same numbers for the same data. Pure: the server feeds it runs; tests feed it fixtures.
import type { Chat, Run } from "../chats.ts";
import type { DesignTokens } from "./design.ts";
import { answered, battle, brandStats, competitorDomains, domainRows, promptRows, rankOf, splitPeriods, topicGrid, topicRows, trend, typeShares, urlRows, type BrandStat, type Filter, type Metric } from "../metrics.ts";

export type PdfPage = "prompts" | "competitors" | "sources";
export const PDF_PAGES: { id: PdfPage; title: string }[] = [
  { id: "prompts", title: "AI Visibility by Prompt" },
  { id: "competitors", title: "Competitive Analysis in AI Answers" },
  { id: "sources", title: "Sources AI Cites" },
];
export const isPdfPage = (v: unknown): v is PdfPage => PDF_PAGES.some((p) => p.id === v);

/** The filters a PDF was made with. */
export type PdfParams = { days: number; topic: string | null; model: string | null };
export type Topic = { name: string; prompts: string[] };
export type PdfBrand = { name: string; domain: string; logo: string | null };

/** What every page gets: the runs in the period, the one before, and the filters. */
export type PdfView = { brand: PdfBrand; current: Run[]; previous: Run[]; filter: Filter; topics: Topic[]; engines: string[]; days: number };

/** Clean filters from a request. Days run 1 to 365, like the app's choices. */
export function cleanParams(x: unknown, maxDays = 365): PdfParams {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const days = Math.min(maxDays, 365, Math.max(1, Math.round(Number(o.days) || 30)));
  const text = (v: unknown) => (typeof v === "string" && v.trim() && v !== "All" ? v.trim().slice(0, 120) : null);
  return { days, topic: text(o.topic), model: text(o.model) };
}

/** The page's view from saved runs: the same split and filters as the app's top bar (App.tsx). */
export function viewOf(brand: PdfBrand, runs: Run[], allTopics: Topic[], planEngines: string[], p: PdfParams, now = Date.now()): PdfView {
  const topics = p.topic ? allTopics.filter((t) => t.name === p.topic) : allTopics;
  const inTopic = new Set(topics.flatMap((t) => t.prompts));
  const runEngines = [...new Set(runs.flatMap((r) => r.chats.map((c) => c.engine)))];
  const filter: Filter = (c: Chat) => (!p.model || c.engine === p.model) && (!p.topic || inTopic.has(c.prompt));
  const { current, previous } = splitPeriods(runs, p.days, now);
  return { brand, current, previous, filter, topics, engines: p.model ? [p.model] : [...new Set([...planEngines, ...runEngines])], days: p.days };
}

/** The page's score on the Prompts page: #1 is 100 and each spot down takes 10 off (PromptsPage.tsx). */
export const positionScore = (n: number | null) => (n === null ? null : Math.max(0, 110 - n * 10));

type Tile = { now: number | null; before: number | null; rank: number | null; of: number | null };
const tile = (now: BrandStat[], before: BrandStat[] | null, m: Metric, value: (s: BrandStat | undefined) => number | null): Tile => {
  const r = rankOf(now, m);
  return { now: value(now.find((s) => s.isYou)), before: before ? value(before.find((s) => s.isYou)) : null, rank: r?.rank ?? null, of: r?.of ?? null };
};

// ─────────────── Prompts → "AI Visibility by Prompt" ───────────────

export type PromptsPdf = {
  page: "prompts";
  answers: number;
  headline: string;
  scores: { visibility: Tile; sentiment: Tile; position: Tile & { spot: number | null } } | null;
  trend: { names: string[]; points: { label: string; values: Record<string, number | null> }[] };
  engines: string[];
  topics: { name: string; visibility: number | null; byEngine: Record<string, number | null>; prompts: { prompt: string; visibility: number | null; ranks: Record<string, number | null> }[] }[];
};

export function promptsPdf(v: PdfView): PromptsPdf {
  const you = { name: v.brand.name, domain: v.brand.domain };
  const chats = answered(v.current, v.filter);
  const prev = answered(v.previous, v.filter);
  const stats = brandStats(chats, you);
  const before = prev.length ? brandStats(prev, you) : null;
  const me = stats.find((s) => s.isYou);
  const meBefore = before?.find((s) => s.isYou);
  const change = before && me ? me.visibility - (meBefore?.visibility ?? 0) : null;
  const pct = (n: number) => `${Math.round(n)}%`;
  const headline = !me
    ? `No AI answers for ${v.brand.name} in the last ${v.days} days yet.`
    : change === null
      ? `${v.brand.name}'s visibility is ${pct(me.visibility)} in the last ${v.days} days.`
      : `${v.brand.name}'s visibility is ${Math.abs(change) < 0.5 ? "steady" : `${change > 0 ? "up" : "down"} ${Math.abs(change).toFixed(1)} points`} against the ${v.days} days before.`;
  const rivals = stats.filter((s) => !s.isYou).slice(0, 3).map((s) => s.name);
  const names = me ? [me.name, ...rivals] : rivals;
  const rows = promptRows(v.current, v.topics, v.engines, v.brand.name, v.filter, v.brand.domain);
  return {
    page: "prompts",
    answers: chats.length,
    headline,
    scores:
      chats.length && me
        ? {
            visibility: tile(stats, before, "visibility", (s) => s?.visibility ?? 0),
            sentiment: tile(stats, before, "sentiment", (s) => s?.sentiment ?? null),
            position: { ...tile(stats, before, "position", (s) => positionScore(s?.position ?? null)), spot: me.position },
          }
        : null,
    trend: { names, points: trend(v.current, names, "visibility", v.filter).map((p) => ({ label: p.label, values: p.values })) },
    engines: v.engines,
    topics: topicRows(chats, v.topics, v.engines, v.brand.name).map((t) => ({
      name: t.topic,
      visibility: t.visibility,
      byEngine: t.byEngine,
      prompts: rows
        .filter((r) => r.topic === t.topic)
        .map((r) => ({ prompt: r.prompt, visibility: r.visibility, ranks: Object.fromEntries(r.latest.map((c) => [c.engine, c.status === "named" ? c.position : null])) })),
    })),
  };
}

// ─────────────── Competitors → "Competitive Analysis in AI Answers" ───────────────

type BrandRow = { name: string; domain: string | null; isYou: boolean; visibility: number; visibilityBefore: number | null; position: number | null; positionBefore: number | null; sentiment: number | null; mentions: number };
export type CompetitorsPdf = {
  page: "competitors";
  answers: number;
  quadrant: { name: string; isYou: boolean; visibility: number; position: number }[];
  brands: BrandRow[];
  leaders: { names: string[]; rows: { topic: string; values: Record<string, number | null>; leader: string | null }[] };
  battle: {
    a: string;
    b: string;
    tiles: { label: string; a: number | null; b: number | null; lowerIsBetter?: boolean }[];
    trend: { label: string; values: Record<string, number | null> }[];
    byEngine: { key: string; a: number | null; b: number | null }[];
  } | null;
};

export function competitorsPdf(v: PdfView): CompetitorsPdf {
  const you = { name: v.brand.name, domain: v.brand.domain };
  const chats = answered(v.current, v.filter);
  const prev = answered(v.previous, v.filter);
  const stats = brandStats(chats, you);
  const before = prev.length ? brandStats(prev, you) : null;
  const was = (n: string) => before?.find((s) => s.name.toLowerCase() === n.toLowerCase());
  const me = stats.find((s) => s.isYou);
  const others = stats.filter((s) => !s.isYou);
  const top = [...(me ? [me] : []), ...others.slice(0, 19)];
  const rival = others[0];
  const leaderNames = [...(me ? [me.name] : []), ...others.slice(0, 5).map((s) => s.name)];
  const rankFor = (name: string) => rankOf(stats.map((s) => ({ ...s, isYou: s.name === name })), "visibility")?.rank ?? null;
  return {
    page: "competitors",
    answers: chats.length,
    quadrant: [...(me ? [me] : []), ...others.slice(0, 14)].filter((s): s is BrandStat & { position: number } => s.position !== null).map((s) => ({ name: s.name, isYou: s.isYou, visibility: s.visibility, position: s.position })),
    brands: top.map((s) => ({ name: s.name, domain: s.domain, isYou: s.isYou, visibility: s.visibility, visibilityBefore: before ? (was(s.name)?.visibility ?? 0) : null, position: s.position, positionBefore: was(s.name)?.position ?? null, sentiment: s.sentiment, mentions: s.mentions })),
    leaders: { names: leaderNames, rows: topicGrid(chats, v.topics, leaderNames) },
    battle:
      me && rival
        ? {
            a: me.name,
            b: rival.name,
            tiles: [
              { label: "Visibility", a: me.visibility, b: rival.visibility },
              { label: "Sentiment", a: me.sentiment, b: rival.sentiment },
              { label: "Position", a: me.position, b: rival.position, lowerIsBetter: true },
              { label: "Rank by visibility", a: rankFor(me.name), b: rankFor(rival.name), lowerIsBetter: true },
            ],
            trend: trend(v.current, [me.name, rival.name], "visibility", v.filter).map((p) => ({ label: p.label, values: p.values })),
            byEngine: battle(chats, me.name, rival.name, v.engines, v.topics).byEngine.map((r) => ({ key: r.key, a: r.a, b: r.b })),
          }
        : null,
  };
}

// ─────────────── Sources → "Sources AI Cites" ───────────────

export type SourcesPdf = {
  page: "sources";
  answers: number;
  shares: { owned: number; third: number; reviews: number };
  sites: { domain: string; type: string; used: number; chats: number }[];
  links: { url: string; title: string | null; domain: string; type: string; used: number; chats: number; prompts: number }[];
  owned: { url: string; title: string | null; used: number; chats: number; prompts: number }[];
};

export function sourcesPdf(v: PdfView): SourcesPdf {
  const chats = answered(v.current, v.filter);
  const stats = brandStats(chats, { name: v.brand.name, domain: v.brand.domain });
  const comp = competitorDomains(stats);
  const domains = domainRows(chats, v.brand.domain, comp);
  const urls = urlRows(chats, v.brand.domain, comp);
  const share = Object.fromEntries(typeShares(domains).map((s) => [s.type, s.share])) as Record<string, number>;
  const link = (u: (typeof urls)[number]) => ({ url: u.url, title: u.title, domain: u.domain, type: u.type, used: u.used, chats: u.chats, prompts: u.prompts.length });
  // The Sources page groups types the same way: your site, review sites, everything else (SourcesPage.tsx groupOf).
  const owned = share.You ?? 0;
  const reviews = share.Reviews ?? 0;
  return {
    page: "sources",
    answers: chats.length,
    shares: { owned, reviews, third: Object.entries(share).reduce((n, [t, x]) => (t === "You" || t === "Reviews" ? n : n + x), 0) },
    sites: domains.slice(0, 20).map((d) => ({ domain: d.domain, type: d.type, used: d.used, chats: d.chats })),
    links: urls.slice(0, 20).map(link),
    owned: urls.filter((u) => u.type === "You").slice(0, 20).map((u) => ({ url: u.url, title: u.title, used: u.used, chats: u.chats, prompts: u.prompts.length })),
  };
}

export type PdfData = PromptsPdf | CompetitorsPdf | SourcesPdf;

/** Build one page's PDF data. */
export function pdfData(page: PdfPage, v: PdfView): PdfData {
  return page === "prompts" ? promptsPdf(v) : page === "competitors" ? competitorsPdf(v) : sourcesPdf(v);
}

/** A stored PDF: everything the print page needs, frozen when the file was made. */
export type PdfSnapshot = {
  v: 1;
  title: string;
  brand: PdfBrand;
  period: string; // "Last 30 days · Sep 17, 2026 – Oct 16, 2026"
  filters: string[]; // "Topic: CRM software", "Model: ChatGPT"
  at: string;
  tokens: DesignTokens;
  data: PdfData;
};
