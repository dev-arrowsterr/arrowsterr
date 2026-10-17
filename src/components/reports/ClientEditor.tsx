"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { cleanKit } from "@/lib/brandKit";
import { applyChat, type ChatChanges } from "@/lib/reportChat";
import { BLOCKS, moveBlock, parseDoc, toggleBlock, type ReportDocument } from "@/lib/reportDoc";
import { parseRange, type ReportRange, type Resolved } from "@/lib/reportRange";
import { fontsUrl, themeOf } from "@/lib/reportTheme";
import type { ReportSnapshot, ReportStyle } from "@/lib/reportTypes";
import type { RunAuth } from "@/lib/runner";
import { KitPanel, styleFromKit } from "../BrandKit";
import { AiIcon, Seg, Thinking } from "../ui";
import { Modal } from "./Dialog";
import { RangePicker } from "./RangePicker";
import { ReportDoc, reportCss } from "./ReportDoc";
import { ago, errText, post } from "./reportApi";
import { ShareReport } from "./ShareReport";
import { ReportChat } from "./ReportChat";
import { LabelPanel, useReportStyle } from "./StylePanel";
import { REPORT_COLS, type Library, type SavedReport } from "./types";

type Built = { snapshot: ReportSnapshot; range: Resolved };
type State = { name: string; doc: ReportDocument; range: ReportRange };
type Version = { id: string; name: string | null; doc: unknown; range: unknown; created_at: string };

const VERSION_EVERY = 30 * 60_000;
const same = (a: State, b: State) => JSON.stringify(a) === JSON.stringify(b);

