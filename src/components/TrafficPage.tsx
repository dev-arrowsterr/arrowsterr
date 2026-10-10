"use client";

import { useCallback, useEffect, useState } from "react";
import { answered, ownsDomain } from "@/lib/metrics";
import type { RunAuth } from "@/lib/runner";
import type { View } from "@/lib/view";
import { BrandLogo } from "./BrandLogo";
import { ENGINE_LOGOS } from "./Engines";
import { Copy, InstallGuide, snippetFor } from "./InstallGuide";
import { TrendChart, type Line } from "./TrendChart";
import { aiSourceOf } from "@/lib/aiSources";
import { useStash } from "@/lib/stash";
import { SampleBars, SampleRows, SampleStats, ToolIntro } from "./ToolIntro";
import { Card, Delta, favicon, pct, Seg, sortRows, SortTh, Thinking, useSort } from "./ui";

type Ga4 = { email: string; property: string | null; name: string | null };
type Status = {
  connected: boolean;
  source?: "ga4";
  websiteId?: string;
  domain?: string;
  platform?: string;
  token?: string;
  installed?: boolean;
  live?: boolean;
  pageviews?: number;
  ga4?: Ga4 | null;
};

/** Connect Google Analytics 4: sign in with Google, then pick the property for this brand. */
function Ga4Connect({ status, canEdit, call, onDone }: { status: Status; canEdit: boolean; call: (path: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>; onDone: () => void }) {
  const [props, setProps] = useState<{ id: string; name: string; account: string }[] | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signedIn = Boolean(status.ga4?.email);

  useEffect(() => {
    if (!signedIn || !canEdit) return;
    let live = true;
    call("/api/ga4", { action: "properties" })
      .then((d) => {
        if (!live) return;
        const list = (d.properties as { id: string; name: string; account: string }[]) ?? [];
        setProps(list);
        setPick(list[0]?.id ?? "");
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [signedIn, canEdit, call]);

  async function signIn() {
    setBusy(true);
    setError("");
    try {
      const d = await call("/api/google/connect", { back: window.location.pathname });
      window.location.href = String(d.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  async function choose() {
    setBusy(true);
    setError("");
    try {
      await call("/api/ga4", { action: "select", property: pick });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="aw-frame flex flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <BrandLogo src={favicon("analytics.google.com")} name="Google Analytics" size={28} />
        <div className="flex flex-col">
          <span className="text-[16px] font-medium text-ink">Google Analytics 4</span>
          <span className="text-[13px] text-body">{signedIn ? `Signed in as ${status.ga4!.email}` : "Use the analytics you already have. Visits from AI, landing pages and conversions in one click."}</span>
        </div>
      </div>
      {error ? <p className="aw-error">{error}</p> : null}
      {!canEdit ? (
        <p className="aw-small">Ask an editor to connect Google Analytics.</p>
      ) : !signedIn ? (
        <div>
          <button type="button" className="aw-btn aw-btn--accent" onClick={signIn} disabled={busy}>
            {busy ? "Opening Google..." : "Connect Google Analytics"}
          </button>
        </div>
      ) : props === null ? (
        <p className="aw-small">Loading your properties...</p>
      ) : props.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="GA4 property" className="aw-input h-11! w-auto! min-w-72 py-0!">
            {props.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.account}
              </option>
            ))}
          </select>
          <button type="button" className="aw-btn aw-btn--primary h-11! py-0!" onClick={choose} disabled={busy || !pick}>
            Use this property
          </button>
        </div>
      ) : (
        <p className="aw-small">No GA4 properties on this Google account.</p>
      )}
    </section>
  );
}
type Totals = { pageviews: number; visitors: number; visits: number; bounces: number; totaltime: number };
type Row = { x: string; y: number };
type Traffic = {
  days: number;
  totals: Totals;
  totalsPrev: Totals;
  visits: number;
  visitsPrev: number;
  ai: number;
  aiPrev: number;
  now: number | null;
  byEngine: { engine: string; visits: number; prev: number }[];
  series: { day: string; visitors: number; pageviews: number; ai: Record<string, number> }[];
  pages: { path: string; visits: number; engines: Record<string, number> }[];
  breakdowns: Record<string, Row[]>;
};
type Verify = { checks: { label: string; state: "ok" | "warn" | "fail"; note: string }[]; live: boolean; at: string };

const AI_COLORS: Record<string, string> = { ChatGPT: "#10A37F", Perplexity: "#20808D", Gemini: "#4285F4", Claude: "#D97757", Copilot: "#0F141F", "Other AI": "#A8AEBA" };
const LOGO: Record<string, string> = { ...ENGINE_LOGOS, Copilot: "https://www.google.com/s2/favicons?domain=copilot.microsoft.com&sz=64" };
const pathOf = (u: string) => {
  try {
    return new URL(u).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return u;
  }
};

const regionName = (() => {
  try {
    const n = new Intl.DisplayNames(["en"], { type: "region" });
    return (c: string) => n.of(c.toUpperCase()) ?? c;
  } catch {
    return (c: string) => c;
  }
})();
const languageName = (() => {
  try {
    const n = new Intl.DisplayNames(["en"], { type: "language" });
    return (c: string) => n.of(c) ?? c;
  } catch {
    return (c: string) => c;
  }
})();
const flag = (c: string) => (/^[a-z]{2}$/i.test(c) ? String.fromCodePoint(...[...c.toUpperCase()].map((ch) => 127397 + ch.charCodeAt(0))) : "");
const words = (x: string) => x.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
const duration = (sec: number) => {
  if (!Number.isFinite(sec) || sec <= 0) return "0s";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
};
const num = (n: number) => n.toLocaleString("en-US");

type Tab = { id: string; label: string; rows: Row[]; head: string; cell?: (x: string) => React.ReactNode; name?: (x: string) => string };

/** One card of the analytics page: tabs, then a table you sort by clicking the column names. */
function Breakdown({ title, tabs }: { title: string; tabs: Tab[] }) {
  const shown = tabs.filter((t, i) => i === 0 || t.rows.length);
  const [id, setId] = useState(shown[0].id);
  const [sort, setSort] = useSort("y");
  const [all, setAll] = useState(false);
  const tab = shown.find((t) => t.id === id) ?? shown[0];
  const total = tab.rows.reduce((n, r) => n + r.y, 0);
  const name = tab.name ?? ((x: string) => x);
  const rows = sortRows(tab.rows, sort, { x: (r) => name(r.x).toLowerCase(), y: (r) => r.y });
  return (
    <Card
      title={title}
      action={shown.length > 1 ? <Seg label={title} value={tab.id} onChange={(v) => { setId(v); setAll(false); }} options={shown.map((t) => ({ id: t.id, label: t.label }))} /> : null}
    >
      <div className="overflow-x-auto">
        <table className="aw-table aw-table--compact">
          <thead>
            <tr>
              <SortTh id="x" sort={sort} onSort={setSort} text>
                {tab.head}
              </SortTh>
              <SortTh id="y" sort={sort} onSort={setSort} className="w-40">
                Visitors
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {(all ? rows : rows.slice(0, 10)).map((r) => (
              <tr key={r.x || "(none)"}>
                <td className="max-w-md">
                  <span className="relative block">
                    <span className="absolute inset-y-[-6px] left-[-8px] bg-brand-pale" style={{ width: `calc(${total ? (r.y / total) * 100 : 0}% + 8px)` }} aria-hidden="true" />
                    <span className="relative flex min-w-0 items-center gap-2 truncate text-ink">{tab.cell ? tab.cell(r.x) : name(r.x) || "(none)"}</span>
                  </span>
                </td>
                <td className="aw-num whitespace-nowrap text-ink">
                  {num(r.y)} <span className="text-muted">· {pct(total ? (r.y / total) * 100 : 0)}</span>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={2} className="aw-small">
                  Nothing here yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {rows.length > 10 ? (
        <div className="border-t border-rule-faint px-5 py-2.5">
          <button type="button" className="aw-text-link" onClick={() => setAll(!all)}>
            {all ? "Show top 10" : `Show all ${rows.length}`}
          </button>
        </div>
      ) : null}
    </Card>
  );
}

const MARK = { ok: "✓", warn: "!", fail: "✕" } as const;
const MARK_CLASS = { ok: "aw-status--ranked", warn: "aw-status--warn", fail: "aw-status--missed" } as const;

/** The install check, step by step. */
function VerifyResult({ result, onClose }: { result: Verify; onClose?: () => void }) {
  const failed = result.checks.filter((c) => c.state === "fail").length;
  return (
    <section className="aw-frame">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-6 py-4">
        <span className="text-[15px] font-medium text-ink">
          {failed ? `${failed} ${failed === 1 ? "thing" : "things"} to fix` : result.live ? "Everything works" : "Installed. Waiting for a visit"}
        </span>
        <span className="flex items-center gap-3">
          <span className="aw-label">Checked {new Date(result.at).toLocaleTimeString()}</span>
          {onClose ? (
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onClose}>
              Close
            </button>
          ) : null}
        </span>
      </div>
      <ol className="divide-y divide-rule-faint">
        {result.checks.map((c) => (
          <li key={c.label} className="flex items-start gap-3 px-6 py-3">
            <span className={`aw-status ${MARK_CLASS[c.state]} shrink-0`} aria-label={c.state === "ok" ? "Passed" : c.state === "warn" ? "Check" : "Failed"}>
              {MARK[c.state]}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[14px] font-medium text-ink">{c.label}</span>
              <span className="break-words text-[13px] text-body">{c.note}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Website analytics for the brand's site, visits from AI, and setup when it isn't connected yet. */
export function TrafficPage({ view, auth, canEdit }: { view: View; auth: RunAuth; canEdit: boolean }) {
  const { brand, current, filter, days } = view;
  const [status, setStatus] = useStash<Status | null>(`traffic:${brand.id}:status`, null);
  const [saved, setSaved] = useStash<Record<number, Traffic>>(`traffic:${brand.id}:data`, {});
  const traffic = saved[days] ?? null;
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [setup, setSetup] = useState(false);
  const [chart, setChart] = useState<"visitors" | "pageviews">("visitors");
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<Verify | null>(null);
  const [pageSort, setPageSort] = useSort("visits");
  // Back from Google's sign-in: say how it went, then tidy the address.
  const [back] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search)));
  const ga4Result = back?.get("ga4");
  useEffect(() => {
    if (!ga4Result) return;
    const q = new URLSearchParams(window.location.search);
    q.delete("ga4");
    q.delete("reason");
    window.history.replaceState(null, "", window.location.pathname + (q.size ? `?${q}` : ""));
  }, [ga4Result]);
  const notice =
    ga4Result === "error" ? (
      <p className="aw-error">{back?.get("reason") ?? "Could not connect Google Analytics."}</p>
    ) : ga4Result === "connected" ? (
      <div className="aw-callout">Google Analytics is connected. Pick the property for {brand.domain}.</div>
    ) : null;

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

  const check = useCallback(() => call("/api/site", { action: "status" }).then(setStatus), [call, setStatus]);

  // Load the status, then keep checking every 10 seconds until the first visit arrives.
  const isLive = Boolean(status?.live);
  useEffect(() => {
    let live = true;
    const tick = () => check().catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    tick();
    if (isLive) return () => void (live = false);
    const t = setInterval(() => {
      if (live) tick();
    }, 10_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [check, isLive]);

  useEffect(() => {
    if (!isLive) return;
    let live = true;
    call("/api/traffic", { days })
      .then((d) => live && setSaved((x) => ({ ...x, [days]: d })))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [isLive, days, call, setSaved]);

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

  async function disconnectGa4() {
    if (!confirm("Disconnect Google Analytics from this brand?")) return;
    try {
      await call("/api/ga4", { action: "disconnect" });
      setSaved({});
      await check();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function verify() {
    setVerifying(true);
    setError("");
    try {
      const v: Verify = await call("/api/site", { action: "verify" });
      setVerified(v);
      if (v.live && !isLive) await check();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setVerifying(false);
    }
  }

  const verifyButton = (
    <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={verify} disabled={verifying}>
      {verifying ? "Checking..." : "Verify install"}
    </button>
  );

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const snippet = status?.websiteId ? snippetFor(origin, status.websiteId, status.domain ?? brand.domain) : "";
  const shareUrl = status?.token ? `${origin}/install/${status.token}` : "";

  if (busy) return <Thinking text={busy} />;
  if (!status) return error ? <p className="aw-error">{error}</p> : <Thinking text="Checking your website..." />;

  // ── Not connected yet ──
  if (!status.connected) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="aw-h2">Traffic</h1>
        {error ? <p className="aw-error">{error}</p> : null}
        {notice}
        <Ga4Connect status={status} canEdit={canEdit} call={call} onDone={check} />
        <span className="aw-label">Or use the Arrowsterr tracking script</span>
        <ToolIntro
          title={`See every visit to ${brand.domain}, including visits from AI`}
          lead="Add one line of code to your site and see your visitors, top pages, sources, countries and devices. Arrowsterr also shows exactly how many people arrive from ChatGPT, Perplexity, Gemini and other AI assistants."
          action={
            canEdit ? (
              <button type="button" className="aw-btn aw-btn--accent" onClick={connect}>
                Connect {brand.domain}
              </button>
            ) : (
              <p className="aw-small">Ask an editor or admin in this workspace to connect the website.</p>
            )
          }
          features={[
            { title: "Visitors and visits", text: "Visitors, visits, pageviews, bounce rate and time on site, with the change from last period.", visual: <SampleStats items={[["Visitors", "4.2K"], ["Visits", "5.8K"], ["Bounce", "41%"]]} /> },
            { title: "Visits from AI", text: "How many visitors each AI assistant sends you, day by day.", visual: <SampleRows rows={[["ChatGPT", 120], ["Perplexity", 48], ["Gemini", 22]]} /> },
            { title: "Traffic over time", text: "Daily visitors and pageviews, so you can see what moved the needle.", visual: <SampleBars /> },
            { title: "Sources and pages", text: "Where visitors come from, the pages they land on, and the pages they leave from." },
            { title: "Locations and devices", text: "Countries, cities, languages, browsers and devices, all in one place." },
            { title: "AI citations meet visits", text: "Your pages that AI answers cite, next to the visits those pages get from AI." },
          ]}
          steps={["Click Connect.", "Copy the one-line code into your site's head. Guides cover WordPress, Shopify, Webflow, Wix and more.", "Click Verify install. Visits show up within minutes."]}
          faqs={[
            { q: "Does it use cookies?", a: "No. Visitors are counted without cookies and no IP addresses are stored." },
            { q: "Will it slow down my site?", a: "No. The script is tiny and loads after your page." },
            { q: "Can my web person install it?", a: "Yes. Send them the private install link from the setup page. They don't need an account." },
          ]}
        />
      </div>
    );
  }

  // ── Connected, waiting for the first visit (or the user opened setup again) ──
  if (!isLive || setup) {
    return (
      <div className="flex max-w-3xl flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="aw-h2">Traffic</h1>
          {isLive ? (
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setSetup(false)}>
              Back to analytics
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
            <div className="flex flex-col gap-3 border-t border-rule pt-5">
              <span className="aw-label">3 · Check it</span>
              <p className="text-[14px] text-body">
                Open <a href={`https://${status.domain}`} target="_blank" rel="noopener noreferrer">{status.domain}</a> in a new tab, then click Verify. It checks
                every step and tells you what to fix.
              </p>
              <div>
                <button type="button" className="aw-btn aw-btn--accent" onClick={verify} disabled={verifying}>
                  {verifying ? "Checking..." : "Verify install"}
                </button>
              </div>
            </div>
          </div>
        </section>
        {verified ? <VerifyResult result={verified} /> : null}
        {shareUrl ? (
          <section className="aw-frame">
            <div className="aw-frame__body flex flex-col gap-3">
              <span className="text-[15px] font-medium text-ink">Not your job? Send it to your web person.</span>
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
  if (!traffic) return error ? <p className="aw-error">{error}</p> : <Thinking text="Loading your analytics..." />;
  const t = traffic.totals;
  const tp = traffic.totalsPrev;
  const visits = t.visits || t.visitors;
  const visitsPrev = tp.visits || tp.visitors;
  const rate = (a: number, b: number) => (b ? a / b : 0);
  const hadPrev = tp.pageviews > 0;
  const share = traffic.visits ? (traffic.ai / traffic.visits) * 100 : 0;
  const sharePrev = traffic.visitsPrev ? (traffic.aiPrev / traffic.visitsPrev) * 100 : null;
  const engines = traffic.byEngine.filter((e) => e.visits || e.prev);
  const top = [...engines].sort((a, b) => b.visits - a.visits)[0];
  const lines: Line[] = engines.map((e) => ({ name: e.engine, color: AI_COLORS[e.engine] ?? "#767E8C", isYou: false }));
  const label = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const aiPoints = traffic.series.map((d) => ({ at: d.day, label: label(d.day), values: Object.fromEntries(engines.map((e) => [e.engine, d.ai[e.engine] ?? 0])) }));
  const mainName = chart === "visitors" ? "Visitors" : "Pageviews";
  const mainPoints = traffic.series.map((d) => ({ at: d.day, label: label(d.day), values: { [mainName]: d[chart] } }));
  const b = traffic.breakdowns;

  // The join: AI citations of each of your pages, next to AI visits to that page.
  const chats = answered(current, filter);
  const cites = new Map<string, number>();
  for (const c of chats) for (const p of new Set(c.sources.filter((s) => ownsDomain(s.domain, brand.domain)).map((s) => pathOf(s.url)))) cites.set(p, (cites.get(p) ?? 0) + 1);
  const pagePaths = [...new Set([...traffic.pages.map((p) => p.path.replace(/\/+$/, "") || "/"), ...cites.keys()])];
  const rows = sortRows(
    pagePaths.map((path) => {
      const tr = traffic.pages.filter((p) => (p.path.replace(/\/+$/, "") || "/") === path);
      const visits = tr.reduce((n, p) => n + p.visits, 0);
      const eng: Record<string, number> = {};
      for (const p of tr) for (const [k, v] of Object.entries(p.engines)) eng[k] = (eng[k] ?? 0) + v;
      return { path, visits, cited: chats.length ? ((cites.get(path) ?? 0) / chats.length) * 100 : 0, topEngine: Object.entries(eng).sort((x, y) => y[1] - x[1])[0]?.[0] };
    }),
    pageSort,
    { path: (r) => r.path, visits: (r) => r.visits, cited: (r) => r.cited, top: (r) => r.topEngine },
  ).slice(0, 50);

  const site = (x: string) => `https://${brand.domain}${x === "/" ? "" : x}`;
  const pageCell = (x: string) => (
    <a href={site(x)} target="_blank" rel="noopener noreferrer nofollow" className="truncate">
      {x || "/"}
    </a>
  );
  const refCell = (x: string) =>
    x ? (
      <>
        <BrandLogo src={favicon(x)} name={x} size={16} />
        <span className="truncate">{x}</span>
        {aiSourceOf(x) ? <span className="aw-badge">AI</span> : null}
      </>
    ) : (
      "Direct or unknown"
    );
  const countryCell = (x: string) => (
    <>
      <span aria-hidden="true">{flag(x)}</span>
      {x ? regionName(x) : "Unknown"}
    </>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="aw-h2">Traffic</h1>
        <span className="flex flex-wrap items-center gap-3">
          <span className="aw-live">
            {traffic.now === null ? `Live on ${status.domain}` : `${num(traffic.now)} ${traffic.now === 1 ? "visitor" : "visitors"} online now`}
          </span>
          {status.source === "ga4" ? (
            <>
              <span className="aw-chip" title={status.ga4?.email}>
                Google Analytics · {status.ga4?.name}
              </span>
              {canEdit ? (
                <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={disconnectGa4}>
                  Disconnect
                </button>
              ) : null}
            </>
          ) : (
            <>
              {verifyButton}
              {canEdit ? (
                <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setSetup(true)}>
                  Setup
                </button>
              ) : null}
            </>
          )}
        </span>
      </div>
      {error ? <p className="aw-error">{error}</p> : null}
      {notice}
      {verified ? <VerifyResult result={verified} onClose={() => setVerified(null)} /> : null}

      <div className="aw-stats aw-stats--tight" style={{ ["--cols" as string]: 6 }}>
        {[
          { lab: "Visitors", v: num(t.visitors), d: hadPrev ? <Delta now={t.visitors} before={tp.visitors} digits={0} /> : null },
          { lab: "Visits", v: num(visits), d: hadPrev ? <Delta now={visits} before={visitsPrev} digits={0} /> : null },
          { lab: "Pageviews", v: num(t.pageviews), d: hadPrev ? <Delta now={t.pageviews} before={tp.pageviews} digits={0} /> : null },
          { lab: "Pages per visit", v: rate(t.pageviews, visits).toFixed(1), d: hadPrev ? <Delta now={rate(t.pageviews, visits)} before={rate(tp.pageviews, visitsPrev)} /> : null },
          {
            lab: "Bounce rate",
            v: pct(rate(t.bounces, visits) * 100),
            d: hadPrev ? <Delta now={rate(t.bounces, visits) * 100} before={rate(tp.bounces, visitsPrev) * 100} unit=" pts" lowerIsBetter digits={0} /> : null,
          },
          { lab: "Avg. visit time", v: duration(rate(t.totaltime, visits)), d: hadPrev ? <Delta now={rate(t.totaltime, visits)} before={rate(tp.totaltime, visitsPrev)} unit="s" digits={0} /> : null },
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

      <Card
        title={`${mainName} by day`}
        action={
          <Seg
            label="Chart"
            value={chart}
            onChange={setChart}
            options={[
              { id: "visitors", label: "Visitors" },
              { id: "pageviews", label: "Pageviews" },
            ]}
          />
        }
      >
        <div className="px-3 pt-4 pb-3">
          <TrendChart points={mainPoints} lines={[{ name: mainName, color: "#0943B0", isYou: true }]} metric="count" mode="bar" />
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Breakdown
          title="Sources"
          tabs={[
            { id: "referrers", label: "Referrers", head: "Site", rows: b.referrers ?? [], cell: refCell },
            { id: "channels", label: "Channels", head: "Channel", rows: b.channels ?? [], name: words },
            { id: "ai", label: "AI", head: "AI site", rows: (b.referrers ?? []).filter((r) => aiSourceOf(r.x)), cell: refCell },
            { id: "queries", label: "Campaigns", head: "Link tags", rows: b.queries ?? [] },
          ]}
        />
        <Breakdown
          title="Pages"
          tabs={[
            { id: "pages", label: "Top", head: "Page", rows: b.pages ?? [], cell: pageCell },
            { id: "entry", label: "Entry", head: "First page", rows: b.entry ?? [], cell: pageCell },
            { id: "exit", label: "Exit", head: "Last page", rows: b.exit ?? [], cell: pageCell },
            { id: "titles", label: "Titles", head: "Page title", rows: b.titles ?? [] },
          ]}
        />
        <Breakdown
          title="Locations"
          tabs={[
            { id: "countries", label: "Countries", head: "Country", rows: b.countries ?? [], cell: countryCell, name: (x) => (x ? regionName(x) : "") },
            { id: "regions", label: "Regions", head: "Region", rows: b.regions ?? [], name: (x) => x.replace(/^([A-Z]{2})-(.+)$/, (_, c, r) => `${r}, ${regionName(c)}`) },
            { id: "cities", label: "Cities", head: "City", rows: b.cities ?? [] },
            { id: "languages", label: "Languages", head: "Language", rows: b.languages ?? [], name: (x) => (x ? languageName(x) : "") },
          ]}
        />
        <Breakdown
          title="Devices"
          tabs={[
            { id: "browsers", label: "Browsers", head: "Browser", rows: b.browsers ?? [], name: words },
            { id: "os", label: "Systems", head: "Operating system", rows: b.os ?? [] },
            { id: "devices", label: "Devices", head: "Device", rows: b.devices ?? [], name: words },
            { id: "screens", label: "Screens", head: "Screen size", rows: b.screens ?? [] },
          ]}
        />
        {b.events?.length ? <Breakdown title="Events" tabs={[{ id: "events", label: "Events", head: "Event", rows: b.events }]} /> : null}
      </div>

      <h2 className="aw-h3 pt-3">Visits from AI</h2>
      <div className="aw-stats" style={{ ["--cols" as string]: 3 }}>
        {[
          { lab: "Visits from AI", v: num(traffic.ai), d: <Delta now={traffic.ai} before={traffic.aiPrev} digits={0} /> },
          { lab: "Share of all visits", v: pct(share), d: <Delta now={share} before={sharePrev} unit=" pts" /> },
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
                <TrendChart points={aiPoints} lines={lines} metric="count" mode="bar" />
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
        </Card>
      </div>

      <Card title="Your pages: AI citations and AI visits">
        <div className="overflow-x-auto">
          <table className="aw-table aw-table--compact">
            <thead>
              <tr>
                <SortTh id="path" sort={pageSort} onSort={setPageSort} text>
                  Page
                </SortTh>
                <SortTh id="cited" sort={pageSort} onSort={setPageSort}>
                  Cited in answers
                </SortTh>
                <SortTh id="visits" sort={pageSort} onSort={setPageSort}>
                  Visits from AI
                </SortTh>
                <SortTh id="top" sort={pageSort} onSort={setPageSort} text>
                  Top source
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.path}>
                  <td className="max-w-xl truncate">
                    <a href={site(r.path)} target="_blank" rel="noopener noreferrer nofollow">
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
