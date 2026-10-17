import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { startArticleResearch } from "./articleResearchServer";
import { loadBrandContext } from "./brandContext";
import { askJson, claudeModel } from "./claude";
import { domainOf } from "./sources";
import { enqueue, finish, retry, type Job } from "./jobs";
import { BRIEF_SCHEMA, drive, runBrief, type BriefDeps, type BriefRow, type BriefStore, type ResearchPack, type WriterContext } from "./writerBrief";
import { CHECK_SCHEMA, requestDraft, runDraft, SECTION_SCHEMA, type DraftAsk, type DraftDeps, type DraftRow, type DraftStore, type QuotaStore } from "./writerDraft";
import { MODULE_SCHEMA } from "./writerModules";

// The database and paid calls behind the Agentic Writer (writerBrief.ts, writerDraft.ts) and its two jobs:
// writer_brief (waits for the article research, then writes the brief) and writer_draft (sections, check, modules, doc).

/** The model every writer call uses. Sonnet 5.5 unless WRITER_MODEL says otherwise. */
export const writerModel = () => process.env.WRITER_MODEL?.trim() || claudeModel();

const must = <T>(r: { data: T; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message + (/writer_/.test(r.error.message) ? " Run supabase/050_agentic_writer.sql in Supabase." : ""));
  return r.data;
};
const stamp = () => new Date().toISOString();

// ─────────────── stores ───────────────
export function briefStore(db: SupabaseClient): BriefStore {
  return {
    brief: async (id) => must(await db.from("writer_briefs").select("*").eq("id", id).maybeSingle()) as BriefRow | null,
    update: async (id, patch) => void must(await db.from("writer_briefs").update({ ...patch, updated_at: stamp() }).eq("id", id)),
  };
}

export function draftStore(db: SupabaseClient): DraftStore {
  return {
    draft: async (id) => must(await db.from("writer_drafts").select("*").eq("id", id).maybeSingle()) as DraftRow | null,
    brief: briefStore(db).brief,
    update: async (id, patch) => void must(await db.from("writer_drafts").update({ ...patch, updated_at: stamp() }).eq("id", id)),
    async saveDoc(d, doc, at) {
      type DocRow = { id: string; meta: Record<string, unknown> | null };
      let mine: DocRow | null = null;
      if (d.doc_id) mine = must(await db.from("docs").select("id, meta").eq("id", d.doc_id).maybeSingle()) as DocRow | null;
      if (!mine) {
        // A topic has one doc. One this draft made before a crash is reused; an older hand-made one keeps its text
        // and steps aside, so the draft never writes over it.
        const there = must(await db.from("docs").select("id, meta").eq("calendar_item_id", d.item_id).maybeSingle()) as DocRow | null;
        if (there?.meta?.writer_draft_id === d.id) mine = there;
        else if (there) must(await db.from("docs").update({ calendar_item_id: null }).eq("id", there.id));
      }
      const meta = { ...doc.meta, ...(mine?.meta ?? {}), status: "ready", writer_draft_id: d.id };
      const row = { title: doc.title, content: doc.content, words: doc.words, meta, updated_at: at };
      if (mine) {
        must(await db.from("docs").update(row).eq("id", mine.id));
        return mine.id;
      }
      const made = must(await db.from("docs").insert({ ...row, workspace_id: d.workspace_id, site_id: d.site_id, calendar_item_id: d.item_id, created_by: null }).select("id").single()) as { id: string };
      return made.id;
    },
  };
}

export function quotaStore(db: SupabaseClient): QuotaStore {
  return {
    draftFor: async (itemId) => must(await db.from("writer_drafts").select("id, status, doc_id, ready_at, version").eq("item_id", itemId).maybeSingle()),
    async editedByHand(d) {
      if (!d.doc_id || !d.ready_at) return false;
      const doc = must(await db.from("docs").select("updated_at").eq("id", d.doc_id).maybeSingle()) as { updated_at: string } | null;
      return Boolean(doc && Date.parse(doc.updated_at) > Date.parse(d.ready_at) + 1000);
    },
    async take(row, limit) {
      const rows = must(
        await db.rpc("writer_take_draft", { p_workspace: row.workspace_id, p_brand: row.brand_id, p_site: row.site_id, p_item: row.item_id, p_brief: row.brief_id, p_period: row.period, p_limit: limit, p_user: row.created_by }),
      ) as { draft_id: string | null; outcome: "created" | "exists" | "full" }[] | null;
      const r = rows?.[0];
      return { outcome: r?.outcome ?? "full", id: r?.draft_id ?? null };
    },
    async regenerate(id, patch) {
      const cur = must(await db.from("writer_drafts").select("version").eq("id", id).single()) as { version: number };
      const version = cur.version + 1;
      must(
        await db
          .from("writer_drafts")
          .update({ ...patch, version, status: "generating", step: "sections", sections: [], checked: null, check_at: null, modules: [], error: null, started_at: stamp(), updated_at: stamp() })
          .eq("id", id)
          .eq("version", cur.version),
      );
      return version;
    },
  };
}

