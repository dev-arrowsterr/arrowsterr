// Social listening, shared by the server and the browser: where a post lives, whether it names a brand,
// which posts AI also cites, and share of voice. See docs/social-listening.md.

export type SocialSource = "reddit" | "x" | "linkedin" | "youtube" | "quora" | "medium" | "producthunt" | "tiktok" | "hn" | "news";
export type MentionKind = "question" | "complaint" | "praise" | "comparison" | "news" | "other";

export type Mention = {
  id: number;
  brand_id: string;
  name: string;
  is_you: boolean;
  source: SocialSource;
  url: string;
  title: string;
  snippet: string;
  author: string | null;
  posted_at: string | null;
  found_at: string;
  sentiment: number | null;
  kind: MentionKind | null;
};

/** Settings saved on the brand. picks: the competitors an editor chose; missing means the top ones from AI Visibility. */
export type ListenSettings = { off?: boolean; picks?: string[] | null };

export const SOURCES: Record<SocialSource, { label: string; domain: string }> = {
  reddit: { label: "Reddit", domain: "reddit.com" },
  x: { label: "X", domain: "x.com" },
  linkedin: { label: "LinkedIn", domain: "linkedin.com" },
  youtube: { label: "YouTube", domain: "youtube.com" },
  quora: { label: "Quora", domain: "quora.com" },
  medium: { label: "Medium", domain: "medium.com" },
  producthunt: { label: "Product Hunt", domain: "producthunt.com" },
  tiktok: { label: "TikTok", domain: "tiktok.com" },
  hn: { label: "Hacker News", domain: "news.ycombinator.com" },
  news: { label: "News", domain: "" },
};

/** The social sites searched together in one Google search. Reddit gets its own search. */
export const SOCIAL_SITES = ["x.com", "twitter.com", "linkedin.com", "youtube.com", "quora.com", "medium.com", "producthunt.com", "tiktok.com"];

const SITE_OF: [RegExp, SocialSource][] = [
  [/(^|\.)reddit\.com$/, "reddit"],
  [/(^|\.)(x|twitter)\.com$/, "x"],
  [/(^|\.)linkedin\.com$/, "linkedin"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)quora\.com$/, "quora"],
  [/(^|\.)medium\.com$/, "medium"],
  [/(^|\.)producthunt\.com$/, "producthunt"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/^news\.ycombinator\.com$/, "hn"],
];

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** The social site a link belongs to, or null for any other site. */
export function socialSourceOf(url: string): SocialSource | null {
  const host = hostOf(url);
  return SITE_OF.find(([re]) => re.test(host))?.[1] ?? null;
}

/**
 * One key per post, so the same thread matches however it is linked:
 * Reddit threads by their id, Hacker News items by id, other pages without www, query or trailing slash.
 */
