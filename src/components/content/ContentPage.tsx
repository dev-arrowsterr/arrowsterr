"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { docToMarkdown, listArticles, type Article, type ArticleStatus } from "@/lib/articles";
import { wordFile } from "@/lib/briefDoc";
import { voiceReady, type VoiceRow } from "@/lib/brandVoice";
import { createDoc, getDoc, getGuideline, siteForBrand, type Doc, type DocMeta, type Site } from "@/lib/db";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import { currentSupabase } from "@/lib/supa";
import type { View } from "@/lib/view";
import type { BrandGuideline } from "@/lib/writerTypes";
import { BrandVoiceSettings } from "../BrandVoice";
import { Pop } from "../Pickers";
import { Modal } from "../reports/Dialog";
import { PublishPanel } from "../research/PublishPanel";
import { post } from "../research/shared";
import { brandTables } from "../research/Writer";
import { exportClean } from "../research/writerNodes";
import { Sheet, type Col } from "../Sheet";
import { ToolIntro } from "../ToolIntro";
import { Thinking } from "../ui";
import { PlainEditor, type SaveState } from "./PlainEditor";
import { ResearchPanel } from "./ResearchPanel";

// Content (docs/content-v2.md): the brand's article library. Every draft lands here; people edit it by hand,
// export it and publish it to the brand's own sites. No AI inside the editor.

