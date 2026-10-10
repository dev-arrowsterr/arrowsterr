"use client";

import { useEffect, useState } from "react";
import { EVENTS } from "@/lib/integrationTypes";
import type { RunAuth } from "@/lib/runner";
import { post } from "./research/shared";

type Key = { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null };
type Hook = { id: string; url: string; event: string; source: string; created_at: string };
type State = { allowed: boolean; setup?: string; slack?: boolean; points?: number; keys?: Key[]; hooks?: Hook[] };

const date = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Never");
const api = () => `${window.location.origin}/api/v1`;

/** Slack alerts, API keys and webhooks. Pro and up. */
export function IntegrationsSettings({ auth, isAdmin }: { auth: RunAuth; isAdmin: boolean }) {
  const [s, setS] = useState<State | null>(null);
  const [slackUrl, setSlackUrl] = useState("");
  const [points, setPoints] = useState(5);
  const [keyName, setKeyName] = useState("");
  const [fresh, setFresh] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = () =>
    post<State>(auth, "/api/integrations", { action: "get" })
      .then((r) => {
        setS(r);
        if (r.points) setPoints(r.points);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    load();
    // Loading once on open is the point of this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  async function act(name: string, body: Record<string, unknown>, done?: string) {
    setBusy(name);
    setError("");
    setNotice("");
    try {
      const r = await post<{ key?: string }>(auth, "/api/integrations", body);
      if (r.key) setFresh(r.key);
      if (done) setNotice(done);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  if (!s) return null;
  const off = !s.allowed;
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="aw-h4">Integrations</h2>
        <p className="max-w-2xl text-[14px] text-body">Get alerts in Slack, and connect Arrowsterr to Zapier or your own tools with the API.</p>
      </div>
      {off ? <div className="aw-callout max-w-2xl">Slack, Zapier and the API are on Pro and up.</div> : null}
      {s.setup ? <div className="aw-callout max-w-2xl">{s.setup}</div> : null}
      {error ? <p className="aw-error max-w-2xl">{error}</p> : null}
      {notice ? <div className="aw-callout max-w-2xl">{notice}</div> : null}

      {/* Slack */}
      <div className="aw-frame flex max-w-2xl flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[15px] font-medium text-ink">
            <img src="https://www.google.com/s2/favicons?domain=slack.com&sz=64" alt="" width={18} height={18} />
            Slack alerts
          </span>
          {s.slack ? <span className="aw-status aw-status--ranked">Connected</span> : null}
        </div>
        <p className="text-[13px] text-muted">A message when a brand&apos;s AI visibility moves by your alert size, or a competitor overtakes it. Checked after every daily run.</p>
        {isAdmin && !off ? (
          <>
            {!s.slack ? (
              <div className="flex flex-col gap-2">
                <input value={slackUrl} onChange={(e) => setSlackUrl(e.target.value)} placeholder="https://hooks.slack.com/services/…" aria-label="Slack webhook URL" className="aw-input py-2! text-[14px]!" />
                <span className="text-[12px] text-muted">In Slack: Apps → Incoming Webhooks → Add to Slack, pick a channel, then copy the Webhook URL.</span>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-[13px] text-body">
                Alert when visibility moves
                <select value={points} onChange={(e) => setPoints(Number(e.target.value))} className="aw-input w-auto! py-1.5! text-[13px]!">
                  {[3, 5, 10, 15].map((p) => (
                    <option key={p} value={p}>
                      {p} points
                    </option>
                  ))}
                </select>
              </label>
              {s.slack ? (
                <>
                  <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={Boolean(busy)} onClick={() => act("points", { action: "points", points }, "Saved.")}>
                    Save
                  </button>
                  <button type="button" className="aw-text-link text-[13px] text-neg!" onClick={() => confirm("Stop Slack alerts?") && act("off", { action: "slackOff" })}>
                    Disconnect
                  </button>
                </>
              ) : (
                <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" disabled={!slackUrl.trim() || Boolean(busy)} onClick={() => act("slack", { action: "slack", url: slackUrl, points }, "Connected. Check Slack for a test message.")}>
                  {busy === "slack" ? "Testing..." : "Connect and send a test"}
                </button>
              )}
            </div>
          </>
        ) : null}
      </div>

      {/* API keys */}
      <div className="aw-frame flex max-w-2xl flex-col gap-3 p-5">
        <span className="flex items-center gap-2 text-[15px] font-medium text-ink">
          <img src="https://www.google.com/s2/favicons?domain=zapier.com&sz=64" alt="" width={18} height={18} />
          API keys and Zapier
        </span>
        <p className="text-[13px] text-muted">
          Use a key in Zapier, or call the API from your own tools. Send it in the <code>X-API-Key</code> header to <code>{typeof window === "undefined" ? "/api/v1" : api()}</code>.
        </p>
        {fresh ? (
          <div className="flex flex-col gap-2 rounded-[10px] bg-brand-pale p-3">
            <span className="text-[13px] font-medium text-ink">Copy your key now. It won&apos;t be shown again.</span>
            <span className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-[6px] bg-white px-2 py-1.5 text-[12px]">{fresh}</code>
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => navigator.clipboard.writeText(fresh)}>
                Copy
              </button>
            </span>
          </div>
        ) : null}
        {s.keys?.length ? (
          <ul className="flex flex-col divide-y divide-rule-faint border-y border-rule-faint">
            {s.keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                <span className="flex min-w-0 flex-col">
                  <span className="text-ink">{k.name}</span>
                  <span className="text-muted">
                    <code>{k.prefix}…</code> · last used {date(k.last_used_at)}
                  </span>
                </span>
                {isAdmin ? (
                  <button type="button" className="aw-text-link text-[13px] text-neg!" onClick={() => confirm(`Revoke "${k.name}"? Anything using it stops working.`) && act("revoke", { action: "revoke", id: k.id })}>
                    Revoke
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {isAdmin && !off ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act("key", { action: "key", name: keyName || "Zapier" });
              setKeyName("");
            }}
          >
            <input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Key name, like Zapier" aria-label="Key name" className="aw-input py-2! text-[14px]!" />
            <button type="submit" className="aw-btn aw-btn--primary aw-btn--sm shrink-0" disabled={Boolean(busy)}>
              Create key
            </button>
          </form>
        ) : null}
        <details className="text-[13px]">
          <summary className="cursor-pointer font-medium text-ink">Endpoints and events</summary>
          <ul className="mt-2 flex flex-col gap-1 font-mono text-[12px] text-body">
            <li>GET /me</li>
            <li>GET /brands</li>
            <li>GET /visibility?brand_id=…&amp;days=30</li>
            <li>GET /prompts?brand_id=…</li>
            <li>GET /topic-bank?brand_id=…</li>
            <li>GET /calendar?brand_id=…</li>
            <li>POST /webhooks {"{ url, event }"} · DELETE /webhooks/{"{id}"}</li>
          </ul>
          <ul className="mt-3 flex flex-col gap-1.5">
            {Object.entries(EVENTS).map(([k, v]) => (
              <li key={k}>
                <code className="text-ink">{k}</code> <span className="text-muted">{v}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>

      {/* Webhooks made by Zapier or the API */}
      {s.hooks?.length ? (
        <div className="aw-frame flex max-w-2xl flex-col gap-2 p-5">
          <span className="text-[15px] font-medium text-ink">Webhooks</span>
          <ul className="flex flex-col divide-y divide-rule-faint">
            {s.hooks.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                <span className="flex min-w-0 flex-col">
                  <span className="text-ink">
                    <code>{h.event}</code> → {h.url}
                  </span>
                  <span className="text-muted">{h.source === "zapier" ? "Zapier" : "API"} · {date(h.created_at)}</span>
                </span>
                {isAdmin ? (
                  <button type="button" className="aw-text-link text-[13px] text-neg!" onClick={() => act("unhook", { action: "unhook", id: h.id })}>
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
