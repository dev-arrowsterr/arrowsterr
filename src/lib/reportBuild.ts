import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Run } from "./chats";
import { listCalendar, type CalendarItem } from "./db";
import { answered, brandStats } from "./metrics";
import { addDays, dayStart, resolveRange, type ReportRange, type Resolved } from "./reportRange";
import type { ReportDocument } from "./reportDoc";
import { citedPathsOf, contentRows, winsAndDrops, type TrafficData } from "./reports";
import type { ReportSnapshot, ReportStyle, ReportSection } from "./reportTypes";
import { cleanSources } from "./sources";
import { brandTraffic, brandVisitors, type Span } from "./traffic";

// Builds a client report on the server for any date range (docs/reports.md, sections 9 and 12).
// The editor's preview, live links and PDFs all come from here, so they always show the same numbers.

export type BuildInput = {
  db: SupabaseClient; // the caller's client in the app; the service client for links and PDFs
  brandId: string;
  range: ReportRange;
  doc: ReportDocument;
  style: ReportStyle;
  tz: string | null;
  historyDays: number;
  whiteLabel: boolean; // the plan allows hiding "Made with Arrowsterr"
};

const all = () => true;
const sectionsOf = (doc: ReportDocument): ReportSection[] => {
  const on = new Set(doc.blocks.filter((b) => b.on).map((b) => b.id));
  return [...(on.has("kpis") || on.has("models") ? (["ai"] as const) : []), ...(["competitors", "traffic", "visitors", "content"] as const).filter((s) => on.has(s))];
};

function spanOf(start: string, end: string, tz: string | null): Span {
  return { start, end, startAt: Date.parse(dayStart(start, tz)), endAt: Date.parse(dayStart(addDays(end, 1), tz)) };
}

/** Saved runs for a brand between two moments, oldest first, with tidy sources. */
async function runsBetween(db: SupabaseClient, brandId: string, from: number, to: number): Promise<Run[]> {
  const { data, error } = await db
    .from("runs")
    .select("at, engines, chats")
    .eq("brand_id", brandId)
    .gte("at", new Date(from).toISOString())
    .lt("at", new Date(to).toISOString())
    .order("at");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Run[]).map((r) => ({ ...r, chats: (r.chats ?? []).map((c) => ({ ...c, sources: cleanSources(c.sources ?? []) })) }));
}

async function calendarFor(db: SupabaseClient, brand: { id: string; workspace_id: string; domain: string }): Promise<CalendarItem[] | null> {
  const { data } = await db.from("sites").select("id, brand_id").eq("workspace_id", brand.workspace_id).or(`brand_id.eq.${brand.id},domain.eq."${brand.domain}"`);
  const site = ((data ?? []) as { id: string; brand_id: string | null }[]).sort((a, b) => Number(b.brand_id === brand.id) - Number(a.brand_id === brand.id))[0];
  return site ? listCalendar(db, site.id).catch(() => null) : null;
}

export type Built = { snapshot: ReportSnapshot; range: Resolved };

