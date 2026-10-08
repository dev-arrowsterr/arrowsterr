// A client report, frozen at the moment it was made. Used for the preview, the PDF and the share link.
import type { ContentRow } from "./reports.ts";

export type ReportSection = "ai" | "competitors" | "traffic" | "visitors" | "content";
export const SECTIONS: { id: ReportSection; label: string }[] = [
  { id: "ai", label: "AI visibility" },
  { id: "competitors", label: "Competitors" },
  { id: "traffic", label: "Traffic" },
  { id: "visitors", label: "Visitors" },
  { id: "content", label: "Content" },
];

export type ReportStyle = { agency: string; logo: string; color: string };

export type ReportSnapshot = {
  brand: { name: string; domain: string; logo: string };
  style: ReportStyle;
  days: number;
  at: string;
  sections: ReportSection[];
  summary: { headline: string; points: string[]; next: string[] } | null;
  ai: {
    visibility: number;
    visibilityBefore: number | null;
    sentiment: number | null;
    position: number | null;
    rank: number | null;
    brands: number;
    answers: number;
    byModel: { engine: string; now: number | null; before: number | null }[];
  } | null;
  competitors: { name: string; domain: string | null; visibility: number; sentiment: number | null; position: number | null; isYou: boolean }[] | null;
  traffic: { visits: number; visitsBefore: number; ai: number; aiBefore: number; byEngine: { engine: string; visits: number; prev: number }[] } | null;
  visitors: { total: number; hot: number; actions: number; top: { name: string; emoji: string; score: number; label: string; source: string }[] } | null;
  content: { published: number; writing: number; briefs: number; planned: number; pages: ContentRow[] } | null;
  wins: { text: string; change: number; unit: string; area: string }[];
  drops: { text: string; change: number; unit: string; area: string }[];
};

/** A frozen copy of the Prompts page, for a share link. */
export type PromptsSnapshot = {
  kind: "prompts";
  brand: { name: string; domain: string; logo?: string };
  days: number;
  at: string;
  engines: string[];
  scores: { visibility: number; sentiment: number | null; position: number | null; rank: number | null; of: number | null } | null;
  topics: {
    name: string;
    visibility: number | null;
    byEngine: Record<string, number | null>;
    prompts: { prompt: string; visibility: number | null; ranks: Record<string, number | null>; at: string | null }[];
  }[];
};
