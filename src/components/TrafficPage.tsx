"use client";

import { useCallback, useEffect, useState } from "react";
import { answered, ownsDomain } from "@/lib/metrics";
import type { RunAuth } from "@/lib/runner";
import type { View } from "@/lib/view";
import { BrandLogo } from "./BrandLogo";
import { ENGINE_LOGOS } from "./Engines";
import { Copy, InstallGuide, snippetFor } from "./InstallGuide";
import { TrendChart, type Line } from "./TrendChart";
import { Card, Delta, pct, Thinking } from "./ui";

type Status = { connected: boolean; websiteId?: string; domain?: string; platform?: string; token?: string; installed?: boolean; live?: boolean; pageviews?: number };
type Traffic = {
  days: number;
  visits: number;
  visitsPrev: number;
  pageviews: number;
  ai: number;
  aiPrev: number;
  byEngine: { engine: string; visits: number; prev: number }[];
  series: { day: string; total: number; ai: Record<string, number> }[];
  pages: { path: string; visits: number; engines: Record<string, number> }[];
  topReferrers: { referrer: string; visits: number; ai: string | null }[];
};

const AI_COLORS: Record<string, string> = { ChatGPT: "#10A37F", Perplexity: "#20808D", Gemini: "#4285F4", Claude: "#D97757", Copilot: "#0F141F", "Other AI": "#A8AEBA" };
const LOGO: Record<string, string> = { ...ENGINE_LOGOS, Copilot: "https://www.google.com/s2/favicons?domain=copilot.microsoft.com&sz=64" };
const pathOf = (u: string) => {
  try {
    return new URL(u).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return u;
  }
};

