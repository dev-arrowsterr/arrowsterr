// Content Intelligence: how each page on a site performs, shared by the page and its report.
import { pathOf, type TrafficData } from "./reports.ts";
import type { IntelSnapshot } from "./reportTypes.ts";
import type { PagePerf } from "./research.ts";

/** How a page is doing, from best to worst. */
export type Tag = "Top performer" | "Striking distance" | "Steady" | "Underperforming" | "No traction";
export const TAGS: Tag[] = ["Top performer", "Striking distance", "Steady", "Underperforming", "No traction"];
export const TAG_HELP: Record<Tag, string> = {
  "Top performer": "Among your top fifth for visits, with a keyword in Google's top 3.",
  "Striking distance": "Its best keyword sits at #4 to #20 with real search volume. A content update can push it up.",
  Steady: "Gets visits and holds its spots. Keep it fresh.",
  Underperforming: "Ranks for keywords, but none in the top 10.",
  "No traction": "No visits and no keywords on Google.",
};
// One hue, darker for better pages, since the tags run in order.
export const TAG_COLOR: Record<Tag, string> = {
  "Top performer": "#0943B0",
  "Striking distance": "#3B6AD0",
  Steady: "#7E9BDD",
  Underperforming: "#B9C8EC",
  "No traction": "#DDE4F5",
};

export type IntelRow = {
  path: string;
  url: string;
  seo: PagePerf | null;
  views: number | null; // from Google Analytics or the tracking script
  ai: number | null; // visits from AI assistants
  cited: number | null; // share of AI answers that cite it
  tag: Tag;
};

type Base = Omit<IntelRow, "tag">;
export const visitsOf = (r: Base) => r.views ?? r.seo?.traffic ?? 0;

function tagOf(r: Base, topCut: number): Tag {
  const visits = visitsOf(r);
  const s = r.seo;
  if (visits > 0 && visits >= topCut && (s?.top3 ?? 0) > 0) return "Top performer";
  if (s?.topRank && s.topRank >= 4 && s.topRank <= 20 && (s.topVolume ?? 0) >= 50) return "Striking distance";
  if (visits > 0 && (!s || s.top10 > 0)) return "Steady";
  if (s && s.keywords > 0) return "Underperforming";
  return visits > 0 ? "Steady" : "No traction";
}

/** One row per page: Google's list first, then pages that only show up in analytics. */
export function intelRows(input: { pages: PagePerf[] | null; traffic: TrafficData | null; cited: Map<string, number> | null; domain: string }): IntelRow[] {
  const { pages, traffic: t, cited, domain } = input;
  const base = new Map<string, Base>();
  for (const p of pages ?? [])
    base.set(pathOf(p.url), {
      path: pathOf(p.url),
      url: p.url,
      seo: p,
      views: null,
      ai: null,
      cited: null,
    });
  for (const r of t?.breakdowns.pages ?? []) {
    const path = pathOf(r.x);
    if (!base.has(path))
      base.set(path, {
        path,
        url: `https://${domain}${path === "/" ? "" : path}`,
        seo: null,
        views: null,
        ai: null,
        cited: null,
      });
  }
  for (const r of base.values()) {
    r.views = t ? (t.breakdowns.pages ?? []).filter((x) => pathOf(x.x) === r.path).reduce((n, x) => n + x.y, 0) : null;
    r.ai = t ? t.pages.filter((x) => pathOf(x.path) === r.path).reduce((n, x) => n + x.visits, 0) : null;
    r.cited = cited ? (cited.get(r.path) ?? 0) : null;
  }
  const list = [...base.values()];
  const sorted = list.map(visitsOf).sort((a, b) => b - a);
  const topCut = sorted[Math.max(0, Math.ceil(sorted.length / 5) - 1)] ?? 0;
  return list.map((r) => ({ ...r, tag: tagOf(r, topCut) }));
}

/** Freeze the rows into a report. */
export function intelSnapshot(
  rows: IntelRow[],
  meta: {
    brand: IntelSnapshot["brand"];
    days: number;
    linked: boolean;
    sample?: boolean;
  },
): IntelSnapshot {
  const sorted = [...rows].sort((a, b) => visitsOf(b) - visitsOf(a));
  const seo = rows.map((r) => r.seo).filter((s): s is PagePerf => Boolean(s));
  const anyCited = rows.some((r) => r.cited !== null);
  return {
    kind: "intel",
    brand: meta.brand,
    days: meta.days,
    at: new Date().toISOString(),
    sample: Boolean(meta.sample),
    linked: meta.linked,
    totals: {
      pages: rows.length,
      visits: rows.reduce((n, r) => n + visitsOf(r), 0),
      cited: anyCited ? rows.filter((r) => (r.cited ?? 0) > 0).length : null,
    },
    byTag: TAGS.map((tag) => ({
      tag,
      pages: rows.filter((r) => r.tag === tag).length,
    })),
    keywords: seo.reduce(
      (a, p) => ({
        top3: a.top3 + p.top3,
        top10: a.top10 + p.top10,
        all: a.all + p.keywords,
      }),
      { top3: 0, top10: 0, all: 0 },
    ),
    rows: sorted.slice(0, 40).map((r) => ({
      path: r.path,
      url: r.url,
      tag: r.tag,
      visits: visitsOf(r),
      ai: r.ai,
      cited: r.cited,
      keyword: r.seo?.topKeyword ?? null,
      rank: r.seo?.topRank ?? null,
      volume: r.seo?.topVolume ?? null,
    })),
  };
}

/** Example pages for a site, so the report shows what it will look like before real data loads. */
export function sampleIntel(domain: string): PagePerf[] {
  const page = (path: string, traffic: number, keywords: number, top3: number, top10: number, topKeyword: string, topRank: number, topVolume: number): PagePerf => ({
    url: `https://${domain}${path}`,
    traffic,
    keywords,
    top3,
    top10,
    topKeyword,
    topRank,
    topVolume,
  });
  return [
    page("/", 4200, 310, 24, 61, "brand name", 1, 2900),
    page("/pricing", 1850, 88, 9, 22, "pricing software", 2, 1300),
    page("/blog/how-to-choose", 1240, 142, 6, 31, "how to choose software", 5, 2400),
    page("/compare/alternatives", 960, 64, 2, 14, "best alternatives", 7, 1900),
    page("/features", 720, 51, 4, 12, "features list", 3, 480),
    page("/blog/beginners-guide", 510, 97, 0, 8, "beginners guide", 11, 3600),
    page("/use-cases/agencies", 340, 29, 1, 6, "tool for agencies", 6, 720),
    page("/blog/checklist", 210, 44, 0, 3, "checklist template", 14, 1100),
    page("/integrations", 120, 18, 0, 0, "integrations", 24, 260),
    page("/blog/old-announcement", 30, 6, 0, 0, "company news", 41, 90),
    page("/careers", 0, 0, 0, 0, "", 0, 0),
  ].map((p) => (p.keywords ? p : { ...p, topKeyword: null, topRank: null, topVolume: null }));
}

/** Example AI citations for the sample pages: path → share of AI answers that cite it. */
export const SAMPLE_CITED = new Map<string, number>([
  ["/", 18],
  ["/pricing", 9],
  ["/blog/how-to-choose", 22],
  ["/compare/alternatives", 14],
  ["/blog/beginners-guide", 4],
]);
