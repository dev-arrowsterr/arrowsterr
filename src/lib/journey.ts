// Visitors and buyer journeys from Umami data. Pure functions, shared by the server, the browser and tests.
import { aiSourceOf } from "./aiSources.ts";
import { persona } from "./names.ts";

export type Step = { at: string; visitId: string | null; path: string | null; query: string | null; referrer: string | null; title: string | null; event: string | null };
export type SessionInfo = {
  id: string;
  browser: string | null;
  os: string | null;
  device: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  firstAt: string;
  lastAt: string;
  visits: number;
  views: number;
};
export type SourceKind = "ai" | "search" | "social" | "referral" | "direct";
export type Label = "Hot" | "Warm" | "Cold";
export type Visitor = SessionInfo & {
  name: string;
  emoji: string;
  color: string;
  source: string;
  sourceKind: SourceKind;
  seconds: number;
  actions: string[];
  entry: string | null;
  intentPages: string[];
  score: number;
  label: Label;
  reasons: string[];
};
export type Visit = { id: string; start: string; end: string; seconds: number; source: string; sourceKind: SourceKind; steps: Step[] };

const SEARCH = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|yahoo\.[a-z.]+|baidu\.com|yandex\.[a-z.]+|ecosia\.org|search\.brave\.com|naver\.com|coccoc\.com)$/i;
const SOCIAL: [RegExp, string][] = [
  [/linkedin\.com|lnkd\.in/i, "LinkedIn"],
  [/facebook\.com|fb\.com|m\.facebook/i, "Facebook"],
  [/instagram\.com/i, "Instagram"],
  [/(^|\.)t\.co$|twitter\.com|(^|\.)x\.com$/i, "X"],
  [/reddit\.com/i, "Reddit"],
  [/youtube\.com|youtu\.be/i, "YouTube"],
  [/tiktok\.com/i, "TikTok"],
  [/pinterest\./i, "Pinterest"],
  [/news\.ycombinator\.com/i, "Hacker News"],
];
const INTENT: [RegExp, string][] = [
  [/pric|plans?\b/i, "Pricing"],
  [/demo/i, "Demo"],
  [/contact|get-in-touch/i, "Contact"],
  [/book|schedule|meeting|calendar/i, "Booking"],
  [/quote|estimate/i, "Quote"],
  [/trial|sign-?up|register|get-started|start/i, "Sign up"],
  [/checkout|cart/i, "Checkout"],
  [/case-stud|customers|testimonial|reviews/i, "Proof"],
];
export const KEY_ACTIONS = ["Form submit", "Booking click", "Email click", "Phone click", "CTA click"];

/** Where a visit came from, as a short name and a kind. */
export function sourceOf(referrer: string | null, ownDomain: string): { source: string; kind: SourceKind } {
  const d = (referrer ?? "").toLowerCase().replace(/^www\./, "");
  const own = ownDomain.toLowerCase().replace(/^www\./, "");
  if (!d || d === own || d.endsWith(`.${own}`)) return { source: "Direct", kind: "direct" };
  const ai = aiSourceOf(d);
  if (ai) return { source: ai, kind: "ai" };
  if (SEARCH.test(d)) return { source: d.split(".").find((p) => p !== "search" && p !== "www") ?.replace(/^./, (c) => c.toUpperCase()) ?? d, kind: "search" };
  const social = SOCIAL.find(([re]) => re.test(d));
  if (social) return { source: social[1], kind: "social" };
  return { source: d, kind: "referral" };
}

/** Split a visitor's steps into visits: by Umami's visit id, or a 30 minute gap when there is none. */
export function visitsOf(steps: Step[], ownDomain: string): Visit[] {
  const sorted = [...steps].sort((a, b) => a.at.localeCompare(b.at));
  const out: Visit[] = [];
  let cur: Step[] = [];
  const flush = () => {
    if (!cur.length) return;
    const first = cur.find((s) => s.referrer) ?? cur[0];
    const src = sourceOf(first.referrer, ownDomain);
    const start = cur[0].at;
    const end = cur[cur.length - 1].at;
    out.push({ id: cur[0].visitId ?? start, start, end, seconds: Math.max(0, (Date.parse(end) - Date.parse(start)) / 1000), source: src.source, sourceKind: src.kind, steps: cur });
    cur = [];
  };
  for (const s of sorted) {
    const last = cur[cur.length - 1];
    const newVisit = last && (s.visitId && last.visitId ? s.visitId !== last.visitId : Date.parse(s.at) - Date.parse(last.at) > 30 * 60_000);
    if (newVisit) flush();
    cur.push(s);
  }
  flush();
  return out;
}

/** How likely this visitor is to buy, 0 to 100, with the reasons. */
export function scoreOf(v: { sourceKind: SourceKind; source: string; intentPages: string[]; visits: number; views: number; seconds: number; actions: string[] }) {
  let score = 0;
  const reasons: string[] = [];
  const add = (n: number, why: string) => {
    score += n;
    reasons.push(`+${n} ${why}`);
  };
  if (v.sourceKind === "ai") add(20, `came from ${v.source}`);
  else if (v.sourceKind === "search") add(10, `came from ${v.source} search`);
  else if (v.sourceKind === "social") add(5, `came from ${v.source}`);
  if (v.intentPages.length) add(Math.min(30, v.intentPages.length * 15), `viewed ${v.intentPages.join(", ").toLowerCase()} pages`);
  if (v.visits >= 3) add(15, `came back ${v.visits - 1} times`);
  else if (v.visits === 2) add(10, "came back once");
  if (v.views >= 5) add(10, `viewed ${v.views} pages`);
  if (v.seconds >= 180) add(10, `spent ${Math.round(v.seconds / 60)} minutes`);
  if (v.actions.includes("Form submit")) add(35, "submitted a form");
  if (v.actions.includes("Booking click")) add(35, "opened a booking link");
  if (v.actions.includes("Email click") || v.actions.includes("Phone click")) add(15, "clicked to email or call");
  if (v.actions.includes("CTA click")) add(10, "clicked a call to action");
  score = Math.min(100, score);
  const label: Label = score >= 60 ? "Hot" : score >= 30 ? "Warm" : "Cold";
  return { score, label, reasons };
}

/** Everything the Visitors sheet shows for one visitor. */
export function summarize(s: SessionInfo, steps: Step[], ownDomain: string): Visitor {
  const visits = visitsOf(steps, ownDomain);
  const firstSource = visits.find((v) => v.sourceKind !== "direct") ?? visits[0];
  const paths = steps.filter((x) => !x.event && x.path).map((x) => x.path!);
  const intentPages = [...new Set(paths.flatMap((p) => INTENT.filter(([re]) => re.test(p)).map(([, n]) => n)))];
  const actions = [...new Set(steps.map((x) => x.event).filter((e): e is string => Boolean(e) && KEY_ACTIONS.includes(e!)))];
  const seconds = visits.reduce((n, v) => n + v.seconds, 0);
  const base = {
    ...s,
    visits: Math.max(s.visits, visits.length, 1),
    views: Math.max(s.views, paths.length),
    ...persona(s.id),
    source: firstSource?.source ?? "Direct",
    sourceKind: firstSource?.sourceKind ?? ("direct" as SourceKind),
    seconds,
    actions,
    entry: paths[0] ?? null,
    intentPages,
  };
  return { ...base, ...scoreOf(base) };
}