export function threadKey(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url.trim().toLowerCase();
  }
  const host = u.hostname.toLowerCase().replace(/^(www|old|new|m|np)\./, "");
  if (/(^|\.)reddit\.com$/.test(host) || host === "redd.it") {
    const id = u.pathname.match(/\/comments\/([a-z0-9]+)/i)?.[1] ?? (host === "redd.it" ? u.pathname.slice(1).split("/")[0] : null);
    if (id) return `reddit:${id.toLowerCase()}`;
  }
  if (host === "news.ycombinator.com" && u.searchParams.get("id")) return `hn:${u.searchParams.get("id")}`;
  return `${host}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
}

/** Who posted it, when the link says: the subreddit, the X handle or the LinkedIn profile. */
export function authorOf(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  if (/(^|\.)reddit\.com$/.test(host) && parts[0] === "r" && parts[1]) return `r/${parts[1]}`;
  if (/(^|\.)(x|twitter)\.com$/.test(host) && parts[0] && !["i", "search", "hashtag", "home", "explore"].includes(parts[0])) return `@${parts[0]}`;
  if (/(^|\.)linkedin\.com$/.test(host) && parts[0] === "posts" && parts[1]) return parts[1].split("_")[0] || null;
  return null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when the text names the brand, or its domain, as a whole word. "Notion" matches "Notion's", never "notional". */
export function namesBrand(text: string, name: string, domain?: string | null): boolean {
  const t = text.toLowerCase();
  const terms = [name.trim().toLowerCase(), (domain ?? "").trim().toLowerCase().replace(/^www\./, "")].filter((x) => x.length >= 2);
  return terms.some((term) => new RegExp(`(^|[^a-z0-9])${escape(term)}(?![a-z0-9])`, "i").test(t));
}

/** Keys of every page the AI answers cited, for "AI cites" on a mention. */
export function citedKeys(chats: { sources: { url: string }[] }[]): Set<string> {
  const keys = new Set<string>();
  for (const c of chats) for (const s of c.sources ?? []) if (s?.url) keys.add(threadKey(s.url));
  return keys;
}

export const POSITIVE = 60; // sentiment at or above this is positive
export const NEGATIVE = 40; // at or below this is negative

export type VoiceRow = {
  name: string;
  isYou: boolean;
  mentions: number;
  before: number; // mentions in the period before
  share: number; // % of all mentions in the period
  positive: number; // % of this name's scored mentions
  negative: number;
  sentiment: number | null; // average
  topSource: SocialSource | null;
  cited: number; // mentions in threads AI cites
};

/** Share of voice for each tracked name: mentions, change, warmth, where they happen and how many AI cites. */
export function shareOfVoice(names: { name: string; isYou: boolean }[], now: Mention[], before: Mention[], cited: Set<string>): VoiceRow[] {
  const key = (s: string) => s.toLowerCase();
  const total = now.length;
  return names
    .map(({ name, isYou }) => {
      const mine = now.filter((m) => key(m.name) === key(name));
      const scored = mine.map((m) => m.sentiment).filter((s): s is number => s !== null);
      const bySource = new Map<SocialSource, number>();
      for (const m of mine) bySource.set(m.source, (bySource.get(m.source) ?? 0) + 1);
      return {
        name,
        isYou,
        mentions: mine.length,
        before: before.filter((m) => key(m.name) === key(name)).length,
        share: total ? (mine.length / total) * 100 : 0,
        positive: scored.length ? (scored.filter((s) => s >= POSITIVE).length / scored.length) * 100 : 0,
        negative: scored.length ? (scored.filter((s) => s <= NEGATIVE).length / scored.length) * 100 : 0,
        sentiment: scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null,
        topSource: [...bySource.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
        cited: mine.filter((m) => cited.has(threadKey(m.url))).length,
      };
    })
    .sort((a, b) => Number(b.isYou) - Number(a.isYou) || b.mentions - a.mentions);
}

/** The competitors to track: the editor's picks if any, else the top ones AI names, up to the plan's limit. You are never one of them. */
export function pickTargets(ranked: { name: string; domain: string | null }[], you: string, limit: number, picks?: string[] | null) {
  const others = ranked.filter((r) => r.name.trim() && r.name.toLowerCase() !== you.toLowerCase());
  const chosen = picks?.length ? picks.map((p) => others.find((r) => r.name.toLowerCase() === p.toLowerCase()) ?? { name: p, domain: null }) : others;
  const seen = new Set<string>();
  return chosen.filter((r) => r.name.toLowerCase() !== you.toLowerCase() && !seen.has(r.name.toLowerCase()) && seen.add(r.name.toLowerCase())).slice(0, Math.max(0, limit));
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const AGO = /^(\d+)\s+(minute|min|hour|hr|day|week|month)s?\s+ago\b/i;
const ON = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})\b/;
const UNIT: Record<string, number> = { minute: 6e4, min: 6e4, hour: 36e5, hr: 36e5, day: 864e5, week: 6048e5, month: 2592e6 };

/**
 * Google starts many snippets with the post's date: "3 days ago — text" or "Oct 12, 2026 — text".
 * Returns the date (ISO) when there is one, and the snippet without it.
 */
export function splitSnippetDate(snippet: string, now = Date.now()): { at: string | null; text: string } {
  const s = snippet.trim();
  const dash = s.match(/^(.{3,24}?)\s+[—–-]\s+/);
  if (!dash) return { at: null, text: s };
  const head = dash[1];
  const rest = s.slice(dash[0].length);
  const ago = head.match(AGO);
  if (ago) return { at: new Date(now - Number(ago[1]) * UNIT[ago[2].toLowerCase()]).toISOString(), text: rest };
  const on = head.match(ON);
  const month = on ? MONTHS.indexOf(on[1].toLowerCase()) : -1;
  if (on && month >= 0) return { at: new Date(Date.UTC(Number(on[3]), month, Number(on[2]))).toISOString(), text: rest };
  return { at: null, text: s };
}