const STATUS_TAG: Record<ArticleStatus, string> = { Draft: "aw-status--pending", Ready: "aw-status--warn", "CMS draft": "aw-status--pending", Published: "aw-status--ranked" };
const VOICE_ASKED = (brandId: string) => `arrowsterr.voiceAsked.${brandId}`;
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Content: a table of the brand's articles; opening one shows the plain editor with its research beside it. */
export function ContentPage({ sb: given, view, auth, canEdit }: { sb?: SupabaseClient; view: View; auth: RunAuth; canEdit: boolean }) {
  const [sb] = useState(() => given ?? currentSupabase());
  const brand = view.brand;
  const [site, setSite] = useStash<Site | null | undefined>(`site:${brand.id}`, undefined);
  const [rows, setRows] = useStash<Article[] | null>(`content:${brand.id}:rows`, null);
  const [openId, setOpenId] = useStash<string | null>(`content:${brand.id}:open`, null);
  const [error, setError] = useState("");
  const [voice, setVoice] = useState(false);

  useEffect(() => {
    let live = true;
    siteForBrand(sb, brand, canEdit)
      .then((s) => live && setSite(s))
      .catch((e) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : String(e));
        setSite(null);
      });
    return () => {
      live = false;
    };
  }, [sb, brand, canEdit, setSite]);

  const load = useCallback(async () => {
    if (!site) return;
    try {
      setRows(await listArticles(sb, site.id));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(/docs/.test(message) ? `${message}. Run supabase/010_writer.sql in Supabase → SQL Editor.` : message);
      setRows([]);
    }
  }, [sb, site, setRows]);
  useEffect(() => {
    // Loading the library when the brand's website is known is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Brand Voice opens on the first visit to Content, for a brand without one. Closing it is remembered in this browser.
  useEffect(() => {
    if (!canEdit) return;
    try {
      if (localStorage.getItem(VOICE_ASKED(brand.id))) return;
    } catch {
      return;
    }
    let live = true;
    post<{ row: VoiceRow | null; setup?: string }>(auth, "/api/brand-voice", { action: "get", brandId: brand.id })
      .then((r) => live && !r.setup && !voiceReady(r.row?.voice) && setVoice(true))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [auth, brand.id, canEdit]);
  const closeVoice = () => {
    setVoice(false);
    try {
      localStorage.setItem(VOICE_ASKED(brand.id), "1");
    } catch {}
  };

  async function blank() {
    if (!site) return;
    setError("");
    try {
      const d = await createDoc(sb, { workspace_id: auth.workspaceId, site_id: site.id, title: "Untitled", content: { type: "doc", content: [{ type: "paragraph" }] } });
      await load();
      setOpenId(d.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const cols = useMemo<Col<Article>[]>(
    () => [
      { id: "title", label: "Title", type: "text", width: 320, value: (a) => a.title, cell: (a) => <span className="font-medium text-ink">{a.title}</span> },
      { id: "keyword", label: "Keyword", type: "text", width: 220, value: (a) => a.keyword },
      { id: "status", label: "Status", type: "list", width: 120, value: (a) => a.status, cell: (a) => <span className={`aw-status ${STATUS_TAG[a.status]}`}>{a.status}</span> },
      { id: "words", label: "Words", type: "number", width: 90, value: (a) => a.words },
      { id: "date", label: "Date", type: "date", width: 130, value: (a) => a.date, cell: (a) => day(a.date) },
      { id: "sources", label: "Sources", type: "number", width: 90, value: (a) => a.sources },
    ],
    [],
  );

  const voiceModal = voice ? (
    <Modal title="Brand Voice" onClose={closeVoice} width="max-w-2xl">
      <BrandVoiceSettings auth={auth} brand={brand} canEdit={canEdit} />
    </Modal>
  ) : null;

  if (site === undefined || (site && rows === null)) return <Thinking text="Opening Content..." />;
  if (!site) return <p className="aw-error">{error || "This brand has no website yet."}</p>;

  if (openId) {
    return (
      <>
        <ArticleView
          key={openId}
          sb={sb}
          auth={auth}
          site={site}
          id={openId}
          canEdit={canEdit}
          onSaved={(m) => setRows((list) => (list ?? []).map((a) => (a.id === m.id ? { ...a, title: m.title, words: m.words, updated_at: m.updated_at } : a)))}
          onBack={() => {
            setOpenId(null);
            load();
          }}
          onMissing={() => setOpenId(null)}
        />
        {voiceModal}
      </>
    );
  }

  const list = rows ?? [];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="aw-h2">Content</h1>
        {canEdit && list.length ? (
          <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={blank}>
            New article
          </button>
        ) : null}
      </div>
      {error ? <p className="aw-error">{error}</p> : null}
      {list.length ? (
        <Sheet<Article> id={`content:${site.id}`} label="Content" rows={list} cols={cols} rowKey={(a) => a.id} sort={{ key: "date", desc: true }} onOpen={(a) => setOpenId(a.id)} height="calc(100vh - 210px)" tools={false} />
      ) : (
        <ToolIntro
          title="Content"
          lead={`Every researched draft for ${brand.name} lands here. Edit it by hand, export it, or publish it to ${brand.name}'s own site.`}
          action={
            canEdit ? (
              <button type="button" className="aw-btn aw-btn--primary" onClick={blank}>
                New article
              </button>
            ) : null
          }
        />
      )}
      {voiceModal}
    </div>
  );
}

/** One article: the plain editor, the research beside it, and Export and Publish. */
function ArticleView({
  sb,
  auth,
  site,
  id,
  canEdit,
  onSaved,
  onBack,
  onMissing,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  site: Site;
  id: string;
  canEdit: boolean;
  onSaved: (m: DocMeta) => void;
  onBack: () => void;
  onMissing: () => void;
}) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [guideline, setGuideline] = useState<BrandGuideline | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [state, setState] = useState<{ s: SaveState; note?: string }>({ s: "saved" });
  const [title, setTitle] = useState("");
  const [words, setWords] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [exportAt, setExportAt] = useState<DOMRect | null>(null);
  const missing = useRef(onMissing);
  useEffect(() => {
    missing.current = onMissing;
  });

  useEffect(() => {
    let live = true;
    getDoc(sb, id)
      .then((d) => {
        if (!live) return;
        setDoc(d);
        setTitle(d.title);
        setWords(d.words);
      })
      .catch(() => live && missing.current());
    getGuideline(sb, site.id)
      .then((g) => live && setGuideline(g))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sb, id, site.id]);

  const saved = useCallback(
    (m: DocMeta) => {
      setTitle(m.title);
      setWords(m.words);
      onSaved(m);
    },
    [onSaved],
  );
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

  if (!doc) return <Thinking text="Opening the article..." />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <button type="button" className="aw-text-link shrink-0 text-[13px]" onClick={onBack}>
            ← Content
          </button>
          <span className="truncate text-[15px] font-medium text-ink">{title || "Untitled"}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="aw-num px-1 text-[12px] whitespace-nowrap text-muted">{words.toLocaleString("en-US")} words</span>
          <span className="flex items-center gap-1.5 px-1 text-[12px] whitespace-nowrap text-muted">
            <i className={`inline-block h-1.5 w-1.5 ${state.s === "error" ? "bg-neg" : state.s === "saving" ? "bg-warn" : "bg-pos"}`} aria-hidden="true" />
            {state.note || (state.s === "error" ? "Not saved" : state.s === "saving" ? "Saving" : "Saved")}
          </span>
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" aria-haspopup="menu" disabled={!editor} onClick={(e) => setExportAt(e.currentTarget.getBoundingClientRect())}>
            Export
          </button>
          {canEdit ? (
            <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" disabled={!editor} onClick={() => setPublishing(true)}>
              Publish
            </button>
          ) : null}
        </span>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <PlainEditor sb={sb} workspaceId={auth.workspaceId} doc={doc} canEdit={canEdit} onSaved={saved} onEditor={setEditor} onState={onState} />
        <aside className="min-w-0 xl:sticky xl:top-[72px]" aria-label="Research">
          <ResearchPanel sb={sb} itemId={doc.calendar_item_id} country={site.profile.country ?? "United States"} />
        </aside>
      </div>

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
    </div>
  );
}
