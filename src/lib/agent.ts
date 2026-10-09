import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, parseJson } from "./claude";
import { BUSINESS_TYPES } from "./onboarding";
import type { Profile } from "./db";
import { competitors, overview, Spend, research, topUrls, type Market } from "./keywords";
import { cleanUrl, findPages } from "./sitemap";
import { FORMATS, GOALS, groupBySerp, marketOf, PATTERNS, pick, STAGES, stageCounts, type PlanBrief, type AgentKeyword, type AgentResult, type AgentUpdate, type Keyword, type SitePage, type Stage } from "./research";

// Agentic Keyword Research: Claude writes keywords stage by stage, DataForSEO checks each one,
// and keywords that share Google results are grouped so each page targets one group.

type Site = { id: string; domain: string; name: string; profile: Profile; brief?: PlanBrief };
type Draft = { keyword: string; theme: string };
/** What the planner knows before it writes: rival keywords and pages the site already has. */
type Context = { ranked: Keyword[]; rivals: string[]; articles: string[] };

const EXTRA = 25; // written per stage on top of what is needed, so enough survive the volume check
const words = (k: string) => k.trim().split(/\s+/).length;
const norm = (k: string) => k.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

const about = (s: Site, { ranked, articles }: Context) => `Website: ${s.domain} (${s.name})
Type: ${BUSINESS_TYPES.find((t) => t.id === s.profile.businessType)?.label ?? "Not sure"}
Products and services: ${s.profile.products || "Not given"}
Customers: ${s.profile.customers || "Not given"}
Key features: ${s.profile.features || "Not given"}
Market: ${s.profile.country || "United States"}
${planNotes(s.brief)}
${ranked.length ? `It already ranks on Google for: ${ranked.slice(0, 40).map((k) => k.keyword).join(", ")}` : "It ranks for very few keywords on Google today."}
${articles.length ? `It already has articles at: ${articles.slice(0, 80).join(", ")}` : ""}`;

