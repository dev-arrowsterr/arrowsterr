import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import { askClaude, parseJson } from "./claude";
import { call } from "./dataforseo";
import type { Profile } from "./db";
import { BUSINESS_TYPES } from "./onboarding";
import { marketOf, type SitePage } from "./research";

// Content brief: read Google's top 10 for the keyword, read every page, then ask Claude
// what wins on this results page and how to beat it.

import type { Analysis, Brief, BriefDoc, BriefTemplate, Serp, SerpPage } from "./briefTypes";

type Item = {
  type?: string;
  rank_group?: number;
  url?: string;
  domain?: string;
  title?: string;
  description?: string;
  markdown?: string;
  text?: string;
  items?: (Item | string)[];
  references?: { url?: string; domain?: string }[];
};

async function googleTop10(keyword: string, country: string | undefined) {
  const m = marketOf(country);
  const tasks = await call("serp/google/organic/live/advanced", [
    { keyword, location_code: m.location, language_code: m.language, device: "desktop", depth: 10, load_async_ai_overview: true, people_also_ask_click_depth: 1 },
  ]);
  const task = tasks[0];
  if (task?.status_code !== 20000) throw new Error(`DataForSEO: ${task?.status_message ?? "no result"}`);
  const items: Item[] = task.result?.[0]?.items ?? [];
  const aio = items.find((i) => i.type === "ai_overview");
  const aioItems = (aio?.items ?? []).filter((x): x is Item => typeof x === "object");
  const refs = [...(aio?.references ?? []), ...aioItems.flatMap((i) => i.references ?? [])].filter((r) => r.url);
  return {
    cost: Number(task.cost ?? 0),
    organic: items
      .filter((i) => i.type === "organic" && i.url)
      .slice(0, 10)
      .map((i) => ({ rank: i.rank_group ?? 0, url: i.url!, domain: (i.domain ?? "").replace(/^www\./, ""), title: i.title ?? "", description: i.description ?? "" })),
    questions: items
      .filter((i) => i.type === "people_also_ask")
      .flatMap((i) => (i.items ?? []).map((q) => (typeof q === "object" ? q.title : q)))
      .filter((q): q is string => Boolean(q)),
    related: items
      .filter((i) => i.type === "related_searches")
      .flatMap((i) => (i.items ?? []).map((q) => (typeof q === "string" ? q : q.title)))
      .filter((q): q is string => Boolean(q)),
    features: [...new Set(items.map((i) => i.type).filter((t): t is string => Boolean(t) && t !== "organic"))],
    aiOverview: {
      shown: Boolean(aio),
      text: (aio?.markdown || aioItems.map((i) => i.markdown || i.text || "").join("\n")).slice(0, 3000),
      cites: [...new Map(refs.map((r) => [r.url!, { domain: (r.domain ?? "").replace(/^www\./, ""), url: r.url! }])).values()].slice(0, 15),
    },
  };
}

/** Read one ranking page: headings, length, schema and what it uses (tables, images, video). */
async function readPage(p: { rank: number; url: string; domain: string; title: string; description: string }): Promise<SerpPage> {
  const empty: SerpPage = { ...p, read: false, words: 0, headings: [], schema: [], tables: 0, images: 0, videos: 0, lists: 0, updated: null };
  try {
    const res = await fetch(p.url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return empty;
    const $ = cheerio.load((await res.text()).slice(0, 3_000_000));
    const schema = new Set<string>();
    let updated: string | null = $('meta[property="article:modified_time"]').attr("content") ?? $('meta[property="article:published_time"]').attr("content") ?? null;
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const walk = (o: unknown): void => {
          if (Array.isArray(o)) return o.forEach(walk);
          if (!o || typeof o !== "object") return;
          const r = o as Record<string, unknown>;
          for (const t of [r["@type"]].flat()) if (typeof t === "string") schema.add(t);
          if (!updated && typeof r.dateModified === "string") updated = r.dateModified;
          if (r["@graph"]) walk(r["@graph"]);
        };
        walk(JSON.parse($(el).text()));
      } catch {
        // Broken schema on their page. Skip it.
      }
    });
    $("script, style, noscript, svg, nav, footer, header, aside, form").remove();
    const main = $("article").first().length ? $("article").first() : $("main").first().length ? $("main").first() : $("body");
    const headings = main
      .find("h1, h2, h3")
      .map((_, h) => `${h.tagName.toUpperCase()}: ${$(h).text().replace(/\s+/g, " ").trim()}`)
      .get()
      .filter((h) => h.length > 4)
      .slice(0, 45);
    return {
      ...p,
      read: true,
      words: main.text().split(/\s+/).filter(Boolean).length,
      headings,
      schema: [...schema].slice(0, 8),
      tables: main.find("table").length,
      images: main.find("img").length,
      videos: main.find('iframe[src*="youtube"], iframe[src*="vimeo"], video').length,
      lists: main.find("ul, ol").length,
      updated: updated ? updated.slice(0, 10) : null,
    };
  } catch {
    return empty;
  }
}