// ─────────────── the research and the brand ───────────────
type PageRow = { url: string; final_url: string | null; title: string | null; source: "serp" | "ai"; position: number | null; word_count: number | null; headings: { text: string }[] | null; body: string | null };

/** What the research saved for a run: the pages read, People Also Ask, AI Overview and the AI answers. */
export async function loadResearch(db: SupabaseClient, runId: string): Promise<ResearchPack> {
  const [run, pages, answers] = await Promise.all([
    db.from("article_runs").select("keyword, paa, ai_overview").eq("id", runId).maybeSingle(),
    db.from("article_pages").select("url, final_url, title, source, position, word_count, headings, body").eq("run_id", runId).eq("status", "done").order("position", { ascending: true, nullsFirst: false }),
    db.from("article_ai_answers").select("engine, answer, cited").eq("run_id", runId),
  ]);
  const r = must(run) as { keyword: string; paa: { question: string; answer: string | null }[]; ai_overview: { text?: string } | null } | null;
  if (!r) throw new Error("The research for this topic was deleted.");
  return {
    keyword: r.keyword,
    pages: ((must(pages) ?? []) as PageRow[]).map((p) => ({
      url: p.url,
      title: p.title,
      domain: domainOf(p.final_url || p.url).replace(/^www\./, ""),
      kind: p.source,
      position: p.position,
      words: p.word_count ?? 0,
      headings: (p.headings ?? []).map((h) => h.text).filter(Boolean),
      body: p.body ?? "",
    })),
    questions: (r.paa ?? []).map((q) => ({ question: q.question, answer: q.answer ?? null })),
    aiOverview: r.ai_overview?.text ?? "",
    answers: ((must(answers) ?? []) as { engine: string; answer: string | null; cited: { url: string }[] | null }[])
      .filter((a) => a.answer)
      .map((a) => ({ engine: a.engine, text: a.answer!, cited: (a.cited ?? []).map((c) => c.url) })),
  };
}

