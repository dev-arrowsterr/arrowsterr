"use client";

import { useEffect, useState } from "react";
import { CMS_GUIDE } from "@/lib/cmsGuide";
import { CMS, type CmsConnection, type CmsKind } from "@/lib/cmsTypes";
import type { RunAuth } from "@/lib/runner";
import { Modal } from "./reports/Dialog";

async function call<T>(auth: RunAuth, body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/cms", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` },
    body: JSON.stringify({ ...body, workspaceId: auth.workspaceId }),
  });
  const out = await res.json().catch(() => ({ error: `The server returned ${res.status}.` }));
  if (!res.ok) throw new Error(out.error ?? `The server returned ${res.status}.`);
  return out as T;
}

/**
 * Connect a CMS step by step, opened from a card in Zippie's chat: pick the platform, follow the
 * numbered steps with a button that opens the right admin screen, paste the keys, and test.
 */
export function ConnectWizard({ auth, platform, onClose, onConnected }: { auth: RunAuth; platform?: CmsKind | null; onClose: () => void; onConnected: (c: CmsConnection) => void }) {
  const [kind, setKind] = useState<CmsKind | null>(platform ?? null);
  const [list, setList] = useState<CmsConnection[] | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ c: CmsConnection; check: string } | null>(null);

  useEffect(() => {
    let live = true;
    call<{ connections: CmsConnection[] }>(auth, { action: "list" })
      .then((r) => live && setList(r.connections))
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, [auth]);

  const spec = CMS.find((c) => c.id === kind);
  const guide = kind ? CMS_GUIDE[kind] : null;
  const link = guide?.open(form) ?? null;
  const missing = spec ? spec.fields.filter((f) => !f.optional && !(form[f.id] ?? "").trim()) : [];

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!spec) return;
    setBusy(true);
    setError("");
    try {
      const { name, ...config } = form;
      const r = await call<{ connection: CmsConnection; check: string }>(auth, { action: "connect", kind: spec.id, name: name?.trim() || spec.label, config });
      setDone({ c: r.connection, check: r.check });
      onConnected(r.connection);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={done ? `${spec?.label ?? "CMS"} connected` : spec ? `Connect ${spec.label}` : "Connect your CMS"} onClose={onClose} width="max-w-xl">
      {done ? (
        <div className="flex flex-col gap-4">
          <p className="text-[14px] text-body">
            Zippie can now read and fix pages on {done.c.name}. {done.check}.
          </p>
          {done.c.kind === "wordpress" ? (
            <ol className="zp-wiz-steps">
              <li>
                <span className="text-ink">Download the Arrowsterr Connector plugin.</span>
                <a href="/downloads/arrowsterr-connector.zip" download className="aw-btn aw-btn--secondary aw-btn--sm mt-2 self-start">
                  Download the plugin
                </a>
              </li>
              <li>In WordPress, open Plugins, then Add New, then Upload Plugin. Pick the file and click Activate.</li>
              <li>That lets Zippie set SEO titles, meta descriptions and structured data. It works with Yoast SEO and Rank Math.</li>
            </ol>
          ) : null}
          <button type="button" className="aw-btn aw-btn--primary aw-btn--sm self-end" onClick={onClose}>
            Done
          </button>
        </div>
      ) : !spec || !guide ? (
        <div className="flex flex-col gap-3">
          {list?.length ? <p className="text-[13px] text-muted">Connected: {list.map((c) => c.name).join(", ")}</p> : null}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CMS.map((c) => (
              <button key={c.id} type="button" className="zp-wiz-tile" onClick={() => setKind(c.id)}>
                <span className="text-[15px] font-medium text-ink">{c.label}</span>
                <span className="text-[12px] text-muted">{list?.some((x) => x.kind === c.id) ? "Connected" : "Connect"}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <form onSubmit={connect} className="flex flex-col gap-4">
          <p className="text-[14px] text-body">{guide.blurb}</p>
          <ol className="zp-wiz-steps">
            {guide.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          {spec.fields.map((f, i) => (
            <label key={f.id} className="flex flex-col gap-1.5">
              <span className="aw-label">
                {f.label}
                {f.optional ? " (optional)" : ""}
              </span>
              <input
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                autoFocus={i === 0}
                value={form[f.id] ?? ""}
                onChange={(e) => setForm({ ...form, [f.id]: e.target.value })}
                placeholder={f.placeholder}
                className="aw-input py-2! text-[14px]!"
              />
              {i === 0 && link ? (
                <a href={link.href} target="_blank" rel="noopener noreferrer" className="aw-btn aw-btn--secondary aw-btn--sm mt-1 self-start">
                  {link.label} ↗
                </a>
              ) : null}
            </label>
          ))}
          {error ? <p className="aw-error">{error}</p> : null}
          <div className="flex justify-between gap-2">
            <button type="button" className="aw-btn aw-btn--ghost aw-btn--sm" onClick={() => (platform ? onClose() : setKind(null))}>
              {platform ? "Cancel" : "Back"}
            </button>
            <button type="submit" className="aw-btn aw-btn--primary aw-btn--sm" disabled={busy || missing.length > 0}>
              {busy ? "Testing..." : "Test and connect"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