export async function buildClientReport(input: BuildInput): Promise<Built> {
  const { db, doc, tz } = input;
  const { data: b, error } = await db.from("brands").select("id, workspace_id, name, domain, logo").eq("id", input.brandId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!b) throw new Error("This report's brand was deleted.");
  const brand = b as { id: string; workspace_id: string; name: string; domain: string; logo: string | null };
  const range = resolveRange(input.range, { tz, historyDays: input.historyDays });
  const cur = spanOf(range.start, range.end, tz);
  const prev = range.prevStart && range.prevEnd ? spanOf(range.prevStart, range.prevEnd, tz) : null;
  const on = new Set(doc.blocks.filter((x) => x.on).map((x) => x.id));
  const wantWebsite = on.has("traffic") || on.has("visitors") || on.has("content") || on.has("wins");

  const soft = <T>(p: Promise<T>): Promise<T | null> => p.catch((e) => (console.error("Report data:", e instanceof Error ? e.message : e), null));
  // A comparison a year back needs a second, separate read; a previous period sits right before.
  const [runs, prevRuns, traffic, visitors, items] = await Promise.all([
    runsBetween(db, brand.id, prev && prev.endAt === cur.startAt ? prev.startAt : cur.startAt, cur.endAt),
    prev && prev.endAt !== cur.startAt ? runsBetween(db, brand.id, prev.startAt, prev.endAt) : Promise.resolve([] as Run[]),
    wantWebsite ? soft(brandTraffic(db, brand.id, cur, prev)) : Promise.resolve(null),
    on.has("visitors") || on.has("content") ? soft(brandVisitors(db, brand.id, cur)) : Promise.resolve(null),
    on.has("content") ? soft(calendarFor(db, brand)) : Promise.resolve(null),
  ]);
  const t = Date.parse;
  const current = runs.filter((r) => t(r.at) >= cur.startAt);
  const previous = prev ? [...prevRuns, ...runs].filter((r) => t(r.at) >= prev.startAt && t(r.at) < prev.endAt) : [];

  const you = { name: brand.name, domain: brand.domain };
  const chats = answered(current, all);
  const before = answered(previous, all);
  const stats = brandStats(chats, you);
  const me = stats.find((s) => s.isYou);
  const was = before.length ? brandStats(before, you).find((s) => s.isYou) : null;
  const ranked = [...stats].sort((a, b) => b.visibility - a.visibility);
  const engines = [...new Set([...current, ...previous].flatMap((r) => r.chats.map((c) => c.engine)))];
  const byModel = engines
    .map((e) => ({
      engine: e,
      now: chats.some((c) => c.engine === e) ? (brandStats(chats.filter((c) => c.engine === e), you).find((s) => s.isYou)?.visibility ?? 0) : null,
      before: before.some((c) => c.engine === e) ? (brandStats(before.filter((c) => c.engine === e), you).find((s) => s.isYou)?.visibility ?? 0) : null,
    }))
    .filter((m) => m.now !== null);
  const tr = traffic as (TrafficData & { visits?: number }) | null;
  const { wins, drops } = winsAndDrops({ engines: byModel, traffic: tr });
  const list = items ?? [];
  const inRange = (d: string | null) => Boolean(d) && d! >= range.start && d! <= range.end;

  const snapshot: ReportSnapshot = {
    brand: { name: brand.name, domain: brand.domain, logo: brand.logo ?? "" },
    style: { ...input.style, whiteLabel: input.whiteLabel && Boolean(input.style.whiteLabel) },
    days: range.days,
    at: new Date().toISOString(),
    sections: sectionsOf(doc),
    blocks: doc.blocks,
    period: { label: range.label, start: range.start, end: range.end, compareLabel: range.compareLabel },
    connected: { website: Boolean(traffic), content: Boolean(items) },
    // A summary is only shown for the dates it was written about, so its numbers always match the page.
    summary: doc.summary && doc.summary.key === range.key ? { headline: doc.summary.headline, points: doc.summary.points, next: doc.summary.next } : null,
    ai: me
      ? {
          visibility: me.visibility,
          visibilityBefore: was ? was.visibility : null,
          sentiment: me.sentiment,
          position: me.position,
          rank: ranked.findIndex((s) => s.isYou) + 1,
          brands: stats.length,
          answers: chats.length,
          byModel,
        }
      : null,
    competitors: chats.length ? ranked.slice(0, 10).map((s) => ({ name: s.name, domain: s.domain ?? null, visibility: s.visibility, sentiment: s.sentiment, position: s.position, isYou: s.isYou })) : null,
    traffic: tr ? { visits: tr.totals.visits, visitsBefore: prev ? tr.totalsPrev.visits : null, ai: tr.ai, aiBefore: prev ? tr.aiPrev : null, byEngine: tr.byEngine.map((e) => ({ ...e, prev: prev ? e.prev : null })) } : null,
    visitors: visitors
      ? {
          total: visitors.length,
          hot: visitors.filter((x) => x.label === "Hot").length,
          actions: visitors.filter((x) => x.actions.length).length,
          top: [...visitors]
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map((x) => ({ name: x.name, emoji: x.emoji, score: x.score, label: x.label, source: x.source })),
        }
      : null,
    content: items
      ? {
          published: list.filter((i) => i.status === "published" && inRange(i.due_date)).length,
          writing: list.filter((i) => i.status === "writing").length,
          briefs: list.filter((i) => i.status === "brief").length,
          planned: list.filter((i) => i.status === "planned").length,
          pages: contentRows({ items: list, citedPaths: chats.length ? citedPathsOf(chats, brand.domain) : null, traffic: tr, visitors }),
        }
      : null,
    wins: prev ? wins : [],
    drops: prev ? drops : [],
  };
  return { snapshot, range };
}

/** The numbers the AI summary may use: the snapshot without styling, and at most 10 content rows. */
export function summaryInput(s: ReportSnapshot) {
  return { ...s, style: undefined, brand: undefined, blocks: undefined, connected: undefined, content: s.content ? { ...s.content, pages: s.content.pages.slice(0, 10) } : null };
}
