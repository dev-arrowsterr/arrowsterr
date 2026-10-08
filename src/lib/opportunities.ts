// Search Console opportunities. Pure functions, shared by the browser and tests.

export type GscTotals = { clicks: number; impressions: number; ctr: number; position: number };
export type GscQuery = { query: string; clicks: number; impressions: number; ctr: number; position: number };
export type GscPage = { page: string; clicks: number; impressions: number; ctr: number; position: number; prevClicks: number; prevPosition: number | null };
export type GscPair = { page: string; query: string; clicks: number; impressions: number; ctr: number; position: number };
export type GscReport = {
  days: number;
  property: string;
  totals: GscTotals;
  totalsPrev: GscTotals;
  series: { date: string; clicks: number; impressions: number }[];
  queries: GscQuery[];
  pages: GscPage[];
  pairs: GscPair[];
};

export type OpportunityKind = "Close to top 3" | "Low click rate" | "Losing clicks" | "Pages competing";
export type Opportunity = {
  id: string;
  kind: OpportunityKind;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  gain: number; // extra clicks a month if fixed, roughly
  note: string;
};

/** Typical click rate on Google by position, 1 to 10. */
export function expectedCtr(position: number) {
  const curve = [0.28, 0.16, 0.11, 0.08, 0.06, 0.05, 0.04, 0.03, 0.025, 0.02];
  const p = Math.max(1, Math.round(position));
  return p <= 10 ? curve[p - 1] : 0.01;
}
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";

export function opportunities(r: GscReport): Opportunity[] {
  const month = 30 / r.days;
  const minImp = Math.max(10, Math.round(r.days / 2));
  const out: Opportunity[] = [];

  // Best page for each query, and every page that shows for it.
  const byQuery = new Map<string, GscPair[]>();
  for (const p of r.pairs) byQuery.set(p.query, [...(byQuery.get(p.query) ?? []), p]);

  for (const [query, list] of byQuery) {
    const total = list.reduce((n, p) => n + p.impressions, 0);
    const best = [...list].sort((a, b) => b.impressions - a.impressions)[0];

    if (best.position >= 4 && best.position <= 20 && best.impressions >= minImp) {
      const gain = Math.max(0, Math.round(best.impressions * (expectedCtr(3) - best.ctr) * month));
      out.push({
        id: `close:${query}`,
        kind: "Close to top 3",
        ...best,
        gain,
        note: `Ranks #${best.position.toFixed(1)}. Reaching the top 3 could bring about ${gain} more clicks a month. Update the page with this query in mind.`,
      });
    }
    if (best.position < 5.5 && best.impressions >= 50 && best.ctr < expectedCtr(best.position) * 0.5) {
      const gain = Math.round(best.impressions * (expectedCtr(best.position) - best.ctr) * month);
      out.push({
        id: `ctr:${query}`,
        kind: "Low click rate",
        ...best,
        gain,
        note: `Click rate ${pct(best.ctr)} where #${Math.round(best.position)} usually gets about ${pct(expectedCtr(best.position))}. Rewrite the title and meta description.`,
      });
    }
    const big = list.filter((p) => p.impressions >= total * 0.15);
    if (big.length >= 2 && total >= 30) {
      const [, second] = [...big].sort((a, b) => b.impressions - a.impressions);
      out.push({
        id: `split:${query}`,
        kind: "Pages competing",
        ...second,
        impressions: total,
        gain: 0,
        note: `${big.length} pages show for this search: ${big.map((p) => path(p.page)).join(", ")}. Merge them or point one at a different keyword.`,
      });
    }
  }

  for (const p of r.pages) {
    if (p.prevClicks >= 10 && p.clicks < p.prevClicks * 0.7) {
      const top = r.pairs.filter((x) => x.page === p.page).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)[0];
      out.push({
        id: `drop:${p.page}`,
        kind: "Losing clicks",
        query: top?.query ?? "",
        page: p.page,
        clicks: p.clicks,
        impressions: p.impressions,
        ctr: p.ctr,
        position: p.position,
        gain: Math.round((p.prevClicks - p.clicks) * month),
        note: `Clicks fell from ${p.prevClicks} to ${p.clicks}${p.prevPosition ? `, position from #${p.prevPosition.toFixed(1)} to #${p.position.toFixed(1)}` : ""}. Refresh the page.`,
      });
    }
  }
  return out.sort((a, b) => b.gain - a.gain || b.impressions - a.impressions);
}
