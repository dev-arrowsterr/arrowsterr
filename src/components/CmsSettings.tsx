"use client";

import { useEffect, useState } from "react";
import { CMS, type CmsConnection, type CmsKind } from "@/lib/cmsTypes";
import type { RunAuth } from "@/lib/runner";
import { Dropdown } from "./Pickers";
import { Confirm } from "./reports/Dialog";
import { post } from "./research/shared";

type BrandRef = { id: string; name: string };

/** Connect the sites this brand publishes to. Admins only; keys are tested, then kept on the server. */
export function CmsSettings({ auth, isAdmin, brand, brands }: { auth: RunAuth; isAdmin: boolean; brand: BrandRef; brands: BrandRef[] }) {
  const [list, setList] = useState<CmsConnection[] | null>(null);
  const [setup, setSetup] = useState("");
  const [notice, setNotice] = useState(false);
  const [kind, setKind] = useState<CmsKind | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [removing, setRemoving] = useState<CmsConnection | null>(null);

  useEffect(() => {
    let live = true;
    post<{ connections: CmsConnection[]; setup?: string; notice?: boolean }>(auth, "/api/cms", { action: "list", brandId: brand.id })
      .then((r) => {
        if (!live) return;
        setList(r.connections);
        setSetup(r.setup ?? "");
        setNotice(Boolean(r.notice));
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [auth, brand.id]);

  const spec = CMS.find((c) => c.id === kind);
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!spec) return;
    setBusy(true);
    setError("");
    try {
      const { name, ...config } = form;
      const r = await post<{ connection: CmsConnection; check: string }>(auth, "/api/cms", { action: "connect", kind: spec.id, name, config, brandId: brand.id });
      setList([...(list ?? []), r.connection]);
      setDone(`${spec.label} connected. ${r.check}.`);
      setKind(null);
      setForm({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(c: CmsConnection) {
    setBusy(true);
    try {
      await post(auth, "/api/cms", { action: "remove", id: c.id });
      setList((l) => (l ?? []).filter((x) => x.id !== c.id));
      setRemoving(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  /** Give a site to another brand. It leaves this brand's list. */
  async function move(c: CmsConnection, to: string) {
    if (to === brand.id) return;
    setError("");
    try {
      await post(auth, "/api/cms", { action: "move", id: c.id, brandId: to });
      setList((l) => (l ?? []).filter((x) => x.id !== c.id));
      setDone(`${c.name} moved to ${brands.find((b) => b.id === to)?.name ?? "the other brand"}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function dismiss() {
    setNotice(false);
    await post(auth, "/api/cms", { action: "dismiss" }).catch(() => {});
  }

  return (
    <section className="flex flex-col gap-3">
      {setup ? <div className="aw-callout max-w-2xl">{setup}</div> : null}
      {notice && isAdmin ? (
        <div className="aw-callout flex max-w-2xl items-start justify-between gap-3">
          <span>Each brand now has its own publishing sites. Your sites were added to {brands[0]?.name ?? "your first brand"}. Move any that belong to another brand.</span>
          <button type="button" className="aw-text-link shrink-0 text-[13px]" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      ) : null}
      {error ? <p className="aw-error max-w-2xl">{error}</p> : null}
      {done ? <div className="aw-callout max-w-2xl">{done}</div> : null}

      {list?.length ? (
        <ul className="aw-frame flex max-w-2xl flex-col divide-y divide-rule-faint">
          {list.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <span className="flex flex-col">
                <span className="text-[15px] text-ink">{c.name}</span>
                <span className="text-[12px] text-muted">{CMS.find((x) => x.id === c.kind)?.label}</span>
              </span>
              {isAdmin ? (
                <span className="flex items-center gap-3">
                  {brands.length > 1 ? (
                    <Dropdown label="Brand" value={brand.id} onChange={(to) => move(c, to)} className="aw-dropdown--sm" options={brands.map((b) => ({ id: b.id, label: b.name }))} />
                  ) : null}
                  <button type="button" className="aw-text-link text-[13px] text-neg!" onClick={() => setRemoving(c)}>
                    Disconnect
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : list && !setup ? (
        <p className="text-[14px] text-muted">No publishing sites for {brand.name}.</p>
      ) : null}
      {list?.some((c) => c.kind === "wordpress") || kind === "wordpress" ? (
        <div className="aw-callout flex max-w-2xl flex-col gap-2 text-[14px]">
          <span className="font-medium text-ink">Arrowsterr Connector for WordPress (1.1)</span>
          <span>
            Install it so articles publish with their interactive modules and SEO titles, and Zippie can set meta descriptions and structured data. It works with Yoast SEO and Rank Math. In WordPress, open Plugins → Add New → Upload Plugin, pick the file, then Activate. To update, upload the new file and choose Replace current with uploaded.
          </span>
          <a href="/downloads/arrowsterr-connector.zip" download className="aw-btn aw-btn--secondary aw-btn--sm self-start">
            Download the plugin
          </a>
        </div>
      ) : null}

      {isAdmin && !setup ? (
        <div className="flex flex-wrap gap-2">
          {CMS.map((c) => (
            <button key={c.id} type="button" className={`aw-chip ${kind === c.id ? "aw-chip--brand" : ""}`} onClick={() => setKind(kind === c.id ? null : c.id)}>
              + {c.label}
            </button>
          ))}
          <span className="aw-chip opacity-70" title="Framer has no publishing API. Download a CSV from the writer and import it into a Framer CMS collection.">
            Framer · CSV import
          </span>
        </div>
      ) : null}

      {spec ? (
        <form onSubmit={connect} className="aw-frame flex max-w-2xl flex-col gap-4 p-5">
          <span className="aw-h4">Connect {spec.label}</span>
          <p className="text-[13px] text-muted">{spec.help}</p>
          <label className="flex flex-col gap-1.5">
            <span className="aw-label">Name</span>
            <input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={`${spec.label} blog`} className="aw-input py-2! text-[14px]!" />
          </label>
          {spec.fields.map((f) => (
            <label key={f.id} className="flex flex-col gap-1.5">
              <span className="aw-label">
                {f.label}
                {f.optional ? " (optional)" : ""}
              </span>
              <input
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                value={form[f.id] ?? ""}
                onChange={(e) => setForm({ ...form, [f.id]: e.target.value })}
                placeholder={f.placeholder}
                className="aw-input py-2! text-[14px]!"
              />
            </label>
          ))}
          <span className="flex gap-2">
            <button type="submit" className="aw-btn aw-btn--primary aw-btn--sm" disabled={busy}>
              {busy ? "Testing..." : "Test and connect"}
            </button>
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setKind(null)}>
              Cancel
            </button>
          </span>
        </form>
      ) : null}

      {removing ? <Confirm title="Disconnect site" text={`Disconnect ${removing.name}? Articles already published stay on the site.`} action="Disconnect" busy={busy} onConfirm={() => remove(removing)} onClose={() => setRemoving(null)} /> : null}
    </section>
  );
}
