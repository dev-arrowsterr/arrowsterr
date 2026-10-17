"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { docToMarkdown } from "@/lib/articles";
import { wordFile } from "@/lib/briefDoc";
import { getDoc, getGuideline, type Doc, type DocMeta, type Site } from "@/lib/db";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import { currentSupabase } from "@/lib/supa";
import type { View } from "@/lib/view";
import { getBrief, getDraft, listLibrary, type FullBrief, type FullDraft, type LibraryRow } from "@/lib/writerLibrary";
import type { BrandGuideline } from "@/lib/writerTypes";
import { PlainEditor, type SaveState } from "../content/PlainEditor";
import { Pop } from "../Pickers";
import { PublishPanel } from "../research/PublishPanel";
import { brandTables } from "../research/Writer";
import { exportClean } from "../research/writerNodes";
import { Sheet, type Col } from "../Sheet";
import { ToolIntro } from "../ToolIntro";
import { Thinking } from "../ui";
import { DraftProgress, libraryKey, RegenerateDialog, StateTag, useBrandSite, usePoll, type LibraryOpen } from "./parts";
import { WriterBriefView } from "./WriterBriefView";

// The Library: every brief and draft of the brand. A brief opens read-only; a draft opens in the plain editor,
// with its interactive modules running in sandboxed frames, Export and Publish.

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const STATE: Record<string, string> = { Generating: "generating", Ready: "ready", Approved: "approved", Failed: "failed" };

export function LibraryPage({ view, auth, canEdit }: { view: View; auth: RunAuth; canEdit: boolean }) {
  const [sb] = useState(() => currentSupabase());
  const brand = view.brand;
  const { site, error: siteError } = useBrandSite(sb, brand, canEdit);
  const [rows, setRows] = useStash<LibraryRow[] | null>(`library:${brand.id}:rows`, null);
  const [open, setOpen] = useStash<LibraryOpen>(libraryKey(brand.id), null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!site) return;
    try {
      setRows(await listLibrary(sb, site.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows((r) => r ?? []);
    }
  }, [sb, site, setRows]);
  useEffect(() => {
    // Loading the Library once the brand's website is known is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  usePoll(Boolean(!open && rows?.some((r) => r.status === "Generating")), 6000, load);

  const cols = useMemo<Col<LibraryRow>[]>(
    () => [
      { id: "kind", label: "Type", type: "list", width: 90, value: (r) => r.kind, cell: (r) => <span className={`aw-status ${r.kind === "Draft" ? "aw-status--ranked" : "aw-status--pending"}`}>{r.kind}</span> },
      { id: "title", label: "Title", type: "text", width: 340, value: (r) => r.title, cell: (r) => <span className="font-medium text-ink">{r.title}</span> },
      { id: "keyword", label: "Keyword", type: "text", width: 220, value: (r) => r.keyword },
      { id: "status", label: "Status", type: "list", width: 120, value: (r) => r.status, cell: (r) => <StateTag status={STATE[r.status] ?? r.status} /> },
      { id: "words", label: "Words", type: "number", width: 90, value: (r) => r.words },
      { id: "updated", label: "Updated", type: "date", width: 130, value: (r) => r.updated_at.slice(0, 10), cell: (r) => day(r.updated_at) },
    ],
    [],
  );

  if (site === undefined || (site && rows === null)) return <Thinking text="Opening the Library..." />;
  if (!site) return <p className="aw-error">{siteError || "This brand has no website yet."}</p>;

  const back = () => {
    setOpen(null);
    load();
  };
  if (open?.kind === "brief") return <BriefOnly key={open.id} sb={sb} id={open.id} onBack={back} />;
  if (open?.kind === "draft") return <DraftView key={open.id} sb={sb} auth={auth} site={site} id={open.id} canEdit={canEdit} onBack={back} />;

  const list = rows ?? [];
  return (
    <div className="flex flex-col gap-5">
      <h1 className="aw-h2">Library</h1>
      {error ? <p className="aw-error">{error}</p> : null}
      {list.length ? (
        <Sheet<LibraryRow>
          id={`library:${site.id}`}
          label="Library"
          rows={list}
          cols={cols}
          rowKey={(r) => r.key}
          sort={{ key: "updated", desc: true }}
          onOpen={(r) => setOpen({ kind: r.kind === "Brief" ? "brief" : "draft", id: r.id })}
          height="calc(100vh - 210px)"
          tools={false}
        />
      ) : (
        <ToolIntro title="Library" lead={`Every brief and draft the Agentic Writer makes for ${brand.name} lands here. Open a draft to edit it, export it or publish it to ${brand.name}'s site.`} />
      )}
    </div>
  );
}

function Back({ onBack, title, children }: { onBack: () => void; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-3">
        <button type="button" className="aw-text-link shrink-0 text-[13px]" onClick={onBack}>
          ← Library
        </button>
        <span className="truncate text-[15px] font-medium text-ink">{title}</span>
      </span>
      {children ? <span className="flex flex-wrap items-center gap-2">{children}</span> : null}
    </div>
  );
}

/** A brief, read-only. */
function BriefOnly({ sb, id, onBack }: { sb: SupabaseClient; id: string; onBack: () => void }) {
  const [brief, setBrief] = useState<FullBrief | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    getBrief(sb, id)
      .then((b) => live && setBrief(b))
      .catch(() => live && setBrief(null));
    return () => {
      live = false;
    };
  }, [sb, id]);
  if (brief === undefined) return <Thinking text="Opening the brief..." />;
  if (!brief) return <Back onBack={onBack} title="This brief was deleted." />;
  return (
    <div className="flex flex-col gap-5">
      <Back onBack={onBack} title={brief.brief?.h1 || brief.keyword}>
        <StateTag status={brief.status} />
      </Back>
      {brief.error ? <p className="aw-error">{brief.error}</p> : null}
      {brief.brief ? <WriterBriefView brief={brief.brief} /> : <p className="text-[14px] text-muted">The brief is still being written.</p>}
    </div>
  );
}