/** The questionnaire answers, as lines for the prompt. */
function planNotes(b?: PlanBrief) {
  if (!b) return "";
  const lines = [
    b.goal ? `Main goal of this content: ${GOALS[b.goal]}.` : "",
    b.focus?.trim() ? `Focus on these products, services or topics: ${b.focus.trim()}` : "",
    b.audience?.trim() ? `Write for this audience: ${b.audience.trim()}` : "",
    b.avoid?.trim() ? `Never plan keywords about: ${b.avoid.trim()}` : "",
    b.formats?.length ? `Favor keywords that suit these formats: ${b.formats.filter((f) => FORMATS.includes(f)).join(", ")}.` : "",
    b.difficulty === "easy" ? "Favor long, specific searches that a small site can win soon." : b.difficulty === "hard" ? "Include big, competitive head terms too." : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function stagePrompt(s: Site, ctx: Context, stage: Stage, themes: string[] | null, taken: string[], count: number, focus = "") {
  const st = STAGES.find((x) => x.id === stage)!;
  return `You are an SEO strategist planning content for a website. Write ${st.label} keywords (${st.long}).

${about(s, ctx)}
${
  ctx.rivals.length
    ? `\nReal keywords its competitors rank for on Google. Use the ones that fit this stage and this business word for word, before writing your own:\n${ctx.rivals.slice(0, 150).join(", ")}\n`
    : ""
}
Search patterns that fit this stage and business type (X is a product, service or category this business offers):
${PATTERNS[stage][s.profile.businessType ?? "other"]}

${
  themes
    ? `Themes (use exactly these, and give every theme keywords):\n${themes.map((t) => `- ${t}`).join("\n")}`
    : `First pick 5 to 8 themes. A theme is one product line, service, use case or customer group this business sells to. Themes must not overlap, and together they must cover everything the business offers.`
}

Rules:
- Write ${count} keywords.${focus}
- Short and simple: 2 to 5 words, most 3 or 4. Lowercase except names.
- Real searches people type into Google in this market, in its language.
- Each keyword must fit this stage only. No keyword may mean the same as another one (plurals, word order and synonyms count as the same).
- Spread keywords evenly across the themes.
- Mention competitor brands only in "alternatives" or "vs" keywords. Never use this website's own brand name.
- Skip topics its existing articles already cover.
${taken.length ? `- Do not repeat or rephrase any of these keywords, which are already planned:\n${taken.join(", ")}` : ""}

Return JSON only:
{${themes ? "" : `"themes": ["..."], `}"keywords": [{"keyword": "...", "theme": "one theme, exactly as written"}]}`;
}

async function draft(prompt: string, themes: string[] | null) {
  const { text } = await askClaude(prompt, { maxTokens: 6000 });
  const data = parseJson(text) as { themes?: unknown; keywords?: unknown };
  const list = Array.isArray(data.themes) ? data.themes.filter((t): t is string => typeof t === "string" && Boolean(t.trim())).map((t) => t.trim()) : [];
  const useThemes = themes ?? list.slice(0, 8);
  const rows: Draft[] = (Array.isArray(data.keywords) ? data.keywords : [])
    .map((k: { keyword?: unknown; theme?: unknown }) => ({ keyword: typeof k?.keyword === "string" ? k.keyword.replace(/[,!@%^()={};~`<>?\\|*"]/g, " ").trim().replace(/\s+/g, " ").toLowerCase().slice(0, 80) : "", theme: typeof k?.theme === "string" ? k.theme.trim() : "" }))
    .filter((k) => k.keyword && words(k.keyword) <= 6)
    .map((k) => ({ ...k, theme: useThemes.find((t) => t.toLowerCase() === k.theme.toLowerCase()) ?? useThemes[0] ?? "General" }));
  return { themes: useThemes, rows };
}

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/** Sites that compete with this one on Google. Falls back to asking Claude, with web search, when the site is too new to have data. */
async function rivalsOf(site: Site, m: Market, spend: Spend): Promise<string[]> {
  const given = (site.brief?.rivals ?? "")
    .split(/[\s,]+/)
    .map((d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))
    .filter((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(d) && d !== site.domain);
  if (given.length) return [...new Set(given)].slice(0, 4);
  const found = (await competitors(site.domain, m, spend, 6).catch(() => [])).map((c) => c.domain);
  if (found.length >= 2) return found.slice(0, 4);
  const { text } = await askClaude(
    `List the 5 closest competitors of ${site.domain} (${site.profile.products || site.name}) for customers in ${site.profile.country || "United States"}. Pick companies that sell the same thing to the same customers, with their own websites. Return JSON only: {"domains": ["example.com"]}`,
    { searches: 3, maxTokens: 1500 },
  ).catch(() => ({ text: "{}" }));
  try {
    const list = (parseJson(text).domains as unknown[]) ?? [];
    return [...found, ...list.filter((d): d is string => typeof d === "string").map((d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))]
      .filter((d, i, a) => d && d !== site.domain && a.indexOf(d) === i)
      .slice(0, 4);
  } catch {
    return found;
  }
}

/** Articles on the site that rank below the top 10 or not at all, each with the keyword to aim it at. */
async function updatesFor(site: Site, pages: SitePage[], ranked: Keyword[], themes: string[], m: Market, spend: Spend): Promise<AgentUpdate[]> {
  const byUrl = new Map<string, Keyword[]>();
  for (const k of ranked) {
    const u = k.url ? cleanUrl(k.url, site.domain) : null;
    if (u) byUrl.set(u, [...(byUrl.get(u) ?? []), k]);
  }
  const best = (u: string) => Math.min(...(byUrl.get(u) ?? []).map((k) => k.rank ?? 99), 999);
  const articles = pages.filter((p) => p.article && best(p.url) > 10);
  // Pages on page 2 to 5 of Google first: they are closest to winning.
  const close = articles.filter((p) => best(p.url) <= 50).sort((a, b) => best(a.url) - best(b.url)).slice(0, 40);
  const unranked = articles.filter((p) => best(p.url) > 50).slice(0, 60 - close.length);
  const list = [...close, ...unranked];
  if (!list.length) return [];

  const { text } = await askClaude(
    `These articles on ${site.domain} rank low on Google or not at all. For each one, pick the single keyword it should rank for, its funnel stage and its theme.

Business: ${site.profile.products || site.name}. Customers: ${site.profile.customers || "not given"}.
Themes: ${themes.join(", ")}

Articles (URL, and the keyword it already ranks for if any):
${list.map((p) => `${p.url}${byUrl.get(p.url)?.length ? ` | ranks for: ${[...byUrl.get(p.url)!].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))[0].keyword}` : ""}`).join("\n")}

Rules:
- Keyword: 2 to 5 words, lowercase, a real search. If the article already ranks for a keyword that fits, use that one.
- Stage: "bofu" (ready to buy), "mofu" (comparing options) or "tofu" (learning).
- Theme: one of the themes above, exactly as written.

Return JSON only: {"articles": [{"url": "...", "keyword": "...", "stage": "bofu", "theme": "..."}]}`,
    { maxTokens: 8000 },
  );
  type Row = { url?: string; keyword?: string; stage?: string; theme?: string };
  const rows = ((parseJson(text).articles as Row[]) ?? []).filter((r) => r?.url && r?.keyword);
  const data = await overview([...new Set(rows.map((r) => r.keyword!.toLowerCase()))], m, spend).catch(() => new Map<string, Keyword>());
  return rows
    .filter((r) => list.some((p) => p.url === r.url))
    .map((r) => {
      const kw = r.keyword!.toLowerCase().trim();
      const own = byUrl.get(r.url!)?.find((k) => norm(k.keyword) === norm(kw));
      const k: Keyword = data.get(kw) ?? own ?? { keyword: kw, volume: null, kd: null, cpc: null, intent: null, trend: [], serp: [] };
      return {
        ...k,
        keyword: kw,
        page: r.url!,
        rank: own?.rank ?? (best(r.url!) < 999 ? best(r.url!) : null),
        url: r.url!,
        stage: (["bofu", "mofu", "tofu"].includes(r.stage ?? "") ? r.stage : "tofu") as Stage,
        theme: themes.find((t) => t.toLowerCase() === (r.theme ?? "").toLowerCase()) ?? themes[0] ?? "General",
      };
    });
}

/** Run the whole research for one site and save progress to keyword_runs as it goes. */
export async function runAgent(sb: SupabaseClient, runId: string, site: Site) {
  const save = (patch: Record<string, unknown>) => sb.from("keyword_runs").update(patch).eq("id", runId);
  const step = (text: string) => save({ step: text });
  const m: Market = marketOf(site.profile.country);
  const spend = new Spend();
  try {
    await step("Reading the sitemap");
    const map = await findPages(site.domain);
    await sb.from("sites").update({ pages: map.pages, pages_at: new Date().toISOString() }).eq("id", site.id);
    const articles = map.pages.filter((p) => p.article);

    await step("Checking what the site already ranks for");
    const ranked = await research("ranked", site.domain, m, spend, 1000).catch(() => [] as Keyword[]);
    const rankedTop = new Map(ranked.filter((k) => (k.rank ?? 99) <= 5).map((k) => [norm(k.keyword), k.rank!]));

    await step("Finding competitors and their keywords");
    const rivals = await rivalsOf(site, m, spend);
    const rivalLists = await Promise.all(rivals.map((d) => research("ranked", d, m, spend, 300, 20).catch(() => [] as Keyword[])));
    const rivalKw = new Map<string, { keyword: string; volume: number; domain: string }>();
    rivalLists.forEach((list, i) => {
      const label = rivals[i].split(".")[0];
      for (const k of list) {
        const n = norm(k.keyword);
        if (!k.volume || words(n) < 2 || words(n) > 5 || n.includes(label) || rankedTop.has(n)) continue;
        if (!rivalKw.has(n) || rivalKw.get(n)!.volume < k.volume) rivalKw.set(n, { keyword: n, volume: k.volume, domain: rivals[i] });
      }
    });
    const rivalList = [...rivalKw.values()].sort((a, b) => b.volume - a.volume).slice(0, 200).map((r) => r.keyword);
    const ctx: Context = { ranked, rivals: rivalList, articles: articles.map((p) => new URL(p.url).pathname) };

    let themes: string[] | null = null;
    const seen = new Set<string>();
    const chosen: AgentKeyword[] = [];
    const counts = stageCounts(site.brief);
    for (const st of STAGES) {
      const need = counts[st.id];
      if (!need) continue;
      await step(`Writing ${st.label} keywords`);
      const taken = chosen.map((k) => k.keyword);
      ctx.rivals = rivalList.filter((k) => !seen.has(k));
      const first = await draft(stagePrompt(site, ctx, st.id, themes, taken, need + EXTRA), themes);
      themes = first.themes.length ? first.themes : ["General"];
      let cands = first.rows.filter((r) => !seen.has(norm(r.keyword)) && seen.add(norm(r.keyword)));

      await step(`Checking ${st.label} search volume`);
      let data = await overview(cands.map((c) => c.keyword), m, spend);
      const enrich = (list: Draft[]) =>
        list.map((c) => ({ ...(data.get(c.keyword.toLowerCase()) ?? { keyword: c.keyword, volume: null, kd: null, cpc: null, intent: null, trend: [], serp: [] }), ...c }));
      let usable = enrich(cands).filter((c) => (c.volume ?? 0) > 0 && !rankedTop.has(norm(c.keyword)));

      // Not enough real searches: ask once more, for the themes that came up short.
      if (usable.length < need) {
        await step(`Finding more ${st.label} keywords`);
        const short = themes.filter((t) => usable.filter((u) => u.theme === t).length < need / themes!.length);
        const more = await draft(
          stagePrompt(site, ctx, st.id, themes, [...taken, ...cands.map((c) => c.keyword)], 40, `\n- Many earlier ideas had no searches. Use simpler, more common wording. Focus on: ${short.join(", ")}.`),
          themes,
        );
        const extra = more.rows.filter((r) => !seen.has(norm(r.keyword)) && seen.add(norm(r.keyword)));
        const extraData = await overview(extra.map((c) => c.keyword), m, spend);
        data = new Map([...data, ...extraData]);
        cands = [...cands, ...extra];
        usable = enrich(cands).filter((c) => (c.volume ?? 0) > 0 && !rankedTop.has(norm(c.keyword)));
      }
      // Easy wins first: drop hard keywords when there are enough others.
      const maxKd = site.brief?.difficulty === "easy" ? 40 : site.brief?.difficulty === "mixed" ? 70 : 101;
      const easy = usable.filter((c) => (c.kd ?? 0) < maxKd);
      const picked = pick(easy.length >= need ? easy : usable, need, themes);
      // Still short: fill with the rest, marked as low data.
      const got = new Set(picked.map((k) => k.keyword));
      const rest = enrich(cands).filter((c) => !got.has(c.keyword) && !rankedTop.has(norm(c.keyword)));
      const filled = [...picked.map((k) => ({ ...k, lowData: false })), ...rest.slice(0, need - picked.length).map((k) => ({ ...k, lowData: true }))];
      chosen.push(...filled.map((k) => ({ ...k, stage: st.id, group: -1, competitor: rivalKw.get(norm(k.keyword))?.domain ?? null })));
    }

    const skipUpdates = site.brief?.updates === false;
    if (!skipUpdates) await step(`Checking ${articles.length} existing articles`);
    const updates = skipUpdates ? [] : await updatesFor(site, map.pages, ranked, themes ?? ["General"], m, spend).catch((e) => {
      console.error("Existing articles check failed:", e instanceof Error ? e.message : e);
      return [] as AgentUpdate[];
    });
    // An existing article already targets this keyword: improve that page instead of writing a new one.
    const covered = new Set(updates.map((u) => norm(u.keyword)));
    const fresh = chosen.filter((k) => !covered.has(norm(k.keyword)));

    await step(`Reading Google results for ${fresh.length} keywords`);
    const serps = new Map<string, string[]>();
    await pool(fresh, 8, async (k) => {
      serps.set(k.keyword, await topUrls(k.keyword, m, spend).catch(() => []));
    });
    await step("Grouping keywords into pages");
    const groups = groupBySerp(fresh, serps);

    const result: AgentResult = {
      brief: site.brief,
      themes: themes ?? [],
      keywords: fresh,
      groups,
      updates,
      sitemap: { source: map.source, pages: map.pages.length, articles: articles.length, ranking: new Set(ranked.map((k) => k.url).filter(Boolean)).size },
      competitors: rivals.map((d, i) => ({ domain: d, keywords: rivalLists[i].length })),
      approved: [],
      cost: Math.round(spend.total * 1000) / 1000,
    };
    await save({ status: "done", step: "", result, finished_at: new Date().toISOString() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Agentic keyword research failed:", message);
    await save({ status: "failed", error: message, finished_at: new Date().toISOString() });
  }
}
