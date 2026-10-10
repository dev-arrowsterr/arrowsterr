"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { CMS, type CmsConnection, type Published } from "@/lib/cmsTypes";
import { getDocMeta } from "@/lib/db";
import type { RunAuth } from "@/lib/runner";
import type { DocPublishMeta } from "@/lib/writerAgent";
import { SidePanel, Thinking } from "../ui";
import { downloadCsv, post } from "./shared";

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

/** Send a draft to a connected CMS, as a draft or live, with its SEO details. */
export function PublishPanel({ sb, auth, docId, title, html, onClose }: { sb: SupabaseClient; auth: RunAuth; docId: string; title: string; html: () => string; onClose: () => void }) {
  const [conns, setConns] = useState<CmsConnection[] | null>(null);
  const [meta, setMeta] = useState<(DocPublishMeta & { published?: Published[] }) | null>(null);
  const [f, setF] = useState({ title, slug: slugify(title), description: "", image: "", schema: "" });
  const [to, setTo] = useState("");
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Published | null>(null);

  useEffect(() => {
    let on = true;
    Promise.all([post<{ connections: CmsConnection[] }>(auth, "/api/cms", { action: "list" }).catch(() => ({ connections: [] })), getDocMeta(sb, docId)]).then(([c, m]) => {
      if (!on) return;
      setConns(c.connections);
      setTo(c.connections[0]?.id ?? "");
      const pm = m as DocPublishMeta & { published?: Published[] };
      setMeta(pm);
      setF((x) => ({ title: pm.title || x.title, slug: pm.slug || x.slug, description: pm.description ?? "", image: pm.image ?? "", schema: pm.schema ?? "" }));
    });
    return () => {
      on = false;
    };
  }, [auth, sb, docId]);

  async function publish() {
    setBusy(true);
    setError("");
    setDone(null);
    try {
      const r = await post<{ published: Published }>(auth, "/api/cms", { action: "publish", docId, connectionId: to, live, ...f, html: html() });
      setDone(r.published);
      setMeta((m) => ({ ...(m ?? {}), published: [...(m?.published ?? []).filter((p) => p.connectionId !== to), r.published] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
  const before = meta?.published?.find((p) => p.connectionId === to);
  const conn = conns?.find((c) => c.id === to);

  return (
    <SidePanel narrow kicker="Agentic Writer" title="Publish" onClose={onClose}>
      {!conns || !meta ? (
        <Thinking text="Loading..." />
      ) : (
        <div className="flex flex-col gap-5">
          {conns.length ? (
            <label className="flex flex-col gap-1.5">
              <span className="aw-label">Publish to</span>
              <select value={to} onChange={(e) => setTo(e.target.value)} className="aw-input py-2! text-[14px]!">
                {conns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {CMS.find((x) => x.id === c.kind)?.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="aw-callout">No CMS connected yet. An admin can connect WordPress, Webflow, Shopify, HubSpot or Ghost in Settings → Workspace & members.</div>
          )}
          {field("title", "Title", `${f.title.length} characters`)}
          {field("slug", "Slug", "")}
          {field("description", "Meta description", `${f.description.length}/155`, true)}
          {field("image", "Featured image URL", "")}
          {field("schema", "Schema (JSON-LD)", f.schema ? "Added to the post" : "Optional", true)}

          {conns.length ? (
            <div className="flex flex-col gap-3 border-t border-rule-faint pt-4">
              <div role="radiogroup" aria-label="Publish as" className="flex gap-2">
                {[
                  { v: false, label: "As a draft" },
                  { v: true, label: "Live now" },
                ].map((o) => (
                  <button key={o.label} type="button" role="radio" aria-checked={live === o.v} onClick={() => setLive(o.v)} className={`aw-chip ${live === o.v ? "aw-chip--brand" : ""}`}>
                    {o.label}
                  </button>
                ))}
              </div>
              <button type="button" className="aw-btn aw-btn--primary self-start" disabled={busy || !to || !f.title.trim()} onClick={publish}>
                {busy ? "Publishing..." : before ? `Update on ${conn?.name}` : `Publish to ${conn?.name}`}
              </button>
              {before && !done ? <span className="text-[12px] text-muted">Sent {new Date(before.at).toLocaleString()}. Publishing again updates the same post.</span> : null}
            </div>
          ) : null}
          {error ? <p className="aw-error">{error}</p> : null}
          {done ? (
            <div className="aw-callout flex flex-col gap-1">
              <span>{done.live ? "Published live." : "Saved as a draft."}</span>
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
