"use client";

import { useEffect, useState } from "react";
import { CMS, type CmsConnection, type CmsKind } from "@/lib/cmsTypes";
import type { RunAuth } from "@/lib/runner";
import { post } from "./research/shared";

/** Connect the CMSs this workspace publishes to. Admins only; keys are tested, then kept on the server. */
export function CmsSettings({ auth, isAdmin }: { auth: RunAuth; isAdmin: boolean }) {
  const [list, setList] = useState<CmsConnection[] | null>(null);
  const [setup, setSetup] = useState("");
  const [kind, setKind] = useState<CmsKind | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let live = true;
    post<{ connections: CmsConnection[]; setup?: string }>(auth, "/api/cms", { action: "list" })
      .then((r) => {
        if (!live) return;
        setList(r.connections);
        setSetup(r.setup ?? "");
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [auth]);

  const spec = CMS.find((c) => c.id === kind);
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!spec) return;
    setBusy(true);
    setError("");
    try {
      const { name, ...config } = form;
      const r = await post<{ connection: CmsConnection; check: string }>(auth, "/api/cms", { action: "connect", kind: spec.id, name, config });
      setList([...(list ?? []), r.connection]);
      setNotice(`${spec.label} connected. ${r.check}.`);
      setKind(null);
      setForm({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(c: CmsConnection) {
    if (!confirm(`Disconnect ${c.name}?`)) return;
    try {
      await post(auth, "/api/cms", { action: "remove", id: c.id });
      setList((l) => (l ?? []).filter((x) => x.id !== c.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="aw-h4">Publishing</h2>
      <p className="max-w-2xl text-[14px] text-body">Connect your CMS once. Then the Agentic Writer sends any draft straight to it, as a draft or live, with its title, slug, meta description, featured image and schema.</p>
      {setup ? <div className="aw-callout max-w-2xl">{setup}</div> : null}
      {error ? <p className="aw-error max-w-2xl">{error}</p> : null}
      {notice ? <div className="aw-callout max-w-2xl">{notice}</div> : null}

      {list?.length ? (
        <ul className="aw-frame flex max-w-2xl flex-col divide-y divide-rule-faint">
          {list.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <span className="flex flex-col">
                <span className="text-[15px] text-ink">{c.name}</span>
                <span className="text-[12px] text-muted">{CMS.find((x) => x.id === c.kind)?.label}</span>
              </span>
              {isAdmin ? (
                <button type="button" className="aw-text-link text-[13px] text-neg!" onClick={() => remove(c)}>
                  Disconnect
                </button>
              ) : null}
            </li>
          ))}
        </ul>
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
    </section>
  );
}
