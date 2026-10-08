"use client";

import { useCallback, useEffect, useState } from "react";
import { KEY_ACTIONS, visitsOf, type Label, type SourceKind, type Step, type Visitor } from "@/lib/journey";
import type { RunAuth } from "@/lib/runner";
import type { View } from "@/lib/view";
import { Sheet, type Col } from "./Sheet";
import { Card, Thinking } from "./ui";

const LABEL_CLASS: Record<Label, string> = { Hot: "aw-status--missed", Warm: "aw-status--warn", Cold: "aw-status--pending" };
const KIND: Record<SourceKind, string> = { ai: "AI", search: "Search", social: "Social", referral: "Link", direct: "Direct" };
const ACTION_ICON: Record<string, string> = { "Form submit": "📝", "Booking click": "📅", "Email click": "✉️", "Phone click": "📞", "CTA click": "👆", "Outbound click": "↗", "Scrolled 50%": "⇣", "Scrolled 90%": "⇊" };

const regionName = (() => {
  try {
    const n = new Intl.DisplayNames(["en"], { type: "region" });
    return (c: string | null) => (c ? (n.of(c.toUpperCase()) ?? c) : "");
  } catch {
    return (c: string | null) => c ?? "";
  }
})();
const flag = (c: string | null) => (c && /^[a-z]{2}$/i.test(c) ? String.fromCodePoint(...[...c.toUpperCase()].map((ch) => 127397 + ch.charCodeAt(0))) : "");
const duration = (sec: number) => {
  if (sec < 1) return "–";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
};
const ago = (iso: string) => {
  const d = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(d)) return "–";
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return `${Math.round(d / 86400)}d ago`;
};
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The visitor's avatar: their emoji on their color. */
export function Avatar({ v, size = 26 }: { v: Pick<Visitor, "emoji" | "color" | "name">; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size, background: `${v.color}1f`, boxShadow: `inset 0 0 0 1px ${v.color}55`, fontSize: size * 0.55 }}
    >
      {v.emoji}
    </span>
  );
}

