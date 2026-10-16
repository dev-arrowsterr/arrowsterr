import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cached, DAY } from "./cache";
import { askJson } from "./claude";
import { call, dfsReady } from "./dataforseo";
import { entitlement } from "./entitlements";
import { enqueueMany, finish, rateOk, retry, type Job } from "./jobs";
import { namesBrand, pickTargets, SOCIAL_SITES, socialSourceOf, splitSnippetDate, threadKey, authorOf, type ListenSettings, type MentionKind, type SocialSource } from "./social";

// Social listening: find posts about a brand and its top competitors, keep the ones that are really
// about them, and save them to `mentions`. See docs/social-listening.md.

export type Target = { name: string; domain: string | null; isYou: boolean };
type Found = { source: SocialSource; url: string; title: string; snippet: string; author: string | null; posted_at: string | null };
type Tagged = Found & { sentiment: number; kind: MentionKind };
type ListenPayload = { brandId: string; name: string; domain: string | null; isYou: boolean; category: string; day: string };

const KINDS: MentionKind[] = ["question", "complaint", "praise", "comparison", "news", "other"];
const MAX_FOUND = 40; // posts read per name per day
const TAG_MODEL = () => process.env.LISTEN_MODEL || "claude-haiku-5-5";
export const NOT_SET_UP = "Run supabase/038_social.sql in Supabase.";
const today = () => new Date().toISOString().slice(0, 10);
const nameKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The brands AI names most next to this one in the last 30 days, most named first, with the domain AI linked for each. */
export async function rankedCompetitors(db: SupabaseClient, brandId: string): Promise<{ name: string; domain: string | null; mentions: number }[]> {
  const since = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  const { data, error } = await db.from("daily_metrics").select("named, mentions").eq("brand_id", brandId).eq("is_you", false).neq("named", "").gte("day", since).limit(20000);
  if (error) throw new Error(error.message);
  const count = new Map<string, { name: string; n: number }>();
  for (const r of data ?? []) {
    const k = nameKey(r.named);
    const row = count.get(k) ?? { name: r.named, n: 0 };
    row.n += Number(r.mentions) || 0;
    count.set(k, row);
  }
  // Domains come from the latest runs: each brand AI names may carry the site it linked.
  const { data: runs } = await db.from("runs").select("chats").eq("brand_id", brandId).order("at", { ascending: false }).limit(5);
  const domains = new Map<string, Map<string, number>>();
  for (const r of runs ?? [])
    for (const c of (r.chats ?? []) as { brands?: { name: string; domain?: string }[] }[])
      for (const b of c.brands ?? []) {
        if (!b.domain) continue;
        const m = domains.get(nameKey(b.name)) ?? new Map<string, number>();
        m.set(b.domain, (m.get(b.domain) ?? 0) + 1);
        domains.set(nameKey(b.name), m);
      }
  return [...count.entries()]
    .filter(([, r]) => r.n > 0)
    .sort((a, b) => b[1].n - a[1].n)
    .map(([k, r]) => ({ name: r.name, mentions: r.n, domain: [...(domains.get(k)?.entries() ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null }));
}

/** Who a brand's listening covers: the brand, then its competitors up to the plan's limit. */
export async function targetsOf(db: SupabaseClient, brand: { id: string; name: string; domain: string; listen?: ListenSettings | null }, limit: number): Promise<Target[]> {
  const ranked = await rankedCompetitors(db, brand.id);
  return [{ name: brand.name, domain: brand.domain || null, isYou: true }, ...pickTargets(ranked, brand.name, limit, brand.listen?.picks).map((r) => ({ ...r, isYou: false }))];
}

type ListenBrand = { id: string; workspace_id: string; name: string; domain: string; category: string; listen: ListenSettings | null };

/** Queue today's listening for one brand. Jobs are keyed by brand, name and day, so asking twice does nothing. */
export async function queueListen(db: SupabaseClient, brand: ListenBrand, limit: number, day = today()) {
  const targets = await targetsOf(db, brand, limit);
  await enqueueMany(
    targets.map((t) => ({
      kind: "listen" as const,
      workspace_id: brand.workspace_id,
      key: `listen:${brand.id}:${nameKey(t.name)}:${day}`,
      payload: { brandId: brand.id, name: t.name, domain: t.domain, isYou: t.isYou, category: brand.category ?? "", day } satisfies ListenPayload,
    })),
  );
  return targets;
}

/**
 * Start each brand's listening once a day, in its own time slot. Called by the scheduler.
 * Never throws: a problem here must not stop the daily AI checks.
 */
export async function listenDaily(db: SupabaseClient, due: (brandId: string) => boolean) {
  try {
    if (!dfsReady()) return;
    const day = today();
    const { data, error } = await db.from("brands").select("id, workspace_id, name, domain, category, listen, listened_on").order("created_at");
    if (error) return; // before 038_social.sql
    // Each plan listens for its first N brands, in the order they were added.
    const order = new Map<string, string[]>();
    for (const b of data ?? []) order.set(b.workspace_id, [...(order.get(b.workspace_id) ?? []), b.id]);
    for (const b of data ?? []) {
      if ((b.listen as ListenSettings | null)?.off || b.listened_on === day || !due(b.id)) continue;
      const e = await entitlement(b.workspace_id);
      if (e.readOnly || !e.open.visibility || e.limits.listenNames <= 0) continue;
      if ((order.get(b.workspace_id) ?? []).indexOf(b.id) >= e.limits.listenBrands) continue;
      // Claim today first, so a crash halfway never queues the brand twice.
      const { data: claimed } = await db.from("brands").update({ listened_on: day }).eq("id", b.id).or(`listened_on.is.null,listened_on.neq.${day}`).select("id");
      if (!claimed?.length) continue;
      await queueListen(db, b as ListenBrand, e.limits.listenNames, day).catch((err) => console.error(`Listening for ${b.id} failed to start:`, err instanceof Error ? err.message : err));
    }
  } catch (err) {
    console.error("Listening schedule failed:", err instanceof Error ? err.message : err);
  }
}

// ─────────────── finding posts ───────────────

const MARKET = () => ({ location_code: Number(process.env.DFS_LOCATION_CODE) || 2840, language_code: process.env.DFS_LANGUAGE_CODE || "en" });
const quoted = (name: string) => `"${name.replace(/"/g, "")}"`;

type GoogleItem = { type?: string; url?: string; title?: string; description?: string; snippet?: string; timestamp?: string };

async function google(path: string, keyword: string, window: "w" | "m", depth: number): Promise<GoogleItem[]> {
  const [task] = await call(path, [{ keyword, ...MARKET(), depth, search_param: `&tbs=qdr:${window}` }]);
  if (task?.status_code !== 20000) throw new Error(`DataForSEO: ${task?.status_message ?? "no result"}`);
  return (task.result?.[0]?.items ?? []) as GoogleItem[];
}

const stamp = (t: string | undefined) => {
  const d = t ? Date.parse(t) : NaN;
  return Number.isFinite(d) ? new Date(d).toISOString() : null;
};

function fromGoogle(items: GoogleItem[], news: boolean): Found[] {
  return items
    .filter((i) => i.url && i.title && (news ? i.type === "news_search" : i.type === "organic"))
    .map((i) => {
      const { at, text } = splitSnippetDate(i.description ?? i.snippet ?? "");
      const source = socialSourceOf(i.url!) ?? (news ? "news" : null);
      return source ? { source, url: i.url!, title: i.title!.trim(), snippet: text.slice(0, 500), author: authorOf(i.url!), posted_at: stamp(i.timestamp) ?? at } : null;
    })
    .filter((f): f is Found => f !== null);
}

const unhtml = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

type HnHit = { objectID: string; title?: string | null; story_title?: string | null; comment_text?: string | null; story_text?: string | null; author?: string; created_at?: string };

/** Hacker News stories and comments that name the brand, from Algolia's free search. */
async function hackerNews(name: string, window: "w" | "m"): Promise<Found[]> {
  const since = Math.floor((Date.now() - (window === "m" ? 30 : 7) * DAY) / 1000);
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(quoted(name))}&tags=(story,comment)&numericFilters=created_at_i>${since}&hitsPerPage=30`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Hacker News search returned ${res.status}`);
  const data = (await res.json()) as { hits?: HnHit[] };
  return (data.hits ?? []).map((h) => ({
    source: "hn" as const,
    url: `https://news.ycombinator.com/item?id=${h.objectID}`,
    title: (h.title || h.story_title || "Hacker News").trim(),
    snippet: unhtml(h.comment_text || h.story_text || "").slice(0, 500),
    author: h.author ?? null,
    posted_at: stamp(h.created_at),
  }));
}

