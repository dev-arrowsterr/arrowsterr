"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import { currentSupabase } from "@/lib/supa";
import type { View } from "@/lib/view";
import { getBrief, getDraft, listTopics, type FullBrief, type FullDraft, type Topic } from "@/lib/writerLibrary";
import { Confirm } from "../reports/Dialog";
import { post, StageTag } from "../research/shared";
import { Sheet, type Col } from "../Sheet";
import { ToolIntro } from "../ToolIntro";
import { Thinking } from "../ui";
import { BriefProgress, DraftProgress, openInLibrary, RegenerateDialog, StateTag, useBrandSite, usePoll } from "./parts";
import { WriterBriefView } from "./WriterBriefView";

// The Agentic Writer: topics imported from the Editorial Calendar. For each one: Generate Brief, read it,
// approve it, then Generate Draft. Finished briefs and drafts live in the Library.

const day = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
const busy = (t: Topic) => t.brief?.status === "generating" || t.draft?.status === "generating";

export function AgenticWriterPage({ view, auth, canEdit }: { view: View; auth: RunAuth; canEdit: boolean }) {
  const [sb] = useState(() => currentSupabase());
  const brand = view.brand;
  const { site, error: siteError } = useBrandSite(sb, brand, canEdit);
  const [rows, setRows] = useStash<Topic[] | null>(`writer:${brand.id}:rows`, null);
  const [openId, setOpenId] = useStash<string | null>(`writer:${brand.id}:open`, null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!site) return;
    try {
      setRows(await listTopics(sb, site.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows((r) => r ?? []);
    }
  }, [sb, site, setRows]);
  useEffect(() => {
    // Loading the topics once the brand's website is known is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  usePoll(Boolean(rows?.some(busy)), 5000, load);

  const cols = useMemo<Col<Topic>[]>(
    () => [
      { id: "keyword", label: "Keyword", type: "text", width: 300, value: (t) => t.keyword, cell: (t) => <span className="font-medium text-ink">{t.keyword}</span> },
      { id: "stage", label: "Stage", type: "list", width: 90, value: (t) => t.stage?.toUpperCase() ?? "", cell: (t) => <StageTag stage={t.stage} /> },
      { id: "date", label: "Date", type: "date", width: 130, value: (t) => t.due_date, cell: (t) => day(t.due_date) },
      { id: "brief", label: "Brief", type: "list", width: 120, value: (t) => t.brief?.status ?? "", cell: (t) => <StateTag status={t.brief?.status} /> },
      { id: "draft", label: "Draft", type: "list", width: 120, value: (t) => t.draft?.status ?? "", cell: (t) => <StateTag status={t.draft?.status} /> },
    ],
    [],
  );

  if (site === undefined || (site && rows === null)) return <Thinking text="Opening the Agentic Writer..." />;
  if (!site) return <p className="aw-error">{siteError || "This brand has no website yet."}</p>;

  const topic = openId ? (rows ?? []).find((t) => t.id === openId) : null;
  if (topic)
    return (
      <TopicView
        key={topic.id}
        auth={auth}
        brandId={brand.id}
        topic={topic}
        canEdit={canEdit}
        onChange={load}
        onBack={() => {
          setOpenId(null);
          load();
        }}
      />
    );

  const list = rows ?? [];
  return (
    <div className="flex flex-col gap-5">
      <h1 className="aw-h2">Agentic Writer</h1>
      {error ? <p className="aw-error">{error}</p> : null}
      {list.length ? (
        <Sheet<Topic> id={`writer:${site.id}`} label="Agentic Writer" rows={list} cols={cols} rowKey={(t) => t.id} onOpen={(t) => setOpenId(t.id)} height="calc(100vh - 210px)" tools={false} />
      ) : (
        <ToolIntro
          title="Agentic Writer"
          lead={`Send topics here from the Editorial Calendar. For each one, Arrowsterr researches Google and the AI answers, writes a brief with the interactive modules to build, and after you approve it, writes the draft in ${brand.name}'s voice.`}
          features={[
            { title: "Brief", text: "Outline, sources, FAQs, internal links and the modules to build, from the top pages and the AI answers." },
            { title: "Approve", text: "Read the brief, add notes, and approve it before any draft is written." },
            { title: "Draft", text: "Written section by section, every claim checked against the sources, with interactive modules in your brand." },
          ]}
        />
      )}
    </div>
  );
}

/** One topic: its brief (made, read, approved) and its draft. */
function TopicView({ auth, brandId, topic, canEdit, onChange, onBack }: { auth: RunAuth; brandId: string; topic: Topic; canEdit: boolean; onChange: () => void; onBack: () => void }) {
  const [sb] = useState(() => currentSupabase());
  const [brief, setBrief] = useState<FullBrief | null>(null);
  const [draft, setDraft] = useState<FullDraft | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [regen, setRegen] = useState<"brief" | "draft" | null>(null);
  const [removing, setRemoving] = useState(false);

  const briefId = topic.brief?.id ?? null;
  const draftId = topic.draft?.id ?? null;
  const load = useCallback(async () => {
    try {
      const [b, d] = await Promise.all([briefId ? getBrief(sb, briefId) : null, draftId ? getDraft(sb, draftId) : null]);
      setBrief(b);
      setDraft(d);
      setNotes((n) => (n === null ? (b?.notes ?? "") : n));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [sb, briefId, draftId]);
  useEffect(() => {
    // The brief and draft are loaded whenever the topic's ids change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, topic.brief?.status, topic.brief?.version, topic.draft?.status, topic.draft?.version]);
  const live = brief?.status === "generating" || draft?.status === "generating";
  usePoll(live, 4000, load);

  async function act(label: string, body: Record<string, unknown>) {
    setWorking(label);
    setError("");
    try {
      await post(auth, "/api/agentic-writer", body);
      onChange();
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setWorking("");
    }
  }
  const saveNotes = () => brief && notes !== null && notes !== brief.notes && act("notes", { action: "notes", briefId: brief.id, notes });

  const b = brief?.brief ?? null;
  const approved = brief?.status === "approved";
  const ready = brief?.status === "ready";

  // The one primary action for where the topic stands.
  let primary: React.ReactNode = null;
  if (canEdit) {
    if (!topic.brief || brief?.status === "failed")
      primary = (
        <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" disabled={Boolean(working)} onClick={() => act("brief", { action: "brief", itemId: topic.id })}>
          {working === "brief" ? "Starting..." : "Generate Brief"}
        </button>
      );
    else if (ready)
      primary = (
        <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" disabled={Boolean(working)} onClick={() => act("approve", { action: "approve", briefId: brief!.id })}>
          {working === "approve" ? "Approving..." : "Approve"}
        </button>
      );
    else if (approved && (!draft || draft.status === "failed"))
      primary = (
        <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" disabled={Boolean(working)} onClick={() => act("draft", { action: "draft", briefId: brief!.id })}>
          {working === "draft" ? "Starting..." : "Generate Draft"}
        </button>
      );
  }
  if (draft?.status === "ready")
    primary = (
      <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={() => openInLibrary(brandId, { kind: "draft", id: draft.id })}>
        Open in Library
      </button>
    );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <button type="button" className="aw-text-link shrink-0 text-[13px]" onClick={onBack}>
            ← Agentic Writer
          </button>
          <span className="truncate text-[15px] font-medium text-ink">{topic.keyword}</span>
          <StageTag stage={topic.stage} />
          {topic.due_date ? <span className="text-[12px] text-muted">{day(topic.due_date)}</span> : null}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {canEdit && ready ? (
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setRegen("brief")}>
              Regenerate brief
            </button>
          ) : null}
          {canEdit && draft?.status === "ready" ? (
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setRegen("draft")}>
              Regenerate draft
            </button>
          ) : null}
          {canEdit ? (
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setRemoving(true)}>
              Remove
            </button>
          ) : null}
          {primary}
        </span>
      </div>
      {error ? <p className="aw-error">{error}</p> : null}

      {brief?.status === "failed" && brief.error ? <p className="aw-error">{brief.error}</p> : null}
      {draft?.status === "failed" && draft.error ? <p className="aw-error">{draft.error}</p> : null}

      {brief?.status === "generating" ? (
        <section className="flex flex-col gap-2">
          <h2 className="aw-h4">Brief</h2>
          <BriefProgress sb={sb} brief={brief} />
        </section>
      ) : null}

      {draft?.status === "generating" ? (
        <section className="flex flex-col gap-2">
          <h2 className="aw-h4">Draft</h2>
          <DraftProgress draft={draft} brief={brief} />
        </section>
      ) : null}

      {b && brief && brief.status !== "generating" ? (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <WriterBriefView brief={b} />
          <aside className="flex flex-col gap-2 xl:sticky xl:top-[72px]" aria-label="Notes">
            <label htmlFor="brief-notes" className="aw-h4">
              Notes
            </label>
            <textarea
              id="brief-notes"
              className="aw-input aw-textarea min-h-[160px]"
              value={notes ?? ""}
              disabled={!canEdit || Boolean(draft && draft.status !== "failed")}
              maxLength={4000}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
            />
            {canEdit && notes !== null && notes !== brief.notes ? (
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm self-end" disabled={Boolean(working)} onClick={saveNotes}>
                {working === "notes" ? "Saving..." : "Save notes"}
              </button>
            ) : null}
            {approved ? <span className="text-[12px] text-muted">Approved {brief.approved_at ? day(brief.approved_at) : ""}</span> : null}
          </aside>
        </div>
      ) : null}

      {regen && brief ? (
        <RegenerateDialog
          auth={auth}
          kind={regen}
          briefId={brief.id}
          itemId={topic.id}
          onClose={() => setRegen(null)}
          onStarted={() => {
            setRegen(null);
            onChange();
            load();
          }}
        />
      ) : null}
      {removing ? (
        <Confirm
          title="Remove from the writer?"
          text={`"${topic.keyword}" leaves the Agentic Writer. Its brief and draft stay in the Library.`}
          action="Remove"
          busy={working === "remove"}
          error={error}
          onClose={() => setRemoving(false)}
          onConfirm={async () => {
            if (!(await act("remove", { action: "remove", itemId: topic.id }))) return;
            setRemoving(false);
            onBack();
          }}
        />
      ) : null}
    </div>
  );
}