/** Every visitor to the brand's website, with a fun name, and the full path each one took. */
export function VisitorsPage({ view, auth }: { view: View; auth: RunAuth }) {
  const { brand, days } = view;
  const [data, setData] = useState<{ visitors: Visitor[]; detail: string } | null>(null);
  const [error, setError] = useState("");
  const [needsConnect, setNeedsConnect] = useState(false);
  const [open, setOpen] = useState<Visitor | null>(null);

  const call = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch("/api/visitors", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` },
        body: JSON.stringify({ ...body, workspaceId: auth.workspaceId, brandId: brand.id }),
      });
      const out = await res.json().catch(() => ({ error: `The server returned ${res.status}.` }));
      if (!res.ok) {
        if (out.error === "connect") setNeedsConnect(true);
        throw new Error(out.message || out.error || `Error ${res.status}`);
      }
      return out;
    },
    [auth, brand.id],
  );

  useEffect(() => {
    let live = true;
    // Loading from the server when the page or period changes is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    call({ action: "list", days })
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [call, days]);

  if (needsConnect)
    return (
      <div className="flex max-w-3xl flex-col gap-5">
        <h1 className="aw-h2">Visitors</h1>
        <div className="aw-callout">Connect {brand.domain} in Website → Analytics first. Visitors show up here once the tracking code is live.</div>
      </div>
    );
  if (!data) return error ? <p className="aw-error">{error}</p> : <Thinking text="Meeting your visitors..." />;

  const vs = data.visitors;
  const cols: Col<Visitor>[] = [
    {
      id: "name",
      label: "Visitor",
      type: "text",
      value: (v) => v.name,
      width: 200,
      cell: (v) => (
        <span className="flex items-center gap-2">
          <Avatar v={v} size={22} />
          {v.name}
        </span>
      ),
    },
    {
      id: "score",
      label: "Buyer score",
      type: "number",
      value: (v) => v.score,
      cell: (v) => (
        <span className="flex items-center justify-end gap-2" title={v.reasons.join("\n")}>
          <span className={`aw-status ${LABEL_CLASS[v.label]}`}>{v.label}</span>
          <span className="aw-num">{v.score}</span>
        </span>
      ),
    },
    {
      id: "source",
      label: "First came from",
      type: "text",
      value: (v) => v.source,
      cell: (v) => (
        <span className="flex items-center gap-2">
          {v.source}
          {v.sourceKind === "ai" ? <span className="aw-badge">AI</span> : null}
        </span>
      ),
    },
    { id: "kind", label: "Source type", type: "list", value: (v) => KIND[v.sourceKind], options: Object.values(KIND) },
    { id: "country", label: "Country", type: "list", value: (v) => regionName(v.country), cell: (v) => (v.country ? `${flag(v.country)} ${regionName(v.country)}` : <span className="text-muted">–</span>) },
    { id: "city", label: "City", type: "text", value: (v) => v.city },
    { id: "device", label: "Device", type: "list", value: (v) => v.device },
    { id: "browser", label: "Browser", type: "list", value: (v) => v.browser },
    { id: "visits", label: "Visits", type: "number", value: (v) => v.visits },
    { id: "views", label: "Pages", type: "number", value: (v) => v.views },
    { id: "time", label: "Time on site", type: "number", value: (v) => Math.round(v.seconds), cell: (v) => duration(v.seconds) },
    {
      id: "actions",
      label: "Key actions",
      type: "text",
      value: (v) => v.actions.join(", "),
      cell: (v) =>
        v.actions.length ? (
          <span className="flex gap-1" title={v.actions.join("\n")}>
            {v.actions.map((a) => (
              <span key={a} aria-label={a}>
                {ACTION_ICON[a] ?? "•"}
              </span>
            ))}
            <span className="text-[12px] text-muted">{v.actions.length === 1 ? v.actions[0] : `${v.actions.length} actions`}</span>
          </span>
        ) : (
          <span className="text-muted">–</span>
        ),
    },
    { id: "intent", label: "Buying pages", type: "text", value: (v) => v.intentPages.join(", ") },
    { id: "entry", label: "Landed on", type: "text", value: (v) => v.entry },
    { id: "first", label: "First seen", type: "date", value: (v) => v.firstAt, cell: (v) => when(v.firstAt) },
    { id: "last", label: "Last seen", type: "date", value: (v) => v.lastAt, cell: (v) => ago(v.lastAt) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="aw-h2">Visitors</h1>
        <span className="aw-small">Each visitor gets a code made from a scrambled IP and browser. No IPs or cookies are stored.</span>
      </div>
      {error ? <p className="aw-error">{error}</p> : null}

      <div className="aw-stats" style={{ ["--cols" as string]: 4 }}>
        {[
          { lab: "Visitors", v: vs.length },
          { lab: "Hot buyers", v: vs.filter((v) => v.label === "Hot").length },
          { lab: "From AI", v: vs.filter((v) => v.sourceKind === "ai").length },
          { lab: "Took a key action", v: vs.filter((v) => v.actions.length).length },
        ].map((s) => (
          <div key={s.lab} className="aw-stat">
            <div className="aw-stat__lab">{s.lab}</div>
            <span className="aw-stat__num">{s.v.toLocaleString("en-US")}</span>
          </div>
        ))}
      </div>

      <Card title={`Last ${days} days`} action={<span className="aw-label">Click a name to see the journey</span>}>
        <Sheet label="Visitors" rows={vs} cols={cols} rowKey={(v) => v.id} sort={{ key: "score", desc: true }} onOpen={setOpen} />
      </Card>
      {data.detail === "recent" ? <p className="aw-small">Actions and scores cover the 150 most recent visitors. Older ones show visits and pages only.</p> : null}

      {open ? <Journey v={open} domain={brand.domain} load={(id) => call({ action: "journey", sessionId: id })} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** One visitor's full path: every visit, where it came from, each page and action. */
function Journey({ v, domain, load, onClose }: { v: Visitor; domain: string; load: (id: string) => Promise<{ steps: Step[] }>; onClose: () => void }) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    load(v.id)
      .then((d) => live && setSteps(d.steps))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      live = false;
      window.removeEventListener("keydown", esc);
    };
  }, [v.id, load, onClose]);

  const visits = steps ? visitsOf(steps, domain).reverse() : [];

  return (
    <>
      <div className="aw-drawer-back" onClick={onClose} aria-hidden="true" />
      <aside className="aw-drawer" role="dialog" aria-modal="true" aria-label={`Journey of ${v.name}`}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rule px-6 py-4">
          <div className="flex items-center gap-3">
            <Avatar v={v} size={44} />
            <div className="flex flex-col gap-1">
              <h2 className="aw-h3">{v.name}</h2>
              <span className="text-[13px] text-muted">
                {[v.city, regionName(v.country)].filter(Boolean).join(", ") || "Unknown place"} · {[v.device, v.browser, v.os].filter(Boolean).join(" · ")}
              </span>
            </div>
          </div>
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-5">
          <div className="mb-5 grid gap-3 sm:grid-cols-4">
            {[
              { lab: "Buyer score", v: `${v.score} · ${v.label}` },
              { lab: "Visits", v: String(v.visits) },
              { lab: "Pages", v: String(v.views) },
              { lab: "Time on site", v: duration(v.seconds) },
            ].map((x) => (
              <div key={x.lab} className="border border-rule p-3">
                <div className="aw-label mb-1">{x.lab}</div>
                <div className="text-[15px] text-ink">{x.v}</div>
              </div>
            ))}
          </div>
          {v.reasons.length ? (
            <p className="mb-5 text-[13px] text-body">
              <span className="aw-label mr-2">Why</span>
              {v.reasons.join(" · ")}
            </p>
          ) : null}

          {error ? <p className="aw-error">{error}</p> : null}
          {!steps && !error ? <p className="aw-small">Loading the journey...</p> : null}
          {steps && !steps.length ? <p className="aw-small">No pages recorded for this visitor yet.</p> : null}

          <ol className="flex flex-col gap-5">
            {visits.map((visit, i) => (
              <li key={visit.id} className="border border-rule">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule bg-surface-2 px-4 py-2.5">
                  <span className="text-[14px] font-medium text-ink">
                    Visit {visits.length - i} · {when(visit.start)}
                  </span>
                  <span className="flex items-center gap-2 text-[13px] text-body">
                    from {visit.source}
                    {visit.sourceKind === "ai" ? <span className="aw-badge">AI</span> : null}
                    <span className="text-muted">· {duration(visit.seconds)}</span>
                  </span>
                </div>
                <ol className="flex flex-col">
                  {visit.steps.map((s, j) => {
                    const action = s.event && KEY_ACTIONS.includes(s.event);
                    return (
                      <li key={`${s.at}${j}`} className={`flex items-start gap-3 border-b border-rule-faint px-4 py-2 last:border-b-0 ${action ? "bg-brand-pale" : ""}`}>
                        <span className="aw-num w-16 shrink-0 pt-0.5 text-[11px] text-muted">
                          {new Date(s.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                        </span>
                        <span aria-hidden="true" className="w-5 shrink-0 text-center">
                          {s.event ? (ACTION_ICON[s.event] ?? "•") : "→"}
                        </span>
                        {s.event ? (
                          <span className={`text-[14px] ${action ? "font-medium text-ink" : "text-body"}`}>
                            {s.event}
                            {s.path ? <span className="text-muted"> on {s.path}</span> : null}
                          </span>
                        ) : (
                          <a href={`https://${domain}${s.path ?? ""}${s.query ? `?${s.query.replace(/^\?/, "")}` : ""}`} target="_blank" rel="noopener noreferrer" className="min-w-0 text-[14px]">
                            <span className="block truncate">{s.title || s.path || "/"}</span>
                            {s.title && s.path ? <span className="block truncate text-[12px] text-muted">{s.path}</span> : null}
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </>
  );
}
