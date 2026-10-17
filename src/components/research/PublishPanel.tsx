"use client";

import { DateField, Dropdown } from "../Pickers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CMS, type CmsConnection, type Published } from "@/lib/cmsTypes";
import { getDocMeta } from "@/lib/db";
import type { RunAuth } from "@/lib/runner";
import type { DocPublishMeta } from "@/lib/writerAgent";
import { SidePanel, Thinking } from "../ui";
import { downloadCsv, post } from "./shared";

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
const pad = (n: number) => String(n).padStart(2, "0");
const TIMES = Array.from({ length: 48 }, (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 ? "30" : "00"}`);
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

type Mode = "draft" | "publish" | "schedule";
/** A WordPress post this draft became, as the server last read it back (wpSyncServer.ts pubView). */
export type Publication = {
  id: string;
  connectionId: string;
  remoteId: string | null;
  url: string | null;
  status: "draft" | "pending" | "private" | "future" | "publish" | "trash" | "deleted" | null;
  modified: string | null;
  edited: boolean;
  mode: Mode | null;
  scheduledFor: string | null;
  options: { slug?: string; categoryId?: number | null; tags?: string[]; metaTitle?: string; metaDescription?: string; image?: string };
  error: string | null;
  pushedAt: string | null;
  syncedAt: string | null;
  syncError?: string;
};
type Defaults = { dueDate?: string | null; slug?: string; metaTitle?: string; metaDescription?: string };
type Site = { categories: { id: number; name: string }[]; plugin: { version: string; current: boolean } | null };

/** Read every WordPress post of a draft back from its site: status, address, last edit, or deleted. For the library and the panel. */
export const syncPublished = (auth: RunAuth, docId: string) => post<{ publications: Publication[]; setup?: string }>(auth, "/api/cms", { action: "sync", docId });

const STATE: Record<NonNullable<Publication["status"]>, { label: string; tone: string }> = {
  publish: { label: "Live", tone: "aw-status--ranked" },
  future: { label: "Scheduled", tone: "aw-status--warn" },
  draft: { label: "Draft", tone: "aw-status--pending" },
  pending: { label: "Pending review", tone: "aw-status--pending" },
  private: { label: "Private", tone: "aw-status--pending" },
  trash: { label: "In trash", tone: "aw-status--missed" },
  deleted: { label: "Deleted in WordPress", tone: "aw-status--missed" },
};

/** Send a draft to a connected CMS, as a draft, live or on a date, with its SEO details. WordPress posts stay in sync. */
export function PublishPanel({ sb, auth, docId, title, html, onClose }: { sb: SupabaseClient; auth: RunAuth; docId: string; title: string; html: () => string; onClose: () => void }) {
  const [conns, setConns] = useState<CmsConnection[] | null>(null);
  const [pubs, setPubs] = useState<Publication[]>([]);
  const [meta, setMeta] = useState<(DocPublishMeta & { published?: Published[] }) | null>(null);
  const [f, setF] = useState({ title, slug: slugify(title), metaTitle: "", description: "", image: "", schema: "", tags: "" });
  const [to, setTo] = useState("");
  const [mode, setMode] = useState<Mode>("draft");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("09:00");
  const [category, setCategory] = useState("");
  const [siteFor, setSiteFor] = useState<{ id: string; site?: Site; error?: string } | null>(null);
  const [now] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [setup, setSetup] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [done, setDone] = useState<Published | null>(null);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await syncPublished(auth, docId);
      if (r.setup) setSetup(r.setup);
      setPubs(r.publications);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [auth, docId]);

  useEffect(() => {
    let on = true;
    // Only the sites of the draft's own brand.
    Promise.all([
      post<{ connections: CmsConnection[]; publications: Publication[]; defaults: Defaults; setup?: string }>(auth, "/api/cms", { action: "publish_info", docId }).catch((e) => ({ connections: [] as CmsConnection[], publications: [] as Publication[], defaults: {}, setup: e instanceof Error ? e.message : String(e) })),
      getDocMeta(sb, docId),
    ]).then(([c, m]) => {
      if (!on) return;
      setConns(c.connections);
      setPubs(c.publications);
      setSetup(c.setup ?? "");
      const first = c.connections[0]?.id ?? "";
      setTo(first);
      const pm = m as DocPublishMeta & { published?: Published[] };
      setMeta(pm);
      const d: Defaults = c.defaults ?? {};
      setF((x) => ({ ...x, title: pm.title || x.title, slug: pm.slug || d.slug || x.slug, metaTitle: d.metaTitle || "", description: pm.description || d.metaDescription || "", image: pm.image ?? "", schema: pm.schema ?? "" }));
      if (d.dueDate) setDay(d.dueDate);
      applyPub(c.publications.find((p) => p.connectionId === first));
      // Read the posts back from WordPress, so an edit or delete there shows here.
      if (c.publications.some((p) => p.remoteId)) void sync();
    });
    return () => {
      on = false;
    };
  }, [auth, sb, docId, sync]);

  const conn = conns?.find((c) => c.id === to);
  const wp = conn?.kind === "wordpress";
  const pub = pubs.find((p) => p.connectionId === to) ?? null;
  const before = meta?.published?.find((p) => p.connectionId === to);
  const gone = pub?.status === "deleted" || pub?.status === "trash";

  // The WordPress site's categories and plugin.
  useEffect(() => {
    if (!wp || !to) return;
    let on = true;
    post<Site>(auth, "/api/cms", { action: "wp_site", docId, connectionId: to })
      .then((s) => on && setSiteFor({ id: to, site: s }))
      .catch((e) => on && setSiteFor({ id: to, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      on = false;
    };
  }, [auth, docId, to, wp]);
  const site = siteFor?.id === to ? (siteFor.site ?? null) : null;
  const siteError = siteFor?.id === to ? (siteFor.error ?? "") : "";

  /** Start from what a site's post had last time: its options, and its schedule or live state. */
  function applyPub(p: Publication | undefined) {
    setCategory(p?.options?.categoryId ? String(p.options.categoryId) : "");
    if (!p) return;
    const o = p.options ?? {};
    setF((x) => ({ ...x, slug: o.slug || x.slug, metaTitle: o.metaTitle || x.metaTitle, description: o.metaDescription || x.description, image: o.image || x.image, tags: o.tags?.length ? o.tags.join(", ") : x.tags }));
    if (p.status === "future" && p.scheduledFor) {
      const d = new Date(p.scheduledFor);
      setMode("schedule");
      setDay(localDay(d));
      setTime(`${pad(d.getHours())}:${d.getMinutes() < 30 ? "00" : "30"}`);
    } else if (p.status === "publish") setMode("publish");
  }
  function pickSite(id: string) {
    setTo(id);
    if (conns?.find((c) => c.id === id)?.kind !== "wordpress" && mode === "schedule") setMode("draft");
    applyPub(pubs.find((p) => p.connectionId === id));
  }

  const scheduleAt = useMemo(() => (day ? new Date(`${day}T${time}:00`).toISOString() : ""), [day, time]);
  const [hasModules] = useState(() => /data-aw-module=|data-embed=/.test(html()));

  async function publish() {
    setBusy(true);
    setError("");
    setWarnings([]);
    setDone(null);
    try {
      const r = await post<{ published: Published; publication?: Publication; warnings?: string[] }>(auth, "/api/cms", {
        action: "publish",
        docId,
        connectionId: to,
        live: mode === "publish",
        mode,
        scheduleAt: mode === "schedule" ? scheduleAt : null,
        categoryId: category ? Number(category) : null,
        tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
        asNew: gone,
        title: f.title,
        slug: f.slug,
        metaTitle: f.metaTitle,
        description: f.description,
        image: f.image,
        schema: f.schema,
        html: html(),
      });
      setDone(r.published);
      setWarnings(r.warnings ?? []);
      const p = r.publication;
      if (p) setPubs((l) => [...l.filter((x) => x.connectionId !== to), p]);
      setMeta((m) => ({ ...(m ?? {}), published: [...(m?.published ?? []).filter((x) => x.connectionId !== to), r.published] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (wp) void sync();
    } finally {
      setBusy(false);
    }
  }

  const field = (id: keyof typeof f, label: string, hint: string, area = false) => (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between">
        <span className="aw-label">{label}</span>
        <span className="text-[11px] text-muted">{hint}</span>
      </span>
      {area ? (
        <textarea value={f[id]} onChange={(e) => setF({ ...f, [id]: e.target.value })} rows={id === "schema" ? 5 : 3} className="aw-textarea text-[13px]!" />
      ) : (
        <input value={f[id]} onChange={(e) => setF({ ...f, [id]: e.target.value })} className="aw-input py-2! text-[14px]!" />
      )}
    </label>
  );

  const modes: { v: Mode; label: string }[] = wp
    ? [
        { v: "draft", label: "Draft" },
        { v: "publish", label: "Publish now" },
        { v: "schedule", label: "Schedule" },
      ]
    : [
        { v: "draft", label: "As a draft" },
        { v: "publish", label: "Live now" },
      ];
  const late = mode === "schedule" && scheduleAt && Date.parse(scheduleAt) < now;
  const action = gone
    ? "Publish as new post"
    : pub?.remoteId || before
      ? mode === "schedule"
        ? `Schedule on ${conn?.name}`
        : `Update on ${conn?.name}`
      : mode === "schedule"
        ? `Schedule on ${conn?.name}`
        : mode === "draft" && wp
          ? `Save draft to ${conn?.name}`
          : `Publish to ${conn?.name}`;
  const state = pub?.status ? STATE[pub.status] : null;

  return (
    <SidePanel narrow kicker="Agentic Writer" title="Publish" onClose={onClose}>
      {!conns || !meta ? (
        <Thinking text="Loading..." />
      ) : (
        <div className="flex flex-col gap-5">
          {setup ? <div className="aw-callout">{setup}</div> : null}
          {conns.length ? (
            <label className="flex flex-col gap-1.5">
              <span className="aw-label">Publish to</span>
              <Dropdown label="Publish to" value={to} onChange={pickSite} className="aw-dropdown--field w-full" options={conns.map((c) => ({ id: c.id, label: `${c.name} · ${CMS.find((x) => x.id === c.kind)?.label ?? ""}` }))} />
            </label>
          ) : (
            <div className="aw-callout">No publishing site for this brand. An admin can connect one in Settings → Brand → Publishing sites.</div>
          )}

          {wp && pub?.remoteId ? (
            <div className="flex flex-col gap-2 border-y border-rule-faint py-3">
              <span className="flex flex-wrap items-center gap-2">
                {state ? <span className={`aw-status ${state.tone}`}>{state.label}</span> : null}
                {pub.status === "future" && pub.scheduledFor ? <span className="text-[13px] text-ink">{when(pub.scheduledFor)}</span> : null}
                {pub.edited && !gone ? <span className="aw-status aw-status--warn">Edited in WordPress</span> : null}
                <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm ml-auto" disabled={syncing} onClick={() => void sync()}>
                  {syncing ? "Syncing..." : "Sync"}
                </button>
              </span>
              {pub.url && !gone ? (
                <a href={pub.url} target="_blank" rel="noopener noreferrer" className="truncate text-[13px]">
                  {pub.url}
                </a>
              ) : null}
              {pub.syncedAt ? <span className="text-[12px] text-muted">Synced {when(pub.syncedAt)}</span> : null}
              {pub.syncError ? <p className="aw-error">{pub.syncError}</p> : null}
            </div>
          ) : null}

          {field("title", "Title", `${f.title.length} characters`)}
          {field("slug", "Slug", "")}
          {wp ? field("metaTitle", "Meta title", `${f.metaTitle.length}/60`) : null}
          {field("description", "Meta description", `${f.description.length}/155`, true)}
          {field("image", "Featured image URL", "")}
          {wp ? (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="aw-label">Category</span>
                <Dropdown
                  label="Category"
                  value={category}
                  onChange={setCategory}
                  disabled={!site}
                  placeholder={site ? "No category" : siteError ? "Unavailable" : "Loading..."}
                  className="aw-dropdown--field w-full"
                  options={[{ id: "", label: "No category" }, ...(site?.categories ?? []).map((c) => ({ id: String(c.id), label: c.name }))]}
                />
              </label>
              {field("tags", "Tags", "Comma-separated")}
            </>
          ) : null}
          {field("schema", "Schema (JSON-LD)", f.schema ? "Added to the post" : "Optional", true)}
          {siteError ? <p className="aw-error">{siteError}</p> : null}
          {wp && site && hasModules && !site.plugin?.current ? (
            <div className="aw-callout flex flex-col gap-2 text-[13px]">
              <span>{site.plugin ? `Arrowsterr Connector ${site.plugin.version} is out of date.` : "Arrowsterr Connector is not installed."} Modules publish at a fixed height without version 1.1.</span>
              <a href="/downloads/arrowsterr-connector.zip" download className="aw-btn aw-btn--secondary aw-btn--sm self-start">
                Download the plugin
              </a>
            </div>
          ) : null}

          {conns.length ? (
            <div className="flex flex-col gap-3 border-t border-rule-faint pt-4">
              <div role="radiogroup" aria-label="Publish as" className="flex gap-2">
                {modes.map((o) => (
                  <button key={o.v} type="button" role="radio" aria-checked={mode === o.v} onClick={() => setMode(o.v)} className={`aw-chip ${mode === o.v ? "aw-chip--brand" : ""}`}>
                    {o.label}
                  </button>
                ))}
              </div>
              {wp && mode === "schedule" ? (
                <div className="flex gap-2">
                  <DateField label="Publish date" value={day} onChange={(v) => setDay(v ?? "")} className="aw-dropdown--field flex-1" clearable={false} />
                  <Dropdown label="Publish time" value={time} onChange={setTime} className="aw-dropdown--field w-28" options={TIMES.map((t) => ({ id: t, label: t }))} />
                </div>
              ) : null}
              {late ? <p className="aw-error">That time has passed. It publishes now.</p> : null}
              <button type="button" className="aw-btn aw-btn--primary self-start" disabled={busy || !to || !f.title.trim() || (wp && mode === "schedule" && !day)} onClick={publish}>
                {busy ? "Publishing..." : action}
              </button>
            </div>
          ) : null}
          {error ? <p className="aw-error">{error}</p> : null}
          {warnings.map((w) => (
            <p key={w} className="aw-error">
              {w}
            </p>
          ))}
          {done ? (
            <div className="aw-callout flex flex-col gap-1">
              <span>{done.status === "future" ? "Scheduled." : done.live ? "Published live." : "Saved as a draft."}</span>
              {done.url ? (
                <a href={done.url} target="_blank" rel="noopener noreferrer">
                  {done.url}
                </a>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-2 border-t border-rule-faint pt-4">
            <span className="aw-label">Framer</span>
            <span className="text-[13px] text-muted">Framer has no publishing API. Download a CSV and import it into your Framer CMS collection.</span>
            <button
              type="button"
              className="aw-btn aw-btn--secondary aw-btn--sm self-start"
              onClick={() => downloadCsv(`${f.slug || "post"}-framer.csv`, ["Title", "Slug", "Content", "Meta Description", "Image"], [[f.title, f.slug, html(), f.description, f.image]])}
            >
              Download for Framer
            </button>
          </div>
        </div>
      )}
    </SidePanel>
  );
}
