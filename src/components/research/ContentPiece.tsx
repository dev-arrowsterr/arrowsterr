"use client";

import { DateField, Dropdown } from "../Pickers";
import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "@tiptap/extension-link";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Brief, Serp } from "@/lib/briefTypes";
import { briefDocHtml, wordFile } from "@/lib/briefDoc";
import { createDoc, getBrief, getDoc, getGuideline, getSerp, listDocs, listMembers, saveBrief, type CalendarItem, type CalendarStatus, type Doc, type DocMeta, type Site } from "@/lib/db";
import type { RunAuth } from "@/lib/runner";
import { briefToDoc } from "@/lib/writer";
import type { BrandGuideline } from "@/lib/writerTypes";
import { AiIcon, Seg, Thinking } from "../ui";
import { BriefView } from "./BriefView";
import { SerpView } from "./SerpView";
import { Difficulty, FIELD, fmtCpc, fmtNum, post, slugify, slugOf, STAGE_LABEL, StageTag, STATUS_PICK, statusLabel, StopButton, stopped, Tick } from "./shared";
import { nextMonday, STAGES } from "@/lib/research";
import { DocsEditor } from "./DocsEditor";

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const STATUSES: { id: CalendarStatus; label: string }[] = [
  { id: "planned", label: "Planned" },
  { id: "brief", label: "Brief ready" },
  { id: "writing", label: "Writing" },
  { id: "published", label: "Published" },
];

type Tab = "overview" | "serp" | "brief" | "draft";
/** Whether this workspace has the Agentic Writer, and how to get it. */
export type WriterAccess = { open: boolean; onUpgrade?: () => void };