/** Pages on the site whose address shares words with the keyword: candidates for internal links. */
function linkCandidates(pages: SitePage[], words: string[]) {
  const want = new Set(words.flatMap((w) => w.toLowerCase().split(/\s+/)).filter((w) => w.length > 2));
  return pages
    .map((p) => {
      const slug = new URL(p.url).pathname.toLowerCase().split(/[/-]/).filter(Boolean);
      return { url: p.url, score: slug.filter((s) => want.has(s)).length + (p.article ? 0.5 : 0) };
    })
    .filter((p) => p.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 25)
    .map((p) => p.url);
}

const PROMPT = (
  kw: string,
  secondary: string[],
  action: string,
  currentUrl: string | null,
  site: { domain: string; name: string; profile: Profile },
  serp: Serp,
  links: string[],
) => `You are a senior SEO content strategist. Study Google's results for a keyword, then write a content brief a human writer will follow. The writer adds the expertise; you give them the plan.

Keyword: ${kw}
${secondary.length ? `Also target: ${secondary.join(", ")}` : ""}
Job: ${action === "update" ? `Improve the existing page ${currentUrl} so it ranks in the top 3.` : "Write a new page."}

Website: ${site.domain} (${site.name})
Business type: ${BUSINESS_TYPES.find((t) => t.id === site.profile.businessType)?.label ?? "Not sure"}
Sells: ${site.profile.products || "Not given"}
Customers: ${site.profile.customers || "Not given"}
Strengths: ${site.profile.features || "Not given"}

Google features on this results page: ${serp.features.join(", ") || "none"}
AI Overview: ${serp.aiOverview.shown ? `shown. It says: ${serp.aiOverview.text.slice(0, 1500)}\nIt cites: ${serp.aiOverview.cites.map((c) => c.domain).join(", ")}` : "not shown"}
People also ask: ${serp.questions.join(" | ") || "none"}
Related searches: ${serp.related.join(" | ") || "none"}

Top 10 results:
${serp.pages
  .map(
    (p) => `#${p.rank} ${p.url}
