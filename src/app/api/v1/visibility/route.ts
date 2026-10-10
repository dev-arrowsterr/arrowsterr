import { apiAuth } from "@/lib/integrations";

type Row = { day: string; engine: string; named: string; is_you: boolean; answers: number; mentions: number };

// AI visibility by day for a brand, with its competitors.  ?brand_id=…&days=30
export async function GET(request: Request) {
  const a = await apiAuth(request);
  if ("denied" in a) return a.denied;
  const url = new URL(request.url);
  const brandId = url.searchParams.get("brand_id") ?? "";
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days")) || 30));
  const { data: brand } = await a.db.from("brands").select("id, name, domain").eq("id", brandId).eq("workspace_id", a.ws).maybeSingle();
  if (!brand) return Response.json({ error: "Brand not found. Get its id from /api/v1/brands." }, { status: 404 });
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const { data, error } = await a.db.from("daily_metrics").select("day, engine, named, is_you, answers, mentions").eq("brand_id", brandId).gte("day", since).order("day");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const byDay = new Map<string, Row[]>();
  for (const r of (data ?? []) as Row[]) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
  const series = [...byDay.entries()].map(([day, rows]) => {
    const answers = rows.filter((r) => r.named === "").reduce((n, r) => n + r.answers, 0);
    const pct = (m: number) => (answers ? Math.round((m / answers) * 1000) / 10 : 0);
    const named = new Map<string, { name: string; you: boolean; mentions: number }>();
    for (const r of rows) {
      if (!r.named) continue;
      const x = named.get(r.named.toLowerCase()) ?? { name: r.named, you: r.is_you, mentions: 0 };
      x.mentions += r.mentions;
      named.set(r.named.toLowerCase(), x);
    }
    const list = [...named.values()];
    return {
      day,
      answers,
      visibility: pct(list.find((x) => x.you)?.mentions ?? 0),
      engines: [...new Set(rows.map((r) => r.engine))],
      competitors: list.filter((x) => !x.you).map((x) => ({ name: x.name, visibility: pct(x.mentions) })).sort((x, y) => y.visibility - x.visibility).slice(0, 10),
    };
  });
  return Response.json({ brand, days: series });
}