/** One content piece: its details, Google's top 10, its content brief as an editable document, and its draft in the Agentic Writer. */
export function ContentPiece({
  sb,
  auth,
  site,
  brandName,
  item,
  canEdit,
  onPatch,
  onRemove,
  writer = { open: true },
  startTab,
  autoSerp = false,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  site: Site;
  brandName: string;
  item: CalendarItem;
  canEdit: boolean;
  onPatch: (p: Partial<CalendarItem>) => void;
  onRemove: () => void;
  writer?: WriterAccess;
  startTab?: Tab;
  /** Run the SERP analysis as soon as the piece opens, when it has none yet. */
  autoSerp?: boolean;
}) {
  const [tab, setTab] = useState<Tab>(startTab ?? (item.brief_status ? "brief" : "overview"));
  const [serp, setSerp] = useState<{ serp: Serp | null; serp_at: string | null; missing?: boolean } | null>(null);
  const [serpBusy, setSerpBusy] = useState(false);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [importNow, setImportNow] = useState(false);
  // Everyone in the workspace, to pick as the owner.
  const [members, setMembers] = useState<string[]>([]);
  useEffect(() => {
    listMembers(sb, auth.workspaceId)
      .then((m) => setMembers(m.map((x) => x.email).filter((e): e is string => Boolean(e))))
      .catch(() => {});
  }, [sb, auth.workspaceId]);
  const [brief, setBrief] = useState<Awaited<ReturnType<typeof getBrief>> | null>(null);
  const [guideline, setGuideline] = useState<BrandGuideline | null | undefined>(undefined);
  const [drafts, setDrafts] = useState<DocMeta[] | null>(null);
  const [error, setError] = useState("");

  const loadBrief = useCallback(async () => {
    try {
      const b = await getBrief(sb, item.id);
      setBrief(b);
      if (b.brief_status !== item.brief_status) onPatch({ brief_status: b.brief_status, ...(b.brief_status === "done" && item.status === "planned" ? { status: "brief" as const } : {}) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [sb, item.id, item.brief_status, item.status, onPatch]);

  useEffect(() => {
    // Loading the brief, the brand guideline and the drafts when the piece opens is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadBrief();
    getGuideline(sb, item.site_id).then(setGuideline).catch(() => setGuideline(null));
    listDocs(sb, item.site_id)
      .then((d) => setDrafts(d.filter((x) => x.calendar_item_id === item.id)))
      .catch(() => setDrafts([]));
    getSerp(sb, item.id).then(setSerp).catch(() => setSerp({ serp: null, serp_at: null }));
    // Only when another piece opens.
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = brief?.brief_status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(loadBrief, 4000);
    return () => clearInterval(t);
  }, [running, loadBrief]);

  async function createBrief() {
    setError("");
    try {
      await post(auth, "/api/research/brief", { itemId: item.id });
      setBrief((b) => ({ ...(b ?? { brief: null, brief_error: null, brief_at: null }), brief_status: "running" }));
      onPatch({ brief_status: "running" });
      setTab("brief");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Stop a brief that is running, or one that got stuck. Its tasks come back when no work was done. */
  async function stopBrief() {
    setError("");
    try {
      await post(auth, "/api/research/brief", { itemId: item.id, action: "stop" });
      setBrief((b) => (b ? { ...b, brief_status: "failed", brief_error: "Stopped." } : b));
      onPatch({ brief_status: "failed" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Read Google's top 10 for this keyword. A brief already written gets the new results too. */
  const serpStop = useRef<AbortController | null>(null);
  async function runSerp() {
    setError("");
    setSerpBusy(true);
    setTab("serp");
    const ctl = new AbortController();
    serpStop.current = ctl;
    try {
      const out = await post<{ serp: Serp; at: string; intoBrief: boolean }>(auth, "/api/research/serp", { itemId: item.id }, ctl.signal);
      setSerp({ serp: out.serp, serp_at: out.at });
      if (out.intoBrief) setBrief((b) => (b?.brief ? { ...b, brief: { ...b.brief, serp: out.serp } } : b));
    } catch (e) {
      if (!stopped(e)) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSerpBusy(false);
    }
  }

  const autoRan = useRef(false);
  useEffect(() => {
    if (!autoSerp || autoRan.current || !serp || serp.serp || serp.missing || !canEdit) return;
    autoRan.current = true;
    runSerp();
    // Runs once, when the saved SERP has loaded and there is none.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSerp, serp]);

  // The draft opens right here, in the Agentic Writer.
  const draftId = drafts?.[0]?.id ?? null;
  useEffect(() => {
    if (!draftId || doc?.id === draftId) return;
    let live = true;
    getDoc(sb, draftId)
      .then((d) => live && setDoc(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [sb, draftId, doc?.id]);

  // Make the draft for this piece, with the brief's outline in place, and open it in the Agentic Writer tab.
  async function toWriter(blank = false) {
    setError("");
    try {
      const b = brief?.brief;
      const made = await createDoc(sb, {
        workspace_id: auth.workspaceId,
        site_id: item.site_id,
        calendar_item_id: item.id,
        title: b?.brief.h1 || item.keyword,
        content: (b && !blank ? briefToDoc(item.keyword, item.secondary, b) : { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: item.keyword }] }, { type: "paragraph" }] }) as unknown as Record<string, unknown>,
      });
      setDoc(made);
      setDrafts([made]);
      if (item.status === "planned" || item.status === "brief") onPatch({ status: "writing" });
      setTab("draft");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(/docs/.test(message) ? `${message}. Run supabase/010_writer.sql in Supabase.` : message);
    }
  }

  const draft = drafts?.[0] ?? null;
  const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "No date");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
        <StageTag stage={item.stage} />
        <span className="aw-num">{fmtNum(item.volume)} searches / mo</span>
        <Difficulty kd={item.difficulty} />
        <span>{fmtDate(item.due_date)}</span>
        <span className="aw-status aw-status--pending">{statusLabel(item)}</span>
      </div>

      <Seg
        label="Content piece"
        value={tab}
        onChange={setTab}
        options={[
          { id: "overview", label: "Overview" },
          { id: "serp", label: serp?.serp ? <>SERP analysis <Tick /></> : serpBusy ? "SERP analysis ···" : "SERP analysis" },
          { id: "brief", label: brief?.brief_status === "done" ? <>Content Brief <Tick /></> : brief?.brief_status === "running" ? "Content Brief ···" : "Content Brief" },
          { id: "draft", label: draft ? <>Agentic Writer <Tick /></> : "Agentic Writer" },
        ]}
      />
      {error ? <p className="aw-error">{error}</p> : null}

      {tab === "overview" ? (
        <Overview
          item={item}
          site={site}
          members={members}
          canEdit={canEdit}
          onPatch={onPatch}
          onRemove={onRemove}
          brief={brief?.brief_status ?? item.brief_status ?? null}
          onBrief={createBrief}
          onStopBrief={stopBrief}
          onOpenBrief={() => setTab("brief")}
          hasSerp={Boolean(serp?.serp)}
          serpBusy={serpBusy}
          onSerp={() => (serp?.serp ? setTab("serp") : runSerp())}
          onWriter={() => setTab("draft")}
        />
      ) : tab === "serp" ? (
        serpBusy ? (
          <div className="flex flex-col items-start gap-3">
            <Thinking text={`Reading Google's top 10 for "${item.keyword}"...`} />
            <StopButton onStop={() => serpStop.current?.abort()} />
          </div>
        ) : serp?.serp ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="aw-small mr-auto">{brief?.brief ? "Your brief uses these results." : "When you generate the brief, it uses these results. No second search."}</span>
              {canEdit ? (
                <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => confirm("Search Google again for fresh results?") && runSerp()}>
                  Run again
                </button>
              ) : null}
              {canEdit && !brief?.brief && brief?.brief_status !== "running" ? (
                <button type="button" className="aw-btn aw-btn--accent aw-btn--sm" onClick={createBrief}>
                  <AiIcon />
                  Generate brief from this
                </button>
              ) : null}
            </div>
            <SerpView serp={serp.serp} at={serp.serp_at} country={site.profile.country ?? "United States"} />
          </div>
        ) : (
          <div className="aw-frame flex flex-col items-start gap-4 p-8">
            {serp?.missing ? <p className="aw-error">Run supabase/027_serp.sql in Supabase to save SERP analyses.</p> : null}
            <h3 className="aw-h3">See who ranks for “{item.keyword}”</h3>
            <p className="max-w-xl text-[15px] text-ink">
              Read Google&apos;s top 10 in {site.profile.country ?? "the United States"}: how long each page is, how it is built, what Google shows and what people ask.
              {brief?.brief ? " Your brief gets the new results too." : " The brief uses it later, so Google is searched only once."}
            </p>
            {canEdit ? (
              <button type="button" className="aw-btn aw-btn--accent" onClick={runSerp}>
                <AiIcon />
                Run SERP analysis
              </button>
            ) : null}
          </div>
        )
      ) : tab === "brief" ? (
        !brief || guideline === undefined ? (
          <p className="aw-small">Loading...</p>
        ) : running ? (
          <div className="aw-frame flex flex-col items-center gap-3 px-6 py-16 text-center" role="status" aria-live="polite">
            <span className="aw-think__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 1.5c.6 4.9 2.9 8.6 10.5 10.5-7.6 1.9-9.9 5.6-10.5 10.5-.6-4.9-2.9-8.6-10.5-10.5C9.1 10.1 11.4 6.4 12 1.5z" />
              </svg>
            </span>
            <span className="aw-h4">{serp?.serp ? "Writing the brief from your SERP analysis..." : "Reading Google's top 10 and writing the brief..."}</span>
            <BriefClock started={brief.brief_started_at ?? null} />
            {canEdit ? <StopButton onStop={stopBrief} /> : null}
          </div>
        ) : !brief.brief ? (
          <div className="aw-frame flex flex-col items-start gap-4 p-8">
            {brief.brief_status === "failed" ? <p className="aw-error">{brief.brief_error}</p> : null}
            <h3 className="aw-h3">{item.keyword}</h3>
            {canEdit ? (
              <button type="button" className="aw-btn aw-btn--accent" onClick={createBrief}>
                <AiIcon />
                Create content brief
              </button>
            ) : null}
          </div>
        ) : (
          <BriefEditor
            key={brief.brief_at ?? "brief"}
            sb={sb}
            item={item}
            brief={brief.brief}
            html={brief.brief.doc ?? briefDocHtml(item, brief.brief, { name: brandName, country: site.profile.country }, guideline)}
            canEdit={canEdit}
            onSaved={(b) => setBrief({ ...brief, brief: b })}
            onRecreate={createBrief}
            onWriter={() => {
              // A draft already exists: bring the brief into it. The draft from before can be put back.
              if (draft) {
                setImportNow(true);
                setTab("draft");
              } else toWriter();
            }}
          />
        )
      ) : !writer.open ? (
        <div className="aw-frame flex flex-col items-start gap-4 p-8">
          <h3 className="aw-h3">Write this piece with the Agentic Writer</h3>
          <p className="max-w-xl text-[15px] text-ink">AI agents write each section from the brief, build tables and interactive elements, add stats and links, then publish to your CMS.</p>
          {writer.onUpgrade ? (
            <button type="button" className="aw-btn aw-btn--accent" onClick={writer.onUpgrade}>
              Add the Agentic Writer with Pro
            </button>
          ) : null}
        </div>
      ) : draft ? (
        doc && doc.id === draft.id ? (
          <DocsEditor
            key={doc.id}
            sb={sb}
            auth={auth}
            site={site}
            doc={doc}
            canEdit={canEdit}
            guideline={guideline ?? null}
            onSaved={(meta) => setDrafts((d) => [meta, ...(d ?? []).filter((x) => x.id !== meta.id)])}
            importBrief={importNow}
            onImported={() => setImportNow(false)}
          />
        ) : (
          <Thinking text="Opening the draft..." />
        )
      ) : (
        <div className="aw-frame flex flex-col items-start gap-4 p-8">
          {(
            <>
              <h3 className="aw-h3">{item.keyword}</h3>
              {canEdit ? (
                <span className="flex flex-wrap gap-2">
                  {brief?.brief ? (
                    <button type="button" className="aw-btn aw-btn--accent" onClick={() => toWriter()}>
                      Write it from the brief
                    </button>
                  ) : (
                    <button type="button" className="aw-btn aw-btn--accent" onClick={createBrief}>
                      <AiIcon />
                      Create content brief first
                    </button>
                  )}
                  <button type="button" className="aw-btn aw-btn--secondary" onClick={() => toWriter(true)}>
                    Start a blank draft
                  </button>
                </span>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Every detail of a piece, the same as its row in the Content Plan list, editable where the list is. */
function Overview({
  item,
  site,
  members,
  canEdit,
  onPatch,
  onRemove,
  brief,
  onBrief,
  onStopBrief,
  onOpenBrief,
  hasSerp,
  serpBusy,
  onSerp,
  onWriter,
}: {
  item: CalendarItem;
  site: Site;
  members: string[];
  canEdit: boolean;
  onPatch: (p: Partial<CalendarItem>) => void;
  onRemove: () => void;
  brief: CalendarItem["brief_status"];
  onBrief: () => void;
  onStopBrief: () => void;
  onOpenBrief: () => void;
  hasSerp: boolean;
  serpBusy: boolean;
  onSerp: () => void;
  onWriter: () => void;
}) {
  const [keyword, setKeyword] = useState(item.keyword);
  const [slug, setSlug] = useState(slugOf(item));
  const [theme, setTheme] = useState(item.theme ?? "");
  const [also, setAlso] = useState(item.secondary.join(", "));
  const [notes, setNotes] = useState(item.notes ?? "");
  const [url, setUrl] = useState(item.url ?? "");
  const [extra, setExtra] = useState<Record<string, string>>(() => Object.fromEntries((site.profile.columns ?? []).map((c) => [c.id, String(item.extra?.[c.id] ?? "")])));
  const field = (label: string, input: React.ReactNode, wide = false) => (
    <label className={`flex flex-col gap-1.5 ${wide ? "sm:col-span-2" : ""}`}>
      <span className="aw-label">{label}</span>
      {input}
    </label>
  );
  const box = `${FIELD} h-10 w-full text-[14px]!`;
  const status = item.status === "planned" && !item.due_date ? "idea" : item.status;
  const owners = [...new Set([...(item.owner ? [item.owner] : []), ...members])];
  const stat = (lab: string, v: React.ReactNode) => (
    <div className="flex flex-col gap-1 bg-white px-4 py-3">
      <span className="aw-label">{lab}</span>
      <span className="text-[15px] text-ink">{v}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onSerp} disabled={serpBusy}>
            {hasSerp ? (
              <>
                <Tick /> SERP analysis
              </>
            ) : serpBusy ? (
              "Reading Google..."
            ) : (
              "Run SERP analysis"
            )}
          </button>
          {brief === "done" ? (
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onOpenBrief}>
              <Tick /> Content brief
            </button>
          ) : brief === "running" ? (
            <span className="flex items-center gap-2">
              <span className="aw-status aw-status--warn">Writing the brief...</span>
              <StopButton onStop={onStopBrief} />
            </span>
          ) : (
            <button type="button" className="aw-btn aw-btn--accent aw-btn--sm" onClick={onBrief}>
              <AiIcon />
              Generate brief
            </button>
          )}
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onWriter}>
            Open Agentic Writer →
          </button>
        </div>
      ) : null}

      {/* The numbers from Google, as in the list. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[8px] border border-rule bg-rule sm:grid-cols-3 lg:grid-cols-6">
        {stat("Volume", <span className="aw-num">{fmtNum(item.volume)} / mo</span>)}
        {stat("Difficulty", <Difficulty kd={item.difficulty} />)}
        {stat("CPC", <span className="aw-num">{fmtCpc(item.cpc)}</span>)}
        {stat("Search intent", <span className="capitalize">{item.intent ?? "–"}</span>)}
        {stat("Now ranks", item.current_rank ? <span className="aw-rank">#{item.current_rank}</span> : <span className="text-muted">–</span>)}
        {stat("Source", <span className="capitalize">{item.source ?? "–"}</span>)}
      </div>

      <div className="aw-frame grid gap-5 p-6 sm:grid-cols-2">
        {field("Keyword", <input value={keyword} disabled={!canEdit} onChange={(e) => setKeyword(e.target.value)} onBlur={() => keyword.trim() && keyword !== item.keyword && onPatch({ keyword: keyword.trim() })} className={box} />)}
        {field(
          "Suggested slug",
          <input
            value={slug}
            disabled={!canEdit}
            onChange={(e) => setSlug(e.target.value)}
            onBlur={() => {
              const next = slug.trim() ? `/${slugify(slug)}` : null;
              if (next !== slugOf(item)) onPatch({ extra: { ...(item.extra ?? {}), slug: next } });
              setSlug(next ?? slugOf({ ...item, extra: { ...(item.extra ?? {}), slug: null } }));
            }}
            className={`${box} font-mono text-[13px]!`}
          />,
        )}
        {field(
          "Stage",
          <Dropdown label="Stage" value={item.stage ?? ""} disabled={!canEdit} onChange={(v) => onPatch({ stage: (v || null) as CalendarItem["stage"] })} className={box} options={[...STAGES.map((x) => ({ id: x.id as string, label: STAGE_LABEL[x.id] })), { id: "", label: "None" }]} />,
        )}
        {field(
          "Status",
          <Dropdown
            label="Status"
            value={status}
            disabled={!canEdit}
            onChange={(v) => {
              if (v === "idea") onPatch({ status: "planned", due_date: null });
              else onPatch(v === "planned" && !item.due_date ? { status: "planned", due_date: isoDay(nextMonday()) } : { status: v as CalendarStatus });
            }}
            className={box}
            options={STATUS_PICK.map((x) => ({ id: x.id as string, label: x.label }))}
          />,
        )}
        {field("Publish date", <DateField label="Publish date" value={item.due_date ?? ""} disabled={!canEdit} onChange={(v) => onPatch({ due_date: v })} className={box} placeholder="Not scheduled" />)}
        {field(
          "Owner",
          <Dropdown label="Owner" value={item.owner ?? ""} disabled={!canEdit} onChange={(v) => onPatch({ owner: v || null })} className={box} options={[{ id: "", label: "Unassigned" }, ...owners.map((m) => ({ id: m, label: m }))]} />,
        )}
        {field(
          "Job",
          <Dropdown label="Job" value={item.action} disabled={!canEdit} onChange={(v) => onPatch({ action: v })} className={box} options={[{ id: "new" as const, label: "New page" }, { id: "update" as const, label: "Update page" }]} />,
        )}
        {field("Theme", <input value={theme} disabled={!canEdit} onChange={(e) => setTheme(e.target.value)} onBlur={() => theme !== (item.theme ?? "") && onPatch({ theme: theme.trim() || null })} placeholder="A group of related topics" className={box} />)}
        {item.action === "update" && item.current_url
          ? field(
              "Page to update",
              <a href={item.current_url} target="_blank" rel="noopener noreferrer" className="flex min-h-10 items-center truncate text-[14px]">
                {item.current_url.replace(/^https?:\/\/(www\.)?/, "")} ↗
              </a>,
            )
          : null}
        {field(
          "Live URL",
          <input
            value={url}
            disabled={!canEdit}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => url !== (item.url ?? "") && onPatch(url && item.action === "new" ? { url, status: "published" } : { url: url || null })}
            placeholder="https://"
            className={box}
          />,
        )}
        {field(
          "Also covers",
          <input
            value={also}
            disabled={!canEdit}
            onChange={(e) => setAlso(e.target.value)}
            onBlur={() => {
              const list = also.split(",").map((x) => x.trim()).filter(Boolean);
              if (list.join("|") !== item.secondary.join("|")) onPatch({ secondary: list });
            }}
            placeholder="Other keywords this page covers, with commas"
            className={box}
          />,
          true,
        )}
        {(site.profile.columns ?? []).map((c) =>
          field(
            c.name,
            <input
              type={c.type === "date" ? "date" : c.type === "number" ? "number" : "text"}
              value={extra[c.id] ?? ""}
              disabled={!canEdit}
              onChange={(e) => setExtra((x) => ({ ...x, [c.id]: e.target.value }))}
              onBlur={() => {
                const v = extra[c.id] ?? "";
                if (v === String(item.extra?.[c.id] ?? "")) return;
                onPatch({ extra: { ...(item.extra ?? {}), [c.id]: v === "" ? null : c.type === "number" ? Number(v) : v } });
              }}
              className={box}
            />,
          ),
        )}
        {field("Notes", <textarea value={notes} disabled={!canEdit} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (item.notes ?? "") && onPatch({ notes: notes || null })} rows={4} className="aw-textarea text-[14px]!" />, true)}
        <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
          <span className="text-[12px] text-muted">Added {item.created_at ? new Date(item.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "–"}</span>
          {canEdit ? (
            <button type="button" className="aw-text-link text-[13px] text-neg!" onClick={onRemove}>
              Remove from Content Plan
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DocToolbar({ editor }: { editor: Editor }) {
  const b = (label: string, on: boolean, run: () => void, title: string) => (
    <button type="button" title={title} aria-label={title} aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={run} className={`aw-tool ${on ? "is-on" : ""}`}>
      {label}
    </button>
  );
  const c = () => editor.chain().focus();
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-rule bg-white px-3 py-2">
      {b("H1", editor.isActive("heading", { level: 1 }), () => c().toggleHeading({ level: 1 }).run(), "Heading 1")}
      {b("H2", editor.isActive("heading", { level: 2 }), () => c().toggleHeading({ level: 2 }).run(), "Heading 2")}
      {b("H3", editor.isActive("heading", { level: 3 }), () => c().toggleHeading({ level: 3 }).run(), "Heading 3")}
      {b("¶", editor.isActive("paragraph"), () => c().setParagraph().run(), "Paragraph")}
      <span className="mx-1 h-5 w-px bg-rule" />
      {b("B", editor.isActive("bold"), () => c().toggleBold().run(), "Bold")}
      {b("I", editor.isActive("italic"), () => c().toggleItalic().run(), "Italic")}
      {b("•", editor.isActive("bulletList"), () => c().toggleBulletList().run(), "Bullet list")}
      {b("1.", editor.isActive("orderedList"), () => c().toggleOrderedList().run(), "Numbered list")}
      {b("🔗", editor.isActive("link"), () => {
        if (editor.isActive("link")) return c().unsetLink().run();
        const url = prompt("Link to");
        if (url) c().setLink({ href: url }).run();
      }, "Link")}
      <span className="mx-1 h-5 w-px bg-rule" />
      {b("⊞", false, () => c().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run(), "Insert table")}
      {editor.isActive("table") ? (
        <>
          {b("+Row", false, () => c().addRowAfter().run(), "Add row")}
          {b("+Col", false, () => c().addColumnAfter().run(), "Add column")}
          {b("−Row", false, () => c().deleteRow().run(), "Delete row")}
        </>
      ) : null}
      <span className="mx-1 h-5 w-px bg-rule" />
      {b("↶", false, () => c().undo().run(), "Undo")}
      {b("↷", false, () => c().redo().run(), "Redo")}
    </div>
  );
}

/** The brief as a document you can edit, download as Word, and send to Agentic Writer. */
function BriefEditor({
  sb,
  item,
  brief,
  html,
  canEdit,
  onSaved,
  onRecreate,
  onWriter,
}: {
  sb: SupabaseClient;
  item: CalendarItem;
  brief: Brief;
  html: string;
  canEdit: boolean;
  onSaved: (b: Brief) => void;
  onRecreate: () => void;
  onWriter: () => void;
}) {
  const [state, setState] = useState<"saved" | "saving" | "error">("saved");
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<"view" | "doc">("view");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }), Link.configure({ openOnClick: false }), Table.configure({ resizable: false }), TableRow, TableHeader, TableCell],
    content: html,
    onUpdate: ({ editor: ed }) => {
      if (!canEdit) return;
      if (timer.current) clearTimeout(timer.current);
      setState("saving");
      timer.current = setTimeout(async () => {
        const next: Brief = { ...brief, doc: ed.getHTML(), docAt: new Date().toISOString() };
        try {
          await saveBrief(sb, item.id, next);
          onSaved(next);
          setState("saved");
        } catch {
          setState("error");
        }
      }, 1500);
    },
  });
  const title = `Content Brief - ${brief.brief.h1 || item.keyword}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto flex items-center gap-3">
          <Seg
            label="Brief view"
            value={mode}
            onChange={setMode}
            options={[
              { id: "view", label: "Overview" },
              { id: "doc", label: "Document" },
            ]}
          />
          {mode === "doc" ? <span className="aw-num text-[12px] text-muted">{state === "saving" ? "Saving..." : state === "error" ? "Not saved" : "Saved"}</span> : null}
        </span>
        <button
          type="button"
          className="aw-btn aw-btn--secondary aw-btn--sm"
          onClick={() => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([wordFile(title, editor?.getHTML() ?? html)], { type: "application/msword" }));
            a.download = `${title.replace(/[^\w-]+/g, "-")}.doc`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          Download .doc
        </button>
        <button
          type="button"
          className="aw-btn aw-btn--secondary aw-btn--sm"
          onClick={async () => {
            const out = editor?.getHTML() ?? html;
            await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([out], { type: "text/html" }), "text/plain": new Blob([editor?.getText() ?? ""], { type: "text/plain" }) })]).catch(() => navigator.clipboard.writeText(editor?.getText() ?? ""));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {canEdit ? (
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => confirm("Write the brief again? Your edits to this brief will be replaced.") && onRecreate()}>
            Recreate
          </button>
        ) : null}
        {canEdit ? (
          <button type="button" className="aw-btn aw-btn--accent aw-btn--sm" onClick={onWriter}>
            Import into Agentic Writer →
          </button>
        ) : null}
      </div>
      {mode === "view" ? (
        <BriefView brief={brief} keyword={item.keyword} />
      ) : (
        <section className="aw-frame">
          {editor && canEdit ? <DocToolbar editor={editor} /> : null}
          <div className="aw-editor aw-doc px-6 py-8 sm:px-12">
            <EditorContent editor={editor} />
          </div>
        </section>
      )}
    </div>
  );
}

/** How long a brief has run. Past 10 minutes it is stuck: the server gives up on it, and Stop lets you start again now. */
function BriefClock({ started }: { started: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  const [seen] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const from = started ? Date.parse(started) : seen;
  const min = Math.max(0, Math.floor((now - from) / 60_000));
  if (min >= 10) return <span className="text-[13px] text-neg">This brief looks stuck ({min} min). Stop it and start again.</span>;
  return <span className="text-[13px] text-muted">{min < 1 ? "Started just now" : `Running for ${min} min`} · most briefs take 2 to 4 minutes</span>;
}
