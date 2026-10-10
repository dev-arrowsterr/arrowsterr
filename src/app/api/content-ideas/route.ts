import { cached, DAY, readCache } from "@/lib/cache";
import { askClaude, parseJson } from "@/lib/claude";
import { dfsReady } from "@/lib/dataforseo";
import type { Profile } from "@/lib/db";
import { overview, rankedFor, Spend, type Target } from "@/lib/keywords";
import { marketOf, pagesOf, type Keyword, type SitePage } from "@/lib/research";
import { requireRole, takeAnswer } from "@/lib/serverAuth";
import { meteredRoute } from "@/lib/meter";
import { requirePaid, take } from "@/lib/entitlements";
import { TASK_COST } from "@/lib/plans";

type Idea = { keyword: string; action: "new" | "update"; url: string | null; stage: "bofu" | "mofu" | "tofu" | null; why: string; prompt: string };

const PROMPT = (brand: string, domain: string, data: string) => `You plan SEO content for ${brand} (${domain}) so AI assistants like ChatGPT, Claude, Gemini and Perplexity name it more often. AI assistants lean on pages that rank on Google, so every idea must be a real Google keyword.

Here is what we know, as JSON:
${data}

Fields:
- missed: prompts where AI rarely names ${brand}, with the brands it names instead.
- weak: prompts where AI names ${brand} but low in the list.
- pages: ${brand}'s pages that rank on Google, with their top keywords and positions.
- close: keywords ${brand} ranks for in positions 4 to 30, with the page that ranks.
- articles: paths of articles already on the site.
- planned: keywords already on the calendar. Never repeat them.

Suggest 12 content ideas that would help ${brand} win the missed and weak prompts.
Rules:
- Each idea is a KEYWORD people type into Google: 2 to 5 words, lowercase, with real search demand. Head and mid-tail terms only.
- Never a full question, a long sentence, or a very narrow one-off query. "best review management software" is good. "what is the best review tool for a 3-location dental clinic" is bad.
- If a page in pages or close already covers the topic, use action "update" with that page's url. Otherwise use action "new" and url null.
- Never suggest a topic an article already covers, unless it is an update.
- why: one short sentence tied to a prompt or competitor in the data. prompt: the prompt it helps, word for word.
- 9th-grade words. No em dashes. Never invent numbers.

Return JSON only:
{"ideas": [{"keyword": "...", "action": "new" | "update", "url": null, "stage": "bofu" | "mofu" | "tofu", "why": "...", "prompt": "..."}]}`;

// Content ideas for the editorial calendar: AI visibility gaps, read against the site's own pages and Google rankings.
// Every idea is checked for search volume before it is shown.
async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const brand = typeof body.brand === "string" ? body.brand.slice(0, 100) : "";
  const gaps = body.data ?? {};
  if (!brand || JSON.stringify(gaps).length > 30000) return Response.json({ error: "Bad request" }, { status: 400 });
  const auth = await requireRole(request, body.workspaceId, "editor");
  if ("denied" in auth) return auth.denied;
  const paid = await requirePaid(body.workspaceId);
  if (paid) return paid;
  const took = await take(body.workspaceId, "tasks", TASK_COST.ai);
  if (!took.ok) return took.response;
  if (!dfsReady()) return Response.json({ error: "DataForSEO is not set up. Add DFS_LOGIN and DFS_PASSWORD on Render." }, { status: 500 });

  const { data: site, error } = await auth.sb.from("sites").select("id, domain, profile, pages").eq("id", body.siteId).eq("workspace_id", body.workspaceId).maybeSingle();
  if (error || !site) return Response.json({ error: error?.message ?? "Website not found." }, { status: 404 });
  const limited = await takeAnswer(auth.sb, body.workspaceId);
  if (limited) return limited;

  try {
    const m = marketOf((site.profile as Profile)?.country);
    const spend = new Spend();
    const domain = String(site.domain).replace(/^www\./, "");
    // The latest Domain Research crawl of the site: the bigger one if it was loaded, else the first 100, else a fresh read.
    const key = (part: string) => `dom:domain:${part}:${m.location}:${m.language}:${domain}`;
    const target: Target = { scope: "domain", host: domain, path: "" };
    const ranked: Keyword[] =
      (await readCache<{ keywords: Keyword[] }>(key("kw500"), 30 * DAY))?.keywords ??
      (await cached(key("kw"), 30 * DAY, () => rankedFor(target, m, spend, 100)).then((r) => r.data.keywords).catch(() => [] as Keyword[]));
    const pages = pagesOf(ranked)
      .slice(0, 25)
      .map((p) => ({ url: p.url, visits: p.traffic, top: ranked.filter((k) => k.url === p.url).slice(0, 4).map((k) => `${k.keyword} #${k.rank}`) }));
    const close = ranked
      .filter((k) => (k.rank ?? 99) >= 4 && (k.rank ?? 99) <= 30 && (k.volume ?? 0) > 0)
      .slice(0, 40)
      .map((k) => ({ keyword: k.keyword, rank: k.rank, volume: k.volume, url: k.url }));
    const articles = ((site.pages as SitePage[] | null) ?? []).filter((p) => p.article).slice(0, 120).map((p) => p.url.replace(/^https?:\/\/[^/]+/, ""));

    const data = JSON.stringify({ ...gaps, pages, close, articles }).slice(0, 40000);
    const { text } = await askClaude(PROMPT(brand, domain, data), { maxTokens: 3000 });
    const raw = (parseJson(text).ideas as Record<string, unknown>[] | undefined) ?? [];
    const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
    const planned = new Set(((gaps.planned as string[] | undefined) ?? []).map((k) => k.toLowerCase()));
    const ideas: Idea[] = raw
      .map((i) => ({
        keyword: str(i.keyword, 80).toLowerCase().replace(/[?!.]+$/, ""),
        action: (i.action === "update" ? "update" : "new") as Idea["action"],
        url: i.action === "update" ? str(i.url, 500) || null : null,
        stage: (["bofu", "mofu", "tofu"].includes(i.stage as string) ? i.stage : null) as Idea["stage"],
        why: str(i.why, 300),
        prompt: str(i.prompt, 300),
      }))
      .filter((i) => i.keyword && i.keyword.split(/\s+/).length <= 6 && !planned.has(i.keyword));

    // Only keywords people search for make the list.
    const volumes = await overview([...new Set(ideas.map((i) => i.keyword))], m, spend);
    const out = ideas
      .map((i) => {
        const k = volumes.get(i.keyword);
        return { ...i, volume: k?.volume ?? null, kd: k?.kd ?? null, intent: k?.intent ?? null };
      })
      .filter((i) => (i.volume ?? 0) > 0)
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
    return Response.json({ ideas: out, pages: pages.length, cost: Math.round(spend.total * 1000) / 1000, at: new Date().toISOString() });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const POST = meteredRoute("content ideas", handle);
