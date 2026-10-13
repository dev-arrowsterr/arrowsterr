// AI visibility math from daily_metrics rows, shared by alerts, webhooks and the weekly email. No server imports, so tests can load it.

export type Metric = { day: string; engine: string; named: string; is_you: boolean; answers: number; mentions: number };

/** Visibility by brand name for one day, counting only the given AIs. */
export function shares(rows: Metric[], engines: Set<string>) {
  const answers = rows.filter((r) => r.named === "" && engines.has(r.engine)).reduce((n, r) => n + r.answers, 0);
  const by = new Map<string, { name: string; you: boolean; mentions: number }>();
  for (const r of rows) {
    if (!r.named || !engines.has(r.engine)) continue;
    const k = r.named.toLowerCase();
    const x = by.get(k) ?? { name: r.named, you: r.is_you, mentions: 0 };
    x.mentions += r.mentions;
    by.set(k, x);
  }
  return [...by.values()].map((x) => ({ ...x, visibility: answers ? Math.round((x.mentions / answers) * 1000) / 10 : 0 }));
}

const DAY = 864e5;
export const pts = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n * 10) / 10} pts`;

/** One brand's week: its visibility against the week before, and the brands AI named most. */
export function weekOf(rows: Metric[], today: string) {
  const start = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * DAY).toISOString().slice(0, 10);
  const prevStart = new Date(Date.parse(`${today}T00:00:00Z`) - 14 * DAY).toISOString().slice(0, 10);
  const now = rows.filter((r) => r.day >= start && r.day < today);
  const before = rows.filter((r) => r.day >= prevStart && r.day < start);
  if (!now.some((r) => r.named === "" && r.answers > 0)) return null;
  const engines = new Set(now.filter((r) => r.named === "" && r.answers > 0).map((r) => r.engine));
  const list = shares(now, engines);
  const was = before.some((r) => r.named === "" && r.answers > 0) ? shares(before, engines) : null;
  const you = list.find((x) => x.you)?.visibility ?? 0;
  const youBefore = was ? (was.find((x) => x.you)?.visibility ?? 0) : null;
  const byEngine = [...engines].sort().map((engine) => {
    const v = shares(now.filter((r) => r.engine === engine), new Set([engine])).find((x) => x.you)?.visibility ?? 0;
    return { engine, visibility: v };
  });
  const top = list
    .filter((x) => !x.you)
    .sort((a, b) => b.visibility - a.visibility)
    .slice(0, 3);
  return { visibility: you, change: youBefore === null ? null : you - youBefore, byEngine, top };
}