/** Every post from the past week (or month) that names the brand, one per thread. Google failures throw so the job retries. */
async function search(t: Pick<Target, "name" | "domain">, window: "w" | "m"): Promise<Found[]> {
  const q = quoted(t.name);
  const own = t.domain ? ` -site:${t.domain}` : "";
  const [reddit, social, news] = await Promise.all([
    google("serp/google/organic/live/regular", `${q} site:reddit.com`, window, 20),
    google("serp/google/organic/live/regular", `${q} (${SOCIAL_SITES.map((s) => `site:${s}`).join(" OR ")})`, window, 20),
    google("serp/google/news/live/advanced", `${q}${own}`, window, 10),
  ]);
  const hn = await hackerNews(t.name, window).catch((e) => {
    console.error("Hacker News search failed:", e instanceof Error ? e.message : e);
    return [] as Found[];
  });
  const seen = new Set<string>();
  // If Google ever ignores the date filter, posts dated before the window are still left out.
  const oldest = Date.now() - ((window === "m" ? 30 : 7) + 2) * DAY;
  return [...fromGoogle(reddit, false), ...fromGoogle(social, false), ...fromGoogle(news, true), ...hn]
    .filter((f) => !f.posted_at || Date.parse(f.posted_at) >= oldest)
    .filter((f) => namesBrand(`${f.title} ${f.snippet}`, t.name, t.domain))
    .filter((f) => !seen.has(threadKey(f.url)) && seen.add(threadKey(f.url)))
    .slice(0, MAX_FOUND);
}

