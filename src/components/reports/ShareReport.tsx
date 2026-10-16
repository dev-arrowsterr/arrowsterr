"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import type { ReportLimits } from "@/lib/plans";
import type { RunAuth } from "@/lib/runner";
import { Dropdown } from "../Pickers";
import { Seg } from "../ui";
import { Modal } from "./Dialog";
import { ago, errText, post } from "./reportApi";

type Link = { id: string; token: string; mode: "live" | "frozen"; expires_at: string | null; revoked_at: string | null; views: number; last_viewed_at: string | null; created_at: string; locked: boolean };
const LINK_COLS = "id, token, mode, expires_at, revoked_at, views, last_viewed_at, created_at, locked";
const EXPIRES = [
  { id: "0", label: "Never" },
  { id: "7", label: "In 7 days" },
  { id: "30", label: "In 30 days" },
  { id: "90", label: "In 90 days" },
];

const past = (iso: string) => Date.parse(iso) < Date.now();
const linkUrl = (token: string) => `${window.location.origin}/r/${token}`;
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Share a saved report (docs/reports.md, section 13.1): make live or frozen links, and see or revoke the ones made before. */
export function ShareReport({
  sb,
  auth,
  reportId,
  live: canLive,
  limits,
  canEdit,
  data,
  beforeShare,
  onClose,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  reportId: string;
  /** Client reports can be live. The others are built in the browser, so they freeze. */
  live: boolean;
  limits: ReportLimits;
  canEdit: boolean;
  /** The frozen copy for a report built in the browser. */
  data?: object | null;
  /** Save pending edits first, so a link shows what's on screen. */
  beforeShare?: () => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"live" | "frozen">(canLive && limits.live ? "live" : "frozen");
  const [password, setPassword] = useState("");
  const [expires, setExpires] = useState("0");
  const [links, setLinks] = useState<Link[] | null>(null);
  const [made, setMade] = useState<{ url: string; copied: boolean } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    sb.from("report_links")
      .select(LINK_COLS)
      .eq("report_id", reportId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setError(error.message);
        else setLinks((data ?? []) as Link[]);
      });
    return () => {
      live = false;
    };
  }, [sb, reportId]);

  async function make(e: React.FormEvent) {
    e.preventDefault();
    setBusy("make");
    setError("");
    setMade(null);
    try {
      await beforeShare?.();
      const days = Number(expires);
      const out = await post<{ url: string; link: Link }>(auth, "/api/reports/links", {
        reportId,
        mode,
        password: password.trim() || undefined,
        expiresAt: days ? new Date(Date.now() + days * 864e5).toISOString() : undefined,
        data: mode === "frozen" && data ? data : undefined,
      });
      const url = linkUrl(out.link.token);
      setMade({ url, copied: await copy(url) });
      setLinks((l) => [out.link, ...(l ?? [])]);
      setPassword("");
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy("");
    }
  }

  async function revoke(l: Link) {
    setBusy(l.id);
    setError("");
    const { error } = await sb.from("report_links").update({ revoked_at: new Date().toISOString() }).eq("id", l.id);
    if (error) setError(error.message);
    else setLinks((x) => x?.map((y) => (y.id === l.id ? { ...y, revoked_at: new Date().toISOString() } : y)) ?? null);
    setBusy("");
  }

  const state = (l: Link) => (l.revoked_at ? "Revoked" : l.expires_at && past(l.expires_at) ? "Expired" : l.mode === "live" ? "Live" : "Frozen");

  return (
    <Modal title="Share report" onClose={onClose} width="max-w-2xl">
      {canEdit ? (
        <form onSubmit={make} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {canLive ? (
              <Seg
                label="Link type"
                value={mode}
                onChange={setMode}
                options={[
                  { id: "live", label: limits.live ? "Live" : "Live · Starter" },
                  { id: "frozen", label: "Frozen" },
                ]}
              />
            ) : (
              <span className="aw-tag">Frozen</span>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[13px] text-body">
              <span className="flex items-center gap-2">
                Password
                {!limits.secure ? <span className="aw-tag">Pro</span> : null}
              </span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={!limits.secure} autoComplete="new-password" placeholder="None" className="aw-input py-2! text-[14px]!" />
            </label>
            <label className="flex flex-col gap-1 text-[13px] text-body">
              <span className="flex items-center gap-2">
                Expires
                {!limits.secure ? <span className="aw-tag">Pro</span> : null}
              </span>
              <Dropdown<string> label="Expires" value={expires} onChange={setExpires} disabled={!limits.secure} options={EXPIRES} />
            </label>
          </div>
          <button type="submit" className="aw-btn aw-btn--primary aw-btn--sm self-start" disabled={Boolean(busy) || (mode === "live" && !limits.live) || (Boolean(password) && password.trim().length < 6)}>
            {busy === "make" ? "Creating link..." : "Create link"}
          </button>
          {made ? (
            <div className="flex items-center gap-2">
              <input readOnly value={made.url} aria-label="Share link" onFocus={(e) => e.target.select()} className="aw-input min-w-0 flex-1 py-2! text-[14px]!" />
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm shrink-0" onClick={async () => setMade({ ...made, copied: await copy(made.url) })}>
                {made.copied ? "Copied" : "Copy"}
              </button>
            </div>
          ) : null}
        </form>
      ) : null}
      {error ? <p className="aw-error">{error}</p> : null}

      <div className="aw-table-wrap overflow-x-auto">
        <table className="aw-table">
          <thead>
            <tr>
              <th>Link</th>
              <th className="w-24">Made</th>
              <th className="w-24">Expires</th>
              <th className="w-16 text-right">Views</th>
              <th className="w-24">Last opened</th>
              <th className="w-28" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {(links ?? []).map((l) => {
              const s = state(l);
              const on = s === "Live" || s === "Frozen";
              return (
                <tr key={l.id}>
                  <td>
                    <span className="flex items-center gap-2">
                      <span className={`aw-status ${on ? "aw-status--ranked" : "aw-status--pending"}`}>{s}</span>
                      {l.locked ? <span className="aw-tag">Password</span> : null}
                    </span>
                  </td>
                  <td>{ago(l.created_at)}</td>
                  <td>{l.expires_at ? new Date(l.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Never"}</td>
                  <td className="aw-num text-right">{l.views}</td>
                  <td>{ago(l.last_viewed_at)}</td>
                  <td>
                    {on ? (
                      <span className="flex justify-end gap-1">
                        <button type="button" className="aw-btn aw-btn--ghost aw-btn--sm" onClick={() => void copy(linkUrl(l.token))}>
                          Copy
                        </button>
                        {canEdit ? (
                          <button type="button" className="aw-btn aw-btn--ghost aw-btn--sm text-neg!" disabled={busy === l.id} onClick={() => revoke(l)}>
                            Revoke
                          </button>
                        ) : null}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {links && !links.length ? (
              <tr>
                <td colSpan={6} className="text-muted">
                  No links yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
