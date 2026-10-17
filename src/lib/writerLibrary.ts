// The Agentic Writer's lists, read by the browser as the signed-in member (050 lets members read).
// Topics are calendar items imported into the writer; the Library holds every brief and draft of a brand.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BriefStatus, WriterBrief } from "./writerBrief.ts";
import type { DraftStatus, ModuleState, Section } from "./writerDraft.ts";

const NOT_RUN = "Run supabase/050_agentic_writer.sql in Supabase.";
const check = <T>(r: { data: T; error: { message: string } | null }) => {
  if (r.error) throw new Error(/writer_/.test(r.error.message) ? NOT_RUN : r.error.message);
  return r.data;
};

/** When a topic went into the writer, or null. The older "Write now" mark counts too. */
export function inWriterAt(extra: Record<string, unknown> | null | undefined): string | null {
  const v = extra?.in_writer_at ?? extra?.write_queued_at;
  return typeof v === "string" && v ? v : null;
}

export type BriefLite = { id: string; item_id: string; status: BriefStatus; step: "research" | "writing" | "done"; error: string | null; version: number; research_run_id: string | null; title: string | null; updated_at: string };
export type DraftLite = { id: string; item_id: string; brief_id: string; doc_id: string | null; status: DraftStatus; step: string; error: string | null; version: number; words: number; ready_at: string | null; updated_at: string };
export type Topic = {
  id: string;
  keyword: string;
  stage: "bofu" | "mofu" | "tofu" | null;
  due_date: string | null;
  added: string;
  brief: BriefLite | null;
  draft: DraftLite | null;
};

const BRIEF_COLS = "id, item_id, status, step, error, version, research_run_id, updated_at, title:brief->>h1";
const DRAFT_COLS = "id, item_id, brief_id, doc_id, status, step, error, version, words, ready_at, updated_at";

/** The brand's topics in the writer, newest first, with their brief and draft. */
export async function listTopics(sb: SupabaseClient, siteId: string): Promise<Topic[]> {
  const items = check(
    await sb.from("calendar_items").select("id, keyword, stage, due_date, extra").eq("site_id", siteId).or("extra->>in_writer_at.not.is.null,extra->>write_queued_at.not.is.null"),
  ) as { id: string; keyword: string; stage: Topic["stage"]; due_date: string | null; extra: Record<string, unknown> | null }[];
  const ids = items.map((i) => i.id);
  if (!ids.length) return [];
  const [briefs, drafts] = await Promise.all([sb.from("writer_briefs").select(BRIEF_COLS).in("item_id", ids), sb.from("writer_drafts").select(DRAFT_COLS).in("item_id", ids)]);
  const b = (check(briefs) ?? []) as unknown as BriefLite[];
  const d = (check(drafts) ?? []) as unknown as DraftLite[];
  return items
    .map((i) => ({ id: i.id, keyword: i.keyword, stage: i.stage, due_date: i.due_date, added: inWriterAt(i.extra) ?? "", brief: b.find((x) => x.item_id === i.id) ?? null, draft: d.find((x) => x.item_id === i.id) ?? null }))
    .sort((x, y) => y.added.localeCompare(x.added));
}

export type FullBrief = BriefLite & { keyword: string; brief: WriterBrief | null; notes: string; note: string | null; approved_at: string | null };
export const getBrief = async (sb: SupabaseClient, id: string) =>
  check(await sb.from("writer_briefs").select("id, item_id, status, step, error, version, research_run_id, updated_at, keyword, brief, notes, note, approved_at").eq("id", id).maybeSingle()) as FullBrief | null;

export type FullDraft = DraftLite & { sections: (Section | null)[]; modules: (ModuleState | null)[]; checked: unknown | null; note: string | null };
export const getDraft = async (sb: SupabaseClient, id: string) => check(await sb.from("writer_drafts").select(`${DRAFT_COLS}, sections, modules, checked, note`).eq("id", id).maybeSingle()) as FullDraft | null;

/** How far a research run is: its status, and pages read out of pages queued. */
export async function researchProgress(sb: SupabaseClient, runId: string): Promise<{ status: string; read: number; total: number; error: string | null } | null> {
  const [run, pages] = await Promise.all([sb.from("article_runs").select("status, error").eq("id", runId).maybeSingle(), sb.from("article_pages").select("status").eq("run_id", runId)]);
  if (run.error || !run.data) return null;
  const list = (pages.data ?? []) as { status: string }[];
  return { status: run.data.status, error: run.data.error, read: list.filter((p) => p.status === "done").length, total: list.length };
}

// ─────────────── the Library ───────────────
export type LibraryRow = {
  key: string;
  kind: "Brief" | "Draft";
  id: string;
  doc_id: string | null;
  title: string;
  keyword: string;
  status: string;
  words: number | null;
  updated_at: string;
};

const STATUS: Record<string, string> = { generating: "Generating", ready: "Ready", approved: "Approved", failed: "Failed" };
export const statusLabel = (s: string) => STATUS[s] ?? s;

type Item = { keyword: string } | { keyword: string }[] | null;
const kw = (i: Item) => (Array.isArray(i) ? i[0]?.keyword : i?.keyword) ?? "";

/** Every brief and draft of the brand's site, newest first. */
export async function listLibrary(sb: SupabaseClient, siteId: string): Promise<LibraryRow[]> {
  const [briefs, drafts] = await Promise.all([
    sb.from("writer_briefs").select("id, status, updated_at, keyword, title:brief->>h1, target:brief->>wordTarget").eq("site_id", siteId),
    sb.from("writer_drafts").select("id, status, words, updated_at, doc_id, calendar_items(keyword), docs(title, words, updated_at)").eq("site_id", siteId),
  ]);
  type B = { id: string; status: string; updated_at: string; keyword: string; title: string | null; target: string | null };
  type Doc = { title: string; words: number; updated_at: string };
  type D = { id: string; status: string; words: number; updated_at: string; doc_id: string | null; calendar_items: Item; docs: Doc | Doc[] | null };
  const rows: LibraryRow[] = [
    ...((check(briefs) ?? []) as unknown as B[]).map((b) => ({
      key: `b:${b.id}`,
      kind: "Brief" as const,
      id: b.id,
      doc_id: null,
      title: b.title || b.keyword,
      keyword: b.keyword,
      status: statusLabel(b.status),
      words: b.target ? Number(b.target) || null : null,
      updated_at: b.updated_at,
    })),
    ...((check(drafts) ?? []) as unknown as D[]).map((d) => {
      const doc = Array.isArray(d.docs) ? d.docs[0] : d.docs;
      const later = doc && doc.updated_at > d.updated_at ? doc.updated_at : d.updated_at;
      return { key: `d:${d.id}`, kind: "Draft" as const, id: d.id, doc_id: d.doc_id, title: doc?.title || kw(d.calendar_items), keyword: kw(d.calendar_items), status: statusLabel(d.status), words: doc?.words ?? d.words, updated_at: later };
    }),
  ];
  return rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}