/** The brand, its voice, kit and guidelines, and its sitemap for internal links. */
export async function loadWriterContext(db: SupabaseClient, siteId: string, brandId: string | null): Promise<WriterContext> {
  const site = must(await db.from("sites").select("name, domain, brand_id, pages").eq("id", siteId).maybeSingle()) as { name: string; domain: string; brand_id: string | null; pages: { url: string }[] | null } | null;
  if (!site) throw new Error("This topic's website was deleted.");
  const id = brandId ?? site.brand_id;
  const brand = id ? ((must(await db.from("brands").select("name, domain").eq("id", id).maybeSingle()) as { name: string; domain: string } | null) ?? null) : null;
  const ctx = id ? await loadBrandContext(db, id) : { voice: null, kit: null, guidelines: null };
  return {
    brand: { name: brand?.name || site.name, domain: (brand?.domain || site.domain).replace(/^https?:\/\//, "").replace(/\/.*$/, "") },
    ...ctx,
    sitemap: (Array.isArray(site.pages) ? site.pages : []).map((p) => p?.url).filter((u): u is string => typeof u === "string").slice(0, 400),
  };
}

// ─────────────── paid calls ───────────────
const briefDeps = (db: SupabaseClient): BriefDeps => ({
  startResearch: async (b) => (await startArticleResearch(db, { workspaceId: b.workspace_id, itemId: b.item_id })).runId,
  runStatus: async (runId) => must(await db.from("article_runs").select("status, error").eq("id", runId).maybeSingle()),
  research: (runId) => loadResearch(db, runId),
  context: (b) => loadWriterContext(db, b.site_id, b.brand_id),
  write: (prefix, prompt) => askJson(prompt, BRIEF_SCHEMA, { prefix, model: writerModel(), maxTokens: 8000 }),
  model: writerModel(),
});

const draftDeps = (db: SupabaseClient): DraftDeps => ({
  async context(d, b) {
    if (!b.research_run_id) throw new Error("The brief behind this draft has no research.");
    const [ctx, pack] = await Promise.all([loadWriterContext(db, d.site_id, d.brand_id), loadResearch(db, b.research_run_id)]);
    return { ctx, pack };
  },
  writeSection: (prefix, prompt) => askJson(prompt, SECTION_SCHEMA, { prefix, model: writerModel(), maxTokens: 4000 }),
  check: (prefix, prompt) => askJson(prompt, CHECK_SCHEMA, { prefix, model: writerModel(), maxTokens: 3000 }),
  buildModule: (prefix, prompt) => askJson(prompt, MODULE_SCHEMA, { prefix, model: writerModel(), maxTokens: 12000 }),
  model: writerModel(),
});

// ─────────────── the queue ───────────────
/** Make sure a brief or draft has a live job for its version. A job that died is woken up again. */
async function queue(db: SupabaseClient, kind: "writer_brief" | "writer_draft", payload: { id: string; version: number }, workspaceId: string) {
  const key = `${kind}:${payload.id}:${payload.version}`;
  const made = await enqueue(kind, payload, { workspaceId, key, maxAttempts: 4 });
  if (made !== null) return;
  await db.from("jobs").update({ status: "queued", attempts: 0, run_at: stamp(), finished_at: null, last_error: null }).eq("key", key).in("status", ["dead", "done"]);
}

/**
 * Generate Brief, or Regenerate it with a note. The topic's research is started (or reused) by the job.
 * An approved brief is locked; a brief being written is left alone.
 */
export async function startBrief(
  db: SupabaseClient,
  opts: { workspaceId: string; item: { id: string; site_id: string; keyword: string }; userId: string | null; note?: string | null },
): Promise<{ ok: true; briefId: string } | { ok: false; status: number; error: string }> {
  const have = must(await db.from("writer_briefs").select("id, status, version").eq("item_id", opts.item.id).maybeSingle()) as { id: string; status: string; version: number } | null;
  if (have?.status === "approved") return { ok: false, status: 409, error: "This brief is approved. Regenerate the draft instead." };
  if (have?.status === "generating") {
    await queue(db, "writer_brief", { id: have.id, version: have.version }, opts.workspaceId);
    return { ok: true, briefId: have.id };
  }
  const note = opts.note?.trim().slice(0, 300) || null;
  if (have) {
    const version = have.version + 1;
    // The research stays: a regenerated brief never pays for it again.
    must(await db.from("writer_briefs").update({ status: "generating", step: "research", version, note, error: null, updated_at: stamp() }).eq("id", have.id).eq("version", have.version));
    await queue(db, "writer_brief", { id: have.id, version }, opts.workspaceId);
    return { ok: true, briefId: have.id };
  }
  const site = must(await db.from("sites").select("brand_id").eq("id", opts.item.site_id).maybeSingle()) as { brand_id: string | null } | null;
  const { data, error } = await db
    .from("writer_briefs")
    .insert({ workspace_id: opts.workspaceId, brand_id: site?.brand_id ?? null, site_id: opts.item.site_id, item_id: opts.item.id, keyword: opts.item.keyword, note, created_by: opts.userId })
    .select("id")
    .single();
  if (error?.code === "23505") return startBrief(db, opts); // two clicks at once: use the one that won
  const made = must({ data, error }) as { id: string };
  await queue(db, "writer_brief", { id: made.id, version: 1 }, opts.workspaceId);
  return { ok: true, briefId: made.id };
}

/** Generate Draft or Regenerate it, counted against the brand's month (see requestDraft). */
export async function startDraft(db: SupabaseClient, ask: DraftAsk) {
  const out = await requestDraft(quotaStore(db), ask);
  if (out.ok) await queue(db, "writer_draft", { id: out.draftId, version: out.version }, ask.brief.workspace_id);
  return out;
}

// ─────────────── the jobs ───────────────
const Q = { finish, retry: (id: number, why: string, seconds: number, opts: { count: boolean }) => retry(id, why, seconds, opts) };
const payloadOf = (job: Job) => job.payload as { id?: string; version?: number };

/** writer_brief: wait for the article research without using up attempts, then write the brief. */
export async function writerBriefJob(db: SupabaseClient, job: Job) {
  const { id = "", version } = payloadOf(job);
  await drive(job, Q, () => runBrief(briefStore(db), briefDeps(db), id, version), async (error) => {
    await db.from("writer_briefs").update({ status: "failed", error: error.slice(0, 1000), updated_at: stamp() }).eq("id", id).eq("status", "generating");
  });
}

/** writer_draft: a few steps per turn (sections, check, modules, doc), each saved, until the draft is ready. */
export async function writerDraftJob(db: SupabaseClient, job: Job) {
  const { id = "", version } = payloadOf(job);
  await drive(job, Q, () => runDraft(draftStore(db), draftDeps(db), id, version), async (error) => {
    await db.from("writer_drafts").update({ status: "failed", error: error.slice(0, 1000), updated_at: stamp() }).eq("id", id).eq("status", "generating");
  });
}
