import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, parseJson } from "./claude";
import { BUSINESS_TYPES } from "./onboarding";
import type { Profile } from "./db";
import { overview, Spend, research, topUrls, type Market } from "./keywords";
import { groupBySerp, marketOf, PATTERNS, PER_STAGE, pick, STAGES, type AgentKeyword, type AgentResult, type Keyword, type Stage } from "./research";

// Agentic Keyword Research: Claude writes keywords stage by stage, DataForSEO checks each one,
// and keywords that share Google results are grouped so each page targets one group.

type Site = { id: string; domain: string; name: string; profile: Profile };
type Draft = { keyword: string; theme: string };

const CANDIDATES = 65; // written per stage, so enough survive the volume check
const words = (k: string) => k.trim().split(/\s+/).length;
const norm = (k: string) => k.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

const about = (s: Site, ranked: Keyword[]) => `Website: ${s.domain} (${s.name})
Type: ${BUSINESS_TYPES.find((t) => t.id === s.profile.businessType)?.label ?? "Not sure"}
Products and services: ${s.profile.products || "Not given"}
Customers: ${s.profile.customers || "Not given"}
Key features: ${s.profile.features || "Not given"}
Market: ${s.profile.country || "United States"}
${ranked.length ? `It already ranks on Google for: ${ranked.slice(0, 40).map((k) => k.keyword).join(", ")}` : "It ranks for very few keywords on Google today."}`;

function stagePrompt(s: Site, ranked: Keyword[], stage: Stage, themes: string[] | null, taken: string[], count: number, focus = "") {
  const st = STAGES.find((x) => x.id === stage)!;
  return `You are an SEO strategist planning content for a website. Write ${st.label} keywords (${st.long}).

${about(s, ranked)}

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

/** Run the whole research for one site and save progress to keyword_runs as it goes. */
export async function runAgent(sb: SupabaseClient, runId: string, site: Site) {
  const save = (patch: Record<string, unknown>) => sb.from("keyword_runs").update(patch).eq("id", runId);
  const step = (text: string) => save({ step: text });
  const m: Market = marketOf(site.profile.country);
  const spend = new Spend();
  try {
    await step("Checking what the site already ranks for");
    const ranked = await research("ranked", site.domain, m, spend, 200).catch(() => [] as Keyword[]);
    const rankedTop = new Map(ranked.filter((k) => (k.rank ?? 99) <= 5).map((k) => [norm(k.keyword), k.rank!]));

    let themes: string[] | null = null;
    const seen = new Set<string>();
    const chosen: AgentKeyword[] = [];
    for (const st of STAGES) {
      await step(`Writing ${st.label} keywords`);
      const taken = chosen.map((k) => k.keyword);
      const first = await draft(stagePrompt(site, ranked, st.id, themes, taken, CANDIDATES), themes);
      themes = first.themes.length ? first.themes : ["General"];
      let cands = first.rows.filter((r) => !seen.has(norm(r.keyword)) && seen.add(norm(r.keyword)));

      await step(`Checking ${st.label} search volume`);
      let data = await overview(cands.map((c) => c.keyword), m, spend);
      const enrich = (list: Draft[]) =>
        list.map((c) => ({ ...(data.get(c.keyword.toLowerCase()) ?? { keyword: c.keyword, volume: null, kd: null, cpc: null, intent: null, trend: [], serp: [] }), ...c }));
      let usable = enrich(cands).filter((c) => (c.volume ?? 0) > 0 && !rankedTop.has(norm(c.keyword)));

      // Not enough real searches: ask once more, for the themes that came up short.
      if (usable.length < PER_STAGE) {
        await step(`Finding more ${st.label} keywords`);
        const short = themes.filter((t) => usable.filter((u) => u.theme === t).length < PER_STAGE / themes!.length);
        const more = await draft(
          stagePrompt(site, ranked, st.id, themes, [...taken, ...cands.map((c) => c.keyword)], 40, `\n- Many earlier ideas had no searches. Use simpler, more common wording. Focus on: ${short.join(", ")}.`),
          themes,
        );
        const extra = more.rows.filter((r) => !seen.has(norm(r.keyword)) && seen.add(norm(r.keyword)));
        const extraData = await overview(extra.map((c) => c.keyword), m, spend);
        data = new Map([...data, ...extraData]);
        cands = [...cands, ...extra];
        usable = enrich(cands).filter((c) => (c.volume ?? 0) > 0 && !rankedTop.has(norm(c.keyword)));
      }
      const picked = pick(usable, PER_STAGE, themes);
      // Still short: fill with the rest, marked as low data.
      const got = new Set(picked.map((k) => k.keyword));
      const rest = enrich(cands).filter((c) => !got.has(c.keyword) && !rankedTop.has(norm(c.keyword)));
      const filled = [...picked.map((k) => ({ ...k, lowData: false })), ...rest.slice(0, PER_STAGE - picked.length).map((k) => ({ ...k, lowData: true }))];
      chosen.push(...filled.map((k) => ({ ...k, stage: st.id, group: -1 })));
    }

    await step(`Reading Google results for ${chosen.length} keywords`);
    const serps = new Map<string, string[]>();
    await pool(chosen, 8, async (k) => {
      serps.set(k.keyword, await topUrls(k.keyword, m, spend).catch(() => []));
    });
    await step("Grouping keywords into pages");
    const groups = groupBySerp(chosen, serps);

    const result: AgentResult = { themes: themes ?? [], keywords: chosen, groups, approved: [], cost: Math.round(spend.total * 1000) / 1000 };
    await save({ status: "done", step: "", result, finished_at: new Date().toISOString() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Agentic keyword research failed:", message);
    await save({ status: "failed", error: message, finished_at: new Date().toISOString() });
  }
}
