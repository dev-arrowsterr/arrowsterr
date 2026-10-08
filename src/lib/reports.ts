// Reports: one place that pulls every section together. Pure functions, shared by the browser and tests.
import type { GscReport } from "./opportunities.ts";

/** The parts of the Traffic data reports use. */
export type TrafficData = {
  totals: { visitors: number; visits: number; pageviews: number };
  totalsPrev: { visitors: number; visits: number; pageviews: number };
  ai: number;
  aiPrev: number;
  byEngine: { engine: string; visits: number; prev: number }[];
  pages: { path: string; visits: number }[];
  breakdowns: Record<string, { x: string; y: number }[]>;
};
export type Change = { text: string; change: number; unit: string; area: "AI visibility" | "AI traffic" | "Google" };

export const pathOf = (u: string) => {
  try {
    return (new URL(u).pathname.replace(/\/+$/, "") || "/").toLowerCase();
  } catch {
    return (u.split("?")[0].replace(/\/+$/, "") || "/").toLowerCase();
  }
};

/** The biggest moves up and down this period, across AI answers, AI visits and Google. */
export function winsAndDrops(input: {
  engines: { engine: string; now: number | null; before: number | null }[];
  traffic: TrafficData | null;
  gsc: GscReport | null;
}): { wins: Change[]; drops: Change[] } {
  const all: Change[] = [];
  for (const e of input.engines) {
    if (e.now === null || e.before === null) continue;
    const d = Math.round(e.now - e.before);
    if (Math.abs(d) >= 3) all.push({ text: `Visibility on ${e.engine}`, change: d, unit: " pts", area: "AI visibility" });
  }
  for (const e of input.traffic?.byEngine ?? []) {
    const d = e.visits - e.prev;
    if (Math.abs(d) >= 3) all.push({ text: `Visits from ${e.engine}`, change: d, unit: "", area: "AI traffic" });
  }
  for (const p of input.gsc?.pages ?? []) {
    const d = p.clicks - p.prevClicks;
    if (Math.abs(d) >= 5) all.push({ text: `Google clicks to ${pathOf(p.page)}`, change: d, unit: "", area: "Google" });
  }
  // Rank by size relative to its kind, so a 10 point visibility jump can beat 12 extra clicks.
  const weight = (c: Change) => Math.abs(c.change) * (c.area === "AI visibility" ? 3 : 1);
  return {
    wins: all.filter((c) => c.change > 0).sort((a, b) => weight(b) - weight(a)).slice(0, 3),
    drops: all.filter((c) => c.change < 0).sort((a, b) => weight(b) - weight(a)).slice(0, 3),
  };
}

export type ContentRow = {
  id: string;
  keyword: string;
  url: string;
  path: string;
  published: string | null;
  action: "new" | "update";
  position: number | null;
  clicks: number | null;
  impressions: number | null;
  cited: number | null;
  visits: number | null;
  aiVisits: number | null;
  landed: number | null;
  hot: number | null;
};

/** One row per published page: Google, AI citations, visits and visitors who landed there. */
export function contentRows(input: {
  items: { id: string; keyword: string; url: string | null; current_url: string | null; due_date: string | null; action: "new" | "update"; status: string }[];
  gsc: GscReport | null;
  citedPaths: Map<string, number> | null; // path → share of AI answers citing it, 0 to 100
  traffic: TrafficData | null;
  visitors: { entry: string | null; label: string }[] | null;
}): ContentRow[] {
  return input.items
    .filter((i) => i.status === "published" && (i.url || i.current_url))
    .map((i) => {
      const url = (i.url || i.current_url)!;
      const path = pathOf(url);
      const page = input.gsc?.pages.find((p) => pathOf(p.page) === path);
      const pair = input.gsc?.pairs.filter((p) => pathOf(p.page) === path && p.query.toLowerCase() === i.keyword.toLowerCase())[0];
      const landed = input.visitors?.filter((v) => v.entry && pathOf(v.entry) === path);
      const visits = input.traffic?.breakdowns.pages?.find((r) => pathOf(r.x) === path)?.y;
      const ai = input.traffic?.pages.filter((p) => pathOf(p.path) === path).reduce((n, p) => n + p.visits, 0);
      return {
        id: i.id,
        keyword: i.keyword,
        url,
        path,
        published: i.due_date,
        action: i.action,
        position: pair ? Math.round(pair.position * 10) / 10 : null,
        clicks: input.gsc ? (page?.clicks ?? 0) : null,
        impressions: input.gsc ? (page?.impressions ?? 0) : null,
        cited: input.citedPaths ? (input.citedPaths.get(path) ?? 0) : null,
        visits: input.traffic ? (visits ?? 0) : null,
        aiVisits: input.traffic ? (ai ?? 0) : null,
        landed: landed ? landed.length : null,
        hot: landed ? landed.filter((v) => v.label === "Hot").length : null,
      };
    });
}