Title: ${p.title}
${p.read ? `Words: ${p.words}. Tables: ${p.tables}. Images: ${p.images}. Videos: ${p.videos}. Lists: ${p.lists}. Schema: ${p.schema.join(", ") || "none"}. Updated: ${p.updated ?? "unknown"}
Headings:
${p.headings.join("\n")}` : `Could not read the page. Google snippet: ${p.description}`}`,
  )
  .join("\n\n")}

Pages on ${site.domain} that could be linked from this one:
${links.join("\n") || "none found"}

Return JSON only, in exactly this shape:
{
  "analysis": {
    "intent": "what the searcher wants, in one sentence",
    "format": "the format that wins, like 'listicle of 10+ tools', 'how-to guide', 'comparison page', 'product category page'",
    "formatWhy": "why, with counts from the top 10, like '7 of 10 are listicles'",
    "wordRange": "like '1,800 to 2,400 words', from the pages above",
    "mustCover": ["subtopics most top pages cover. 6 to 12 items"],
    "gaps": ["useful things no top page covers well. 3 to 6 items"],
    "aiOverview": "what the AI Overview pulls from and how to get cited. Say so if there is none",
    "actions": ["specific action items to outrank the top 10. 5 to 8 items"],
    "pages": [{"url": "...", "format": "...", "strength": "one line", "weakness": "one line"}]
  },
  "brief": {
    "titles": ["3 title tag options, under 60 characters, with the keyword"],
    "metaDescription": "under 155 characters",
    "slug": "/short-slug",
    "h1": "...",
    "wordCount": "like '2,000 to 2,400'",
    "outline": [{"h2": "...", "h3": ["..."], "notes": "what to say here and what proof to show"}],
    "questions": ["questions to answer on the page, from People also ask and the gaps"],
    "terms": ["terms and entities to use naturally. 10 to 20"],
    "internalLinks": [{"url": "one of the pages listed above", "anchor": "anchor text"}],
    "sources": ["kinds of data or sources to cite, like 'a 2025 industry survey on X'"],
    "makeItYours": ["first-hand things only this business can add: tests, data, screenshots, quotes, a clear stance. 4 to 6 items"],
    "aiTips": ["how to write so AI assistants quote this page. 3 to 5 items"]
  },
  "template": {
    "positioning": {
      "who": "what ${site.name} is and who uses it, in one or two sentences",
      "whereTo": "what it helps them do",
      "howTo": "how it does that: the product, method or features",
      "whySo": "why it does that: what it believes"
    },
    "goals": ["3 or 4 article goals. Each starts with a short bold-style phrase, then a sentence. Cover: the intent to capture and how ${site.name} should appear, the keyword cluster to rank for, the topical authority to build, and the action the page should drive"],
    "lema": {
      "knows": ["what the searcher already knows. 3 or 4 items"],
      "wants": ["what the searcher wants to find out. 4 or 5 items"],
      "shouldKnow": ["what they should know but did not think to ask. 2 or 3 items"],
      "action": "the one action they should take after reading"
    },
    "outline": [{"section": "Introduction, then each H2 as 'H2: ...'", "guide": "how to write this section: the angle, what to list or compare, any table to include and its columns, and where ${site.name} fits. Start the introduction with Problem, Agitation, Solution"}]
  }
}
Write plainly, for a 9th-grade reader. Use only the internal links listed above.`;

/** Build the brief for one calendar item and save it. */
export async function runBrief(sb: SupabaseClient, itemId: string) {
  const save = (patch: Record<string, unknown>) => sb.from("calendar_items").update(patch).eq("id", itemId);
  try {
    const { data: item, error } = await sb.from("calendar_items").select("keyword, secondary, action, current_url, site_id, status").eq("id", itemId).single();
    if (error || !item) throw new Error(error?.message ?? "Item not found.");
    const { data: site, error: e2 } = await sb.from("sites").select("domain, name, profile, pages").eq("id", item.site_id).single();
    if (e2 || !site) throw new Error(e2?.message ?? "Website not found.");

    const g = await googleTop10(item.keyword, (site.profile as Profile)?.country);
    const pages = await Promise.all(g.organic.map(readPage));
    const serp: Serp = { pages, questions: g.questions, related: g.related, features: g.features, aiOverview: g.aiOverview };
    const links = linkCandidates((site.pages as SitePage[]) ?? [], [item.keyword, ...(item.secondary ?? [])]).filter((u) => u !== item.current_url);

    const { text } = await askClaude(PROMPT(item.keyword, item.secondary ?? [], item.action, item.current_url, site as { domain: string; name: string; profile: Profile }, serp, links), {
      maxTokens: 14000,
    });
    const out = parseJson(text) as { analysis?: Analysis; brief?: BriefDoc; template?: BriefTemplate };
    if (!out.analysis || !out.brief) throw new Error("Claude did not return a full brief. Try again.");
    const brief: Brief = { serp, analysis: out.analysis, brief: out.brief, template: out.template, at: new Date().toISOString(), cost: Math.round(g.cost * 1000) / 1000 };
    await save({ brief, brief_status: "done", brief_error: null, brief_at: brief.at, status: item.status === "planned" ? "brief" : item.status });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Content brief failed:", message);
    await save({ brief_status: "failed", brief_error: message });
  }
}