// ─────────────── checking posts ───────────────

const TAG_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, about: { type: "boolean" }, sentiment: { type: "integer" }, kind: { type: "string", enum: KINDS } },
        required: ["id", "about", "sentiment", "kind"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const TAG_PROMPT = (t: Pick<Target, "name" | "domain">, category: string, posts: string) => `You check social posts for a brand monitoring tool.
The brand is "${t.name}"${t.domain ? ` (website: ${t.domain})` : ""}${category ? `. It works in this market: ${category}` : ""}.

For each post, decide:
- about: true only when the post is clearly about this company or its product. False when the name means something else (a common word, a person, a place, or another company with the same name). False when you are not sure.
- sentiment: 0 to 100, how the post feels about this brand. 50 is neutral.
- kind: question (asks for help or recommendations), complaint, praise, comparison (weighs it against other products), news, or other.

Posts, as JSON:
${posts}

Return one item for every post, with its id.`;

/** Keep the posts that are really about the brand, with sentiment and kind. Unsure or missing answers are dropped. */
async function tag(t: Pick<Target, "name" | "domain">, category: string, found: Found[]): Promise<Tagged[]> {
  const out: Tagged[] = [];
  for (let i = 0; i < found.length; i += 20) {
    const chunk = found.slice(i, i + 20);
    const posts = JSON.stringify(chunk.map((f, j) => ({ id: String(j), source: f.source, title: f.title.slice(0, 300), text: f.snippet.slice(0, 500) })));
    const res = await askJson<{ items?: { id: string; about: boolean; sentiment: number; kind: string }[] }>(TAG_PROMPT(t, category, posts), TAG_SCHEMA, { model: TAG_MODEL(), maxTokens: 3000, effort: "low" });
    for (const r of res.items ?? []) {
      const f = chunk[Number(r.id)];
      if (!f || r.about !== true) continue;
      out.push({ ...f, sentiment: Math.max(0, Math.min(100, Math.round(Number(r.sentiment) || 50))), kind: KINDS.includes(r.kind as MentionKind) ? (r.kind as MentionKind) : "other" });
    }
  }
  return out;
}

// ─────────────── the job ───────────────

/** One name for one brand: search, check and save new posts. */
export async function listen(db: SupabaseClient, job: Job) {
  const p = job.payload as unknown as ListenPayload;
  const { data: brand } = await db.from("brands").select("id, listen").eq("id", p.brandId).maybeSingle();
  if (!brand || (brand.listen as ListenSettings | null)?.off || !dfsReady()) return finish(job.id);
  if (!(await rateOk("dataforseo", 3))) return retry(job.id, "rate limit", 20, { count: false });

  // The first run for a name looks back a month. After that, a week.
  const { data: had } = await db.from("mentions").select("id").eq("brand_id", p.brandId).eq("name", p.name).limit(1);
  const window = had?.length ? "w" : "m";
  // The same name on the same day is searched and checked once, for every workspace that tracks it.
  const key = `listen:v1:${nameKey(p.name)}:${p.domain ?? ""}:${nameKey(p.category).slice(0, 80)}:${window}:${p.day}`;
  const { data: posts } = await cached(key, DAY, async () => tag(p, p.category, await search(p, window)));

  if (posts.length) {
    const rows = posts.map((m) => ({ workspace_id: job.workspace_id, brand_id: p.brandId, name: p.name, is_you: p.isYou, ...m }));
    const { error } = await db.from("mentions").upsert(rows, { onConflict: "brand_id,name,url", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  await finish(job.id);
}
