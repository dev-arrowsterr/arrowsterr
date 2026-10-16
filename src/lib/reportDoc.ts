// A saved report's layout (docs/reports.md, sections 5 and 22). Phase 1: the client report's blocks, in order,
// each on or off, plus the AI summary saved for one period. Pure, shared by the server, the browser and tests.
import type { ReportSection } from "./reportTypes.ts";

/** The client report's blocks between the cover and the footer, which always show. */
export type BlockId = "kpis" | "summary" | "wins" | "models" | "competitors" | "traffic" | "visitors" | "content";
export const BLOCKS: { id: BlockId; label: string; website?: boolean }[] = [
  { id: "kpis", label: "AI scorecard" },
  { id: "summary", label: "AI summary" },
  { id: "wins", label: "Wins and watch list" },
  { id: "models", label: "Visibility on each AI" },
  { id: "competitors", label: "Who AI recommends" },
  { id: "traffic", label: "Website traffic", website: true },
  { id: "visitors", label: "Visitors and leads", website: true },
  { id: "content", label: "Content" },
];
const IDS = new Set<string>(BLOCKS.map((b) => b.id));

export type DocBlock = { id: BlockId; on: boolean };
export type SavedSummary = { headline: string; points: string[]; next: string[]; key: string; at: string };
export type ReportDocument = { v: 1; blocks: DocBlock[]; summary: SavedSummary | null };

export type Kind = "client" | "prompts" | "competitors" | "intel";
export const KIND_LABEL: Record<Kind, string> = { client: "Client report", prompts: "AI Visibility", competitors: "Competitors", intel: "Content Intelligence" };

export const DEFAULT_DOC: ReportDocument = { v: 1, blocks: BLOCKS.map((b) => ({ id: b.id, on: true })), summary: null };

/** Clean a doc from the database: unknown blocks go, missing ones come back switched off, each block once. */
export function parseDoc(x: unknown): ReportDocument {
  const d = (x && typeof x === "object" ? x : {}) as Partial<ReportDocument>;
  const seen = new Set<string>();
  const blocks: DocBlock[] = [];
  for (const b of Array.isArray(d.blocks) ? d.blocks : DEFAULT_DOC.blocks) {
    if (!b || typeof b !== "object" || !IDS.has(String(b.id)) || seen.has(String(b.id))) continue;
    seen.add(String(b.id));
    blocks.push({ id: b.id as BlockId, on: b.on !== false });
  }
  for (const b of BLOCKS) if (!seen.has(b.id)) blocks.push({ id: b.id, on: !Array.isArray(d.blocks) });
  const s = d.summary;
  const summary =
    s && typeof s === "object" && typeof s.headline === "string" && typeof s.key === "string"
      ? { headline: s.headline, points: (s.points ?? []).filter((p): p is string => typeof p === "string"), next: (s.next ?? []).filter((p): p is string => typeof p === "string"), key: s.key, at: String(s.at ?? "") }
      : null;
  return { v: 1, blocks, summary };
}

/** Move a block up (-1) or down (+1). */
export function moveBlock(doc: ReportDocument, id: BlockId, by: -1 | 1): ReportDocument {
  const i = doc.blocks.findIndex((b) => b.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= doc.blocks.length) return doc;
  const blocks = [...doc.blocks];
  [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  return { ...doc, blocks };
}

export const toggleBlock = (doc: ReportDocument, id: BlockId): ReportDocument => ({ ...doc, blocks: doc.blocks.map((b) => (b.id === id ? { ...b, on: !b.on } : b)) });

/** Links made before saved reports listed sections. Turn them into blocks in the old fixed order. */
export function blocksFromSections(sections: ReportSection[] | undefined): DocBlock[] {
  const has = (s: ReportSection) => !sections || sections.includes(s);
  return BLOCKS.map((b) => ({
    id: b.id,
    on: b.id === "kpis" || b.id === "models" ? has("ai") : b.id === "summary" || b.id === "wins" ? true : has(b.id as ReportSection),
  }));
}

/** Templates in the library (docs/reports.md, section 3.2). */
export type Template = { id: string; kind: Kind; name: string; text: string; tab: "ai" | "content"; doc?: ReportDocument };
export const TEMPLATES: Template[] = [
  { id: "monthly", kind: "client", name: "Monthly client report", text: "Every section in one branded report.", tab: "ai", doc: DEFAULT_DOC },
  { id: "onepager", kind: "client", name: "Executive one-pager", text: "Scorecard, summary, wins and watch list.", tab: "ai", doc: { v: 1, blocks: BLOCKS.map((b) => ({ id: b.id, on: ["kpis", "summary", "wins"].includes(b.id) })), summary: null } },
  { id: "prompts", kind: "prompts", name: "AI Visibility report", text: "Every prompt, every AI and each full answer.", tab: "ai" },
  { id: "competitors", kind: "competitors", name: "Competitor report", text: "Who AI names most, and where each brand sits.", tab: "ai" },
  { id: "intel", kind: "intel", name: "Content performance", text: "How every page performs and which to update next.", tab: "content" },
];