/** Visits from AI assistants to the brand's website, and setup when it isn't connected yet. */
export function TrafficPage({ view, auth, canEdit }: { view: View; auth: RunAuth; canEdit: boolean }) {
  const { brand, current, filter, days } = view;
  const [status, setStatus] = useState<Status | null>(null);
  const [traffic, setTraffic] = useState<Traffic | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [setup, setSetup] = useState(false);

  const call = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` },
        body: JSON.stringify({ ...body, workspaceId: auth.workspaceId, brandId: brand.id }),
      });
      const data = await res.json().catch(() => ({ error: `The server returned ${res.status}.` }));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      return data;
    },
    [auth, brand.id],
  );

  const check = useCallback(() => call("/api/site", { action: "status" }).then(setStatus), [call]);

  // Load the status, then keep checking every 10 seconds until the first visit arrives.
  useEffect(() => {
    let live = true;
    const tick = () => check().catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    tick();
    const t = setInterval(() => {
      if (live) tick();
    }, 10_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [check]);

  const isLive = Boolean(status?.live);
  useEffect(() => {
    if (!isLive) return;
    let live = true;
    call("/api/traffic", { days })
      .then((d) => live && setTraffic(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [isLive, days, call]);

  async function connect() {
    setBusy("Setting up tracking for your website...");
    setError("");
    try {
      setStatus(await call("/api/site", { action: "connect" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const snippet = status?.websiteId ? snippetFor(origin, status.websiteId, status.domain ?? brand.domain) : "";
  const shareUrl = status?.token ? `${origin}/install/${status.token}` : "";

  if (busy) return <Thinking text={busy} />;
  if (!status) return error ? <p className="aw-error">{error}</p> : <Thinking text="Checking your website..." />;

  // ── Not connected yet ──
  if (!status.connected) {
    return (
      <div className="flex max-w-3xl flex-col gap-5">
        <h1 className="aw-h2">AI traffic</h1>
        {error ? <p className="aw-error">{error}</p> : null}
        <section className="aw-frame">
          <div className="aw-frame__body flex flex-col gap-4">
            <h2 className="aw-h3">See visits from ChatGPT and other AI</h2>
            <p className="text-[15px] text-body">
              Add one line of code to {brand.domain} and Arrowsterr shows how many people come from each AI assistant, which pages they land on, and how
              that lines up with the pages AI cites. No cookies, about 2 minutes to set up.
            </p>
            {canEdit ? (
              <div>
                <button type="button" className="aw-btn aw-btn--accent" onClick={connect}>
                  Connect {brand.domain}
                </button>
              </div>
            ) : (
              <p className="aw-small">Ask an editor or admin in this workspace to connect the website.</p>
            )}
          </div>
        </section>
      </div>
    );
  }

  // ── Connected, waiting for the first visit (or the user opened setup again) ──
  if (!isLive || setup) {
    return (
      <div className="flex max-w-3xl flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="aw-h2">AI traffic</h1>
          {isLive ? (
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setSetup(false)}>
              Back to traffic
            </button>
          ) : null}
        </div>
        {error ? <p className="aw-error">{error}</p> : null}
        <section className="aw-frame">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-6 py-4">
            <span className="text-[15px] font-medium text-ink">Install on {status.domain}</span>
            <span className={`aw-status ${isLive ? "aw-status--ranked" : status.installed ? "aw-status--warn" : "aw-status--pending"}`}>
              {isLive ? "Live" : status.installed ? "Installed · waiting for a visit" : "Not installed yet"}
            </span>
          </div>
          <div className="aw-frame__body flex flex-col gap-6">
            <InstallGuide snippet={snippet} platform={status.platform ?? "other"} />
            <div className="flex flex-col gap-2 border-t border-rule pt-5">
              <span className="aw-label">3 · Check it</span>
              <p className="text-[14px] text-body">
                Open <a href={`https://${status.domain}`} target="_blank" rel="noopener noreferrer">{status.domain}</a> in a new tab. This page checks every 10
                seconds and turns live when the first visit arrives.
              </p>
            </div>
          </div>
        </section>
        {shareUrl ? (
          <section className="aw-frame">
            <div className="aw-frame__body flex flex-col gap-3">
              <span className="text-[15px] font-medium text-ink">Not your job? Send it to your web person.</span>
              <p className="text-[14px] text-body">This private link shows them the same steps and code. They don&apos;t need an Arrowsterr account.</p>
              <div className="flex flex-col gap-3 border border-rule bg-surface-2 p-3 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{shareUrl}</code>
                <Copy text={shareUrl} label="Copy link" />
              </div>
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  // ── Live: the numbers ──
  if (!traffic) return error ? <p className="aw-error">{error}</p> : <Thinking text="Loading your traffic..." />;
  const share = traffic.visits ? (traffic.ai / traffic.visits) * 100 : 0;
  const sharePrev = traffic.visitsPrev ? (traffic.aiPrev / traffic.visitsPrev) * 100 : null;
  const engines = traffic.byEngine.filter((e) => e.visits || e.prev);
  const top = [...engines].sort((a, b) => b.visits - a.visits)[0];
  const lines: Line[] = engines.map((e) => ({ name: e.engine, color: AI_COLORS[e.engine] ?? "#767E8C", isYou: false }));
  const points = traffic.series.map((d) => ({
    at: d.day,
    label: new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    values: Object.fromEntries(engines.map((e) => [e.engine, d.ai[e.engine] ?? 0])),
  }));

  // The join: AI citations of each of your pages, next to AI visits to that page.
  const chats = answered(current, filter);
  const cites = new Map<string, number>();
  for (const c of chats) for (const p of new Set(c.sources.filter((s) => ownsDomain(s.domain, brand.domain)).map((s) => pathOf(s.url)))) cites.set(p, (cites.get(p) ?? 0) + 1);
  const pagePaths = [...new Set([...traffic.pages.map((p) => p.path.replace(/\/+$/, "") || "/"), ...cites.keys()])];
  const rows = pagePaths
    .map((path) => {
      const t = traffic.pages.filter((p) => (p.path.replace(/\/+$/, "") || "/") === path);
      const visits = t.reduce((n, p) => n + p.visits, 0);
      const eng: Record<string, number> = {};
      for (const p of t) for (const [k, v] of Object.entries(p.engines)) eng[k] = (eng[k] ?? 0) + v;
      return { path, visits, cited: chats.length ? ((cites.get(path) ?? 0) / chats.length) * 100 : 0, topEngine: Object.entries(eng).sort((a, b) => b[1] - a[1])[0]?.[0] };
    })
    .sort((a, b) => b.visits - a.visits || b.cited - a.cited)
    .slice(0, 25);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="aw-h2">AI traffic</h1>
        <span className="flex items-center gap-3">
          <span className="aw-live">Live on {status.domain}</span>
          {canEdit ? (
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setSetup(true)}>
              Setup
            </button>
          ) : null}
        </span>
      </div>
      {error ? <p className="aw-error">{error}</p> : null}

      <div className="aw-stats" style={{ ["--cols" as string]: 4 }}>
        {[
          { lab: "Visits from AI", v: String(traffic.ai), d: <Delta now={traffic.ai} before={traffic.aiPrev} digits={0} /> },
          { lab: "Share of all visits", v: pct(share), d: <Delta now={share} before={sharePrev} unit=" pts" /> },
          { lab: "All visits", v: String(traffic.visits), d: <Delta now={traffic.visits} before={traffic.visitsPrev} digits={0} /> },
          { lab: "Top AI source", v: top?.visits ? top.engine : "–", d: null },
        ].map((s) => (
          <div key={s.lab} className="aw-stat">
            <div className="aw-stat__lab">{s.lab}</div>
            <div className="flex items-baseline gap-2">
              <span className="aw-stat__num">{s.v}</span>
              {s.d}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Card title="Visits from AI by day">
          {engines.length ? (
            <>
              <div className="px-3 pt-4 pb-2">
                <TrendChart points={points} lines={lines} metric="count" mode="bar" />
              </div>
              <ul className="flex flex-wrap gap-x-5 gap-y-2 px-5 pb-4">
                {lines.map((l) => (
                  <li key={l.name} className="flex items-center gap-2 text-[13px] text-body">
                    <i className="inline-block h-2.5 w-2.5" style={{ background: l.color }} />
                    {l.name}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="aw-small p-5">No visits from AI assistants in the last {days} days yet.</p>
          )}
        </Card>
        <Card title="By AI assistant">
          <ul className="flex flex-col gap-4 p-5">
            {traffic.byEngine.map((e) => (
              <li key={e.engine} className="flex flex-col gap-1.5">
                <span className="flex items-center justify-between gap-3 text-[14px]">
                  <span className="flex items-center gap-2 text-ink">
                    {LOGO[e.engine] ? <BrandLogo src={LOGO[e.engine]} name={e.engine} size={16} /> : null}
                    {e.engine}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="aw-num text-ink">{e.visits}</span>
                    <Delta now={e.visits} before={e.prev} digits={0} />
                  </span>
                </span>
                <span className="h-1.5 bg-rule-faint">
                  <span className="block h-full" style={{ width: `${traffic.ai ? (e.visits / traffic.ai) * 100 : 0}%`, background: AI_COLORS[e.engine] }} />
                </span>
              </li>
            ))}
          </ul>
          <p className="aw-micro px-5 pb-4">Google AI Overview and AI Mode visits look like normal Google visits, so they count under Google.</p>
        </Card>
      </div>

      <Card title="Your pages: AI citations and AI visits">
        <div className="overflow-x-auto">
          <table className="aw-table aw-table--compact">
            <thead>
              <tr>
                <th>Page</th>
                <th>Cited in answers</th>
                <th>Visits from AI</th>
                <th>Top source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.path}>
                  <td className="max-w-xl truncate">
                    <a href={`https://${brand.domain}${r.path === "/" ? "" : r.path}`} target="_blank" rel="noopener noreferrer nofollow">
                      {r.path}
                    </a>
                  </td>
                  <td className="aw-num">{r.cited ? pct(r.cited) : <span className="text-muted">Not cited</span>}</td>
                  <td className="aw-num">{r.visits || <span className="text-muted">0</span>}</td>
                  <td>{r.topEngine ?? <span className="text-muted">–</span>}</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={4} className="aw-small">
                    No AI citations or AI visits yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