/** The client report editor (docs/reports.md, section 5, phase 1): dates, blocks, style, AI summary, versions, sharing and PDF. */
export function ClientEditor({ sb, auth, lib, report, canEdit, onBack, onSaved }: { sb: SupabaseClient; auth: RunAuth; lib: Library; report: SavedReport; canEdit: boolean; onBack: () => void; onSaved: (r: SavedReport) => void }) {
  const [state, setState] = useState<State>(() => ({ name: report.name, doc: parseDoc(report.doc), range: parseRange(report.range) }));
  const [built, setBuilt] = useState<Built | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"saved" | "saving" | "failed">("saved");
  const [panel, setPanel] = useState<"chat" | "blocks" | "kit" | "label">(canEdit ? "chat" : "blocks");
  const [dialog, setDialog] = useState<"share" | "history" | null>(null);
  const [pdf, setPdf] = useState<{ state: "working" | "stalled" | "failed"; error?: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const { style, setStyle, website, setWebsite, error: styleError } = useReportStyle(sb, auth.workspaceId, canEdit);
  const brand = lib.brands.find((b) => b.id === report.brand_id) ?? { id: report.brand_id, name: "", domain: "", logo: null };

  // Saving: a short wait after each change, then one write. The last saved state is what a version copies.
  const latest = useRef(state);
  const saved = useRef(state);
  const lastVersion = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authRef = useRef(auth);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    latest.current = state;
    authRef.current = auth;
    onSavedRef.current = onSaved;
  });

  useEffect(() => {
    sb.from("report_versions")
      .select("created_at")
      .eq("report_id", report.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        lastVersion.current = data?.[0] ? Date.parse(data[0].created_at) : 0;
      });
  }, [sb, report.id]);

  const addVersion = useCallback(
    async (s: State, name: string | null) => {
      const { error } = await sb.from("report_versions").insert({ report_id: report.id, workspace_id: report.workspace_id, name, doc: s.doc, range: s.range });
      if (error) throw new Error(error.message);
      lastVersion.current = Date.now();
    },
    [sb, report.id, report.workspace_id],
  );

  const save = useCallback(async () => {
    if (!canEdit) return;
    const next = latest.current;
    if (same(next, saved.current)) return;
    setSaving("saving");
    try {
      if (Date.now() - lastVersion.current > VERSION_EVERY) await addVersion(saved.current, null);
      const { data, error } = await sb
        .from("reports")
        .update({ name: next.name.trim() || report.name, doc: next.doc, range: next.range, updated_at: new Date().toISOString(), updated_by: lib.me })
        .eq("id", report.id)
        .select(REPORT_COLS)
        .single();
      if (error) throw new Error(error.message);
      saved.current = next;
      onSavedRef.current(data as SavedReport);
      setSaving(same(latest.current, next) ? "saved" : "saving");
    } catch (e) {
      setSaving("failed");
      setError(errText(e));
    }
  }, [sb, canEdit, report.id, report.name, lib.me, addVersion]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    await save();
  }, [save]);

  const change = (patch: Partial<State>) => {
    // Kept in step at once, so a save or summary right after a change sees it.
    latest.current = { ...latest.current, ...patch };
    setState((s) => ({ ...s, ...patch }));
    if (!canEdit) return;
    setSaving("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 800);
  };

  // Save on the way out.
  useEffect(() => () => void save(), [save]);

  // The numbers: fetched again when the dates change or a block that needs data is turned on.
  const need = JSON.stringify({ range: state.range, on: state.doc.blocks.filter((b) => b.on).map((b) => b.id).sort() });
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const { range } = JSON.parse(need) as { range: ReportRange };
        const out = await post<Built>(authRef.current, "/api/reports/data", { reportId: report.id, range, doc: latest.current.doc });
        if (live) {
          setBuilt(out);
          setError("");
        }
      } catch (e) {
        if (live) setError(errText(e));
      } finally {
        if (live) setLoading(false);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [need, report.id]);

  async function writeSummary() {
    setBusy("summary");
    setError("");
    try {
      await flush();
      const s = await post<{ headline: string; points: string[]; next: string[]; at: string; key: string }>(auth, "/api/reports/summary", { reportId: report.id });
      // The server saved it on the report too. Keep the copy here in step so the next save doesn't undo it.
      const doc = { ...latest.current.doc, summary: s };
      saved.current = { ...saved.current, doc: { ...saved.current.doc, summary: s } };
      setState((x) => ({ ...x, doc }));
      const { data } = await sb.from("reports").select(REPORT_COLS).eq("id", report.id).single();
      if (data) onSavedRef.current(data as SavedReport);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy("");
    }
  }

  // Zippie's changes from the chat: blocks, dates and name on the report; title, look and Brand Kit on the style.
  async function applyChanges(c: ChatChanges) {
    const next = applyChat(latest.current.doc, latest.current.range, c);
    const patch: Partial<State> = {};
    if (c.blocks) patch.doc = next.doc;
    if (c.range) patch.range = next.range;
    if (c.name) patch.name = c.name;
    if (c.writeSummary && !(patch.doc ?? latest.current.doc).blocks.some((b) => b.id === "summary" && b.on)) {
      const doc = patch.doc ?? latest.current.doc;
      patch.doc = { ...doc, blocks: [{ id: "summary", on: true }, ...doc.blocks.filter((b) => b.id !== "summary")] };
    }
    if (Object.keys(patch).length) change(patch);
    const look: Partial<ReportStyle> = {};
    if (c.title) look.title = c.title;
    if (c.theme) Object.assign(look, { theme: c.theme, color: c.theme.accent });
    if (c.useBrandKit) {
      const { data } = await sb.from("brand_kits").select("kit").eq("workspace_id", auth.workspaceId).eq("key", "workspace").maybeSingle();
      if (data) Object.assign(look, styleFromKit(cleanKit(data.kit)));
    }
    if (Object.keys(look).length) setStyle(look);
    if (c.writeSummary) await writeSummary();
  }

  async function makePdf() {
    setError("");
    setPdf({ state: "working" });
    try {
      await flush();
      const { jobId } = await post<{ jobId: number }>(auth, "/api/reports/pdf", { action: "start", reportId: report.id });
      const until = Date.now() + 4 * 60_000;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 2500));
        const s = await post<{ status: string; url?: string; error?: string }>(auth, "/api/reports/pdf", { action: "status", jobId });
        if (s.status === "done" && s.url) {
          window.location.assign(s.url);
          setPdf(null);
          return;
        }
        if (s.status === "failed") return setPdf({ state: "failed", error: s.error });
        if (s.status === "stalled") setPdf({ state: "stalled" });
      }
      setPdf({ state: "stalled" });
    } catch (e) {
      setPdf({ state: "failed", error: errText(e) });
    }
  }

  const theme = themeOf(style);
  function downloadHtml() {
    const el = document.getElementById("report");
    if (!el) return;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${state.name.replace(/</g, "")}</title><link rel="stylesheet" href="${fontsUrl(theme)}"><style>body{margin:0;background:${theme.paper}}${reportCss(theme)}</style></head><body>${el.outerHTML}</body></html>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = `${state.name.replace(/\W+/g, "-")}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const snap: ReportSnapshot | null = built
    ? {
        ...built.snapshot,
        style: { ...style, whiteLabel: lib.limits.whiteLabel && Boolean(style.whiteLabel) },
        blocks: state.doc.blocks,
        summary: state.doc.summary && state.doc.summary.key === built.range.key ? state.doc.summary : null,
      }
    : null;
  const connected = built?.snapshot.connected;
  const summaryOn = state.doc.blocks.some((b) => b.id === "summary" && b.on);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <button type="button" className="aw-btn aw-btn--ghost aw-btn--sm" onClick={onBack}>
          ← Reports
        </button>
        <span className="w-80">
          <input value={state.name} onChange={(e) => change({ name: e.target.value.slice(0, 120) })} readOnly={!canEdit} aria-label="Report name" className="aw-input py-1.5! text-[15px]! font-medium" />
        </span>
        <span className="text-[13px] text-body">{brand.name}</span>
        {canEdit ? <span className={`aw-micro ${saving === "failed" ? "text-neg!" : ""}`}>{saving === "saving" ? "Saving..." : saving === "failed" ? "Not saved" : "Saved"}</span> : null}
        <span className="ml-auto flex flex-wrap gap-2">
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setDialog("history")}>
            History
          </button>
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={downloadHtml} disabled={!snap}>
            Download HTML
          </button>
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={makePdf} disabled={!snap || pdf?.state === "working"}>
            {pdf?.state === "working" ? "Making PDF..." : "Download PDF"}
          </button>
          <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={() => setDialog("share")}>
            Share
          </button>
        </span>
      </div>
      <div className="print:hidden">
        <RangePicker range={state.range} onChange={(range) => change({ range })} tz={lib.tz} historyDays={lib.historyDays} />
      </div>
      {error || styleError ? <p className="aw-error print:hidden">{error || styleError}</p> : null}
      {pdf && pdf.state !== "working" ? (
        <p className="aw-callout flex flex-wrap items-center gap-3 text-[13px] print:hidden">
          {pdf.state === "failed" ? `The PDF failed. ${pdf.error ?? ""}` : "The PDF is taking longer than usual."}
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => window.print()}>
            Print instead
          </button>
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4 self-start print:hidden xl:sticky xl:top-20 xl:max-h-[calc(100vh-100px)] xl:overflow-y-auto xl:pb-4">
          <Seg
            label="Report settings"
            value={panel}
            onChange={setPanel}
            options={[
              ...(canEdit ? [{ id: "chat" as const, label: "Zippie" }] : []),
              { id: "blocks", label: "Blocks" },
              { id: "kit", label: "Brand Kit" },
              { id: "label", label: "White label" },
            ]}
          />
          {panel === "chat" ? (
            <ReportChat
              auth={auth}
              reportId={report.id}
              brand={brand.name}
              doc={state.doc}
              range={state.range}
              name={state.name}
              title={style.title ?? ""}
              theme={themeOf(style)}
              canEdit={canEdit}
              onChanges={applyChanges}
            />
          ) : panel === "blocks" ? (
            <section className="aw-frame flex flex-col p-2">
              {state.doc.blocks.map((b, i) => {
                const meta = BLOCKS.find((x) => x.id === b.id)!;
                const off = connected && ((meta.website && !connected.website) || (b.id === "content" && !connected.content));
                return (
                  <div key={b.id} className="flex items-center gap-2 px-2 py-1.5">
                    <label className="flex min-w-0 flex-1 items-center gap-2 text-[14px] text-ink">
                      <input type="checkbox" checked={b.on} disabled={!canEdit} onChange={() => change({ doc: toggleBlock(state.doc, b.id) })} className="h-4 w-4 accent-[var(--aw-brand)]" />
                      <span className="truncate">{meta.label}</span>
                    </label>
                    {off ? <span className="aw-tag">Not connected</span> : null}
                    {canEdit ? (
                      <span className="flex">
                        <button type="button" aria-label={`Move ${meta.label} up`} disabled={i === 0} onClick={() => change({ doc: moveBlock(state.doc, b.id, -1) })} className="aw-btn aw-btn--ghost aw-btn--sm px-1.5!">
                          ↑
                        </button>
                        <button type="button" aria-label={`Move ${meta.label} down`} disabled={i === state.doc.blocks.length - 1} onClick={() => change({ doc: moveBlock(state.doc, b.id, 1) })} className="aw-btn aw-btn--ghost aw-btn--sm px-1.5!">
                          ↓
                        </button>
                      </span>
                    ) : null}
                  </div>
                );
              })}
              {canEdit && summaryOn ? (
                <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm m-2" onClick={writeSummary} disabled={Boolean(busy) || loading || !built?.snapshot.ai}>
                  <AiIcon />
                  {busy === "summary" ? "Writing..." : snap?.summary ? "Rewrite AI summary" : "Write AI summary"}
                </button>
              ) : null}
            </section>
          ) : panel === "kit" ? (
            <KitPanel sb={sb} auth={auth} brand={{ id: brand.id, name: brand.name, domain: brand.domain }} canEdit={canEdit} clientKits={lib.limits.whiteLabel} onUse={(k) => setStyle(k)} />
          ) : (
            <LabelPanel auth={auth} style={style} setStyle={setStyle} website={website} setWebsite={setWebsite} canEdit={canEdit} whiteLabel={lib.limits.whiteLabel} />
          )}
        </aside>

        <div className="min-w-0">
          {snap ? (
            <div aria-busy={loading} className={`min-h-[80vh] min-w-0 overflow-hidden border border-rule transition-opacity print:min-h-0 print:border-0 ${loading ? "opacity-60" : ""}`} style={{ background: theme.paper }}>
              <ReportDoc r={snap} editing={canEdit} />
            </div>
          ) : error ? null : (
            <Thinking text="Pulling your report together..." />
          )}
        </div>
      </div>

      {dialog === "share" ? <ShareReport sb={sb} auth={auth} reportId={report.id} live limits={lib.limits} canEdit={canEdit} beforeShare={flush} onClose={() => setDialog(null)} /> : null}
      {dialog === "history" ? (
        <History
          sb={sb}
          reportId={report.id}
          canEdit={canEdit}
          onSave={async (name) => {
            await flush();
            await addVersion(latest.current, name);
          }}
          onRestore={async (v) => {
            await flush();
            await addVersion(latest.current, "Before restore");
            change({ doc: parseDoc(v.doc), range: parseRange(v.range) });
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

/** Versions of a report: save one by name, or go back to one. Restoring saves the current one first, so nothing is lost. */
function History({ sb, reportId, canEdit, onSave, onRestore, onClose }: { sb: SupabaseClient; reportId: string; canEdit: boolean; onSave: (name: string) => Promise<void>; onRestore: (v: Version) => Promise<void>; onClose: () => void }) {
  const [list, setList] = useState<Version[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    sb.from("report_versions")
      .select("id, name, doc, range, created_at")
      .eq("report_id", reportId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setError(error.message);
        else setList((data ?? []) as Version[]);
      });
    return () => {
      live = false;
    };
  }, [sb, reportId, tick]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <Modal title="History" onClose={onClose}>
      {canEdit ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run("save", async () => {
              await onSave(name.trim());
              setName("");
              setTick((t) => t + 1);
            });
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Version name" aria-label="Version name" className="aw-input min-w-0 flex-1 py-2! text-[14px]!" />
          <button type="submit" className="aw-btn aw-btn--primary aw-btn--sm" disabled={Boolean(busy) || !name.trim()}>
            Save version
          </button>
        </form>
      ) : null}
      {error ? <p className="aw-error">{error}</p> : null}
      <ul className="flex flex-col divide-y divide-rule border border-rule">
        {(list ?? []).map((v) => (
          <li key={v.id} className="flex items-center gap-3 px-3 py-2 text-[14px]">
            <span className="min-w-0 flex-1 truncate text-ink">{v.name || "Autosave"}</span>
            <span className="text-[13px] text-muted" title={new Date(v.created_at).toLocaleString()}>
              {ago(v.created_at)}
            </span>
            {canEdit ? (
              <button type="button" className="aw-btn aw-btn--ghost aw-btn--sm" disabled={Boolean(busy)} onClick={() => run(v.id, () => onRestore(v))}>
                {busy === v.id ? "Restoring..." : "Restore"}
              </button>
            ) : null}
          </li>
        ))}
        {list && !list.length ? <li className="px-3 py-2 text-[13px] text-muted">No versions yet.</li> : null}
      </ul>
    </Modal>
  );
}
