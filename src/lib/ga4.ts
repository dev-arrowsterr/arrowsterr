import "server-only";
import { aiSourceOf, AI_SOURCES } from "./aiSources";
import { activeNow, runReports, type ReportRequest, type ReportRow } from "./google";

// The Traffic data from Google Analytics 4, in the same shape the Umami route returns,
// so the Traffic page, Content Performance, Sources and client reports work with either.

type XY = { x: string; y: number };
const AI_DOMAINS = [...new Set(Object.values(AI_SOURCES).flat().flatMap((d) => [d, d.replace(/^www\./, "")]))];
const aiFilter = { filter: { fieldName: "sessionSource", inListFilter: { values: AI_DOMAINS, caseSensitive: false } } };

// Each breakdown on the Traffic page, as a GA4 dimension and metric. Umami-only lists stay empty.
const BREAKDOWNS: Record<string, [string, string] | null> = {
  pages: ["pagePath", "screenPageViews"],
  entry: ["landingPage", "sessions"],
  exit: null,
  titles: ["pageTitle", "screenPageViews"],
  referrers: ["sessionSource", "sessions"],
  channels: ["sessionDefaultChannelGroup", "sessions"],
  queries: null,
  countries: ["countryId", "totalUsers"],
  regions: ["region", "totalUsers"],
  cities: ["city", "totalUsers"],
  browsers: ["browser", "totalUsers"],
  os: ["operatingSystem", "totalUsers"],
  devices: ["deviceCategory", "totalUsers"],
  screens: ["screenResolution", "totalUsers"],
  languages: ["language", "totalUsers"],
  events: ["eventName", "eventCount"],
};

const n = (r: ReportRow, i: number) => Number(r.metricValues?.[i]?.value ?? 0);
const d = (r: ReportRow, i: number) => r.dimensionValues?.[i]?.value ?? "";
const ymd = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

export async function ga4Traffic(token: string, property: string, days: number) {
  const cur = { startDate: `${days - 1}daysAgo`, endDate: "today", name: "cur" };
  const prev = { startDate: `${days * 2 - 1}daysAgo`, endDate: `${days}daysAgo`, name: "prev" };
  const names = Object.keys(BREAKDOWNS).filter((k) => BREAKDOWNS[k]);
  const requests: ReportRequest[] = [
    // 0: totals now and before
    { dateRanges: [cur, prev], metrics: ["totalUsers", "sessions", "screenPageViews", "bounceRate", "averageSessionDuration"].map((name) => ({ name })) },
    // 1: visitors and pageviews per day
    { dateRanges: [cur], dimensions: [{ name: "date" }], metrics: [{ name: "totalUsers" }, { name: "screenPageViews" }], limit: 400 },
    // 2: visits from AI per day
    { dateRanges: [cur], dimensions: [{ name: "date" }, { name: "sessionSource" }], metrics: [{ name: "sessions" }], dimensionFilter: aiFilter, limit: 5000 },
    // 3: visits from AI, now and before
    { dateRanges: [cur, prev], dimensions: [{ name: "sessionSource" }], metrics: [{ name: "sessions" }], dimensionFilter: aiFilter, limit: 200 },
    // 4: pages people land on from AI
    { dateRanges: [cur], dimensions: [{ name: "landingPage" }, { name: "sessionSource" }], metrics: [{ name: "sessions" }], dimensionFilter: aiFilter, limit: 1000 },
    ...names.map((k) => {
      const [dim, met] = BREAKDOWNS[k]!;
      return { dateRanges: [cur], dimensions: [{ name: dim }], metrics: [{ name: met }], orderBys: [{ metric: { metricName: met }, desc: true }], limit: 100 };
    }),
  ];
  const [reports, now] = await Promise.all([runReports(token, property, requests), activeNow(token, property).catch(() => null)]);
  const [totalsRows, seriesRows, aiDays, aiSources, aiPages, ...lists] = reports;

  // With two date ranges, GA4 adds the range name as the last dimension.
  const totalsOf = (name: string) => {
    const r = totalsRows.find((x) => d(x, 0) === name);
    if (!r) return { visitors: 0, visits: 0, pageviews: 0, bounces: 0, totaltime: 0 };
    const visits = n(r, 1);
    return { visitors: n(r, 0), visits, pageviews: n(r, 2), bounces: Math.round(visits * n(r, 3)), totaltime: Math.round(visits * n(r, 4)) };
  };
  const t = totalsOf("cur");
  const tp = totalsOf("prev");

  const byEngine: Record<string, number> = Object.fromEntries(Object.keys(AI_SOURCES).map((k) => [k, 0]));
  const byEnginePrev: Record<string, number> = { ...byEngine };
  for (const r of aiSources) {
    const e = aiSourceOf(d(r, 0));
    if (!e) continue;
    if (d(r, 1) === "prev") byEnginePrev[e] += n(r, 0);
    else byEngine[e] += n(r, 0);
  }

  const daysMap = new Map<string, { day: string; visitors: number; pageviews: number; ai: Record<string, number> }>();
  const day = (k: string) => {
    const key = ymd(k);
    const row = daysMap.get(key) ?? { day: key, visitors: 0, pageviews: 0, ai: {} };
    daysMap.set(key, row);
    return row;
  };
  for (const r of seriesRows) Object.assign(day(d(r, 0)), { visitors: n(r, 0), pageviews: n(r, 1) });
  for (const r of aiDays) {
    const e = aiSourceOf(d(r, 1));
    if (e) day(d(r, 0)).ai[e] = (day(d(r, 0)).ai[e] ?? 0) + n(r, 0);
  }

  const pages = new Map<string, { path: string; visits: number; engines: Record<string, number> }>();
  for (const r of aiPages) {
    const e = aiSourceOf(d(r, 1));
    const path = d(r, 0).split("?")[0] || "/";
    if (!e || path === "(not set)") continue;
    const row = pages.get(path) ?? { path, visits: 0, engines: {} };
    row.visits += n(r, 0);
    row.engines[e] = (row.engines[e] ?? 0) + n(r, 0);
    pages.set(path, row);
  }

  const breakdowns: Record<string, XY[]> = Object.fromEntries(Object.keys(BREAKDOWNS).map((k) => [k, [] as XY[]]));
  names.forEach((k, i) => {
    breakdowns[k] = lists[i].map((r) => ({ x: d(r, 0), y: n(r, 0) })).filter((r) => r.x && r.x !== "(not set)" && r.x !== "(direct)");
  });

  return {
    days,
    source: "ga4" as const,
    totals: t,
    totalsPrev: tp,
    visits: t.visits || t.visitors,
    visitsPrev: tp.visits || tp.visitors,
    ai: Object.values(byEngine).reduce((a, b) => a + b, 0),
    aiPrev: Object.values(byEnginePrev).reduce((a, b) => a + b, 0),
    byEngine: Object.keys(AI_SOURCES).map((engine) => ({ engine, visits: byEngine[engine], prev: byEnginePrev[engine] })),
    series: [...daysMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
    pages: [...pages.values()].sort((a, b) => b.visits - a.visits).slice(0, 50),
    breakdowns,
    now,
  };
}