/** A draft: the plain editor with its modules, Export, Publish and Regenerate. */
function DraftView({ sb, auth, site, id, canEdit, onBack }: { sb: SupabaseClient; auth: RunAuth; site: Site; id: string; canEdit: boolean; onBack: () => void }) {
  const [draft, setDraft] = useState<FullDraft | null | undefined>(undefined);
  const [brief, setBrief] = useState<FullBrief | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [guideline, setGuideline] = useState<BrandGuideline | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [state, setState] = useState<{ s: SaveState; note?: string }>({ s: "saved" });
  const [title, setTitle] = useState("");
  const [words, setWords] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [regen, setRegen] = useState(false);
  const [exportAt, setExportAt] = useState<DOMRect | null>(null);
  const [error, setError] = useState("");
  const docRef = useRef<string | null>(null);
  const [docKey, setDocKey] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await getDraft(sb, id);
      setDraft(d);
      if (!d) return;
      if (!brief || brief.id !== d.brief_id) setBrief(await getBrief(sb, d.brief_id));
      // The doc loads once per version the job wrote, so the editor never jumps under someone typing.
      const stampOf = `${d.doc_id}:${d.ready_at}`;
      if (d.status === "ready" && d.doc_id && docRef.current !== stampOf) {
        const x = await getDoc(sb, d.doc_id);
        docRef.current = stampOf;
        setDocKey(stampOf);
        setDoc(x);
        setTitle(x.title);
        setWords(x.words);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [sb, id, brief]);
  useEffect(() => {
    // Loading the draft is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  usePoll(draft?.status === "generating", 4000, load);
  useEffect(() => {
    let live = true;
    getGuideline(sb, site.id)
      .then((g) => live && setGuideline(g))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sb, site.id]);

  const saved = useCallback((m: DocMeta) => {
    setTitle(m.title);
    setWords(m.words);
  }, []);
  const onState = useCallback((s: SaveState, note?: string) => setState({ s, note }), []);

  const html = () => brandTables(exportClean(editor?.getHTML() ?? ""), guideline);
  const name = (title || "article").replace(/\W+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "article";
  function download(file: string, body: string, type: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type }));
    a.download = file;
    a.click();
    URL.revokeObjectURL(a.href);
    setExportAt(null);
  }
  const exports = [
    { id: "html", label: "HTML", run: () => download(`${name}.html`, `<!doctype html><meta charset="utf-8"><title>${title}</title>\n${html()}`, "text/html") },
    { id: "md", label: "Markdown", run: () => editor && download(`${name}.md`, docToMarkdown(editor.getJSON()), "text/markdown") },
    { id: "doc", label: "Google Doc (.doc)", run: () => download(`${name}.doc`, wordFile(title, html()), "application/msword") },
  ];

  if (draft === undefined) return <Thinking text="Opening the draft..." />;
  if (!draft) return <Back onBack={onBack} title="This draft was deleted." />;
  const head = title || brief?.brief?.h1 || brief?.keyword || "Draft";

  if (draft.status !== "ready" || !doc)
    return (
      <div className="flex flex-col gap-5">
        <Back onBack={onBack} title={head}>
          <StateTag status={draft.status} />
          {canEdit && draft.status === "failed" && brief ? (
            <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={() => setRegen(true)}>
              Regenerate
            </button>
          ) : null}
        </Back>
        {draft.error ? <p className="aw-error">{draft.error}</p> : null}
        {error ? <p className="aw-error">{error}</p> : null}
        {draft.status === "generating" ? <DraftProgress draft={draft} brief={brief} /> : null}
        {draft.status === "ready" && !doc ? <Thinking text="Opening the draft..." /> : null}
        {regen && brief ? (
          <RegenerateDialog
            auth={auth}
            kind="draft"
            briefId={brief.id}
            itemId={draft.item_id}
            onClose={() => setRegen(false)}
            onStarted={() => {
              setRegen(false);
              load();
            }}
          />
        ) : null}
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <Back onBack={onBack} title={head}>
        <span className="aw-num px-1 text-[12px] whitespace-nowrap text-muted">{words.toLocaleString("en-US")} words</span>
        <span className="flex items-center gap-1.5 px-1 text-[12px] whitespace-nowrap text-muted">
          <i className={`inline-block h-1.5 w-1.5 ${state.s === "error" ? "bg-neg" : state.s === "saving" ? "bg-warn" : "bg-pos"}`} aria-hidden="true" />
          {state.note || (state.s === "error" ? "Not saved" : state.s === "saving" ? "Saving" : "Saved")}
        </span>
        {canEdit && brief ? (
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setRegen(true)}>
            Regenerate
          </button>
        ) : null}
        <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" aria-haspopup="menu" disabled={!editor} onClick={(e) => setExportAt(e.currentTarget.getBoundingClientRect())}>
          Export
        </button>
        {canEdit ? (
          <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" disabled={!editor} onClick={() => setPublishing(true)}>
            Publish
          </button>
        ) : null}
      </Back>
      {error ? <p className="aw-error">{error}</p> : null}

      <PlainEditor key={docKey || doc.id} sb={sb} workspaceId={auth.workspaceId} doc={doc} canEdit={canEdit} onSaved={saved} onEditor={setEditor} onState={onState} />

      {exportAt ? (
        <Pop anchor={exportAt} onClose={() => setExportAt(null)} width={200} label="Export">
          <div className="aw-pop__list" role="menu">
            {exports.map((x) => (
              <button key={x.id} type="button" role="menuitem" className="aw-pop__opt" onClick={x.run}>
                {x.label}
              </button>
            ))}
          </div>
        </Pop>
      ) : null}
      {publishing ? <PublishPanel sb={sb} auth={auth} docId={doc.id} title={title} html={html} onClose={() => setPublishing(false)} /> : null}
      {regen && brief ? (
        <RegenerateDialog
          auth={auth}
          kind="draft"
          briefId={brief.id}
          itemId={draft.item_id}
          onClose={() => setRegen(false)}
          onStarted={() => {
            setRegen(false);
            setDoc(null);
            setEditor(null);
            load();
          }}
        />
      ) : null}
    </div>
  );
}
