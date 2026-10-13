"use client";

// Bulk analysis, the way Semrush does it: paste or upload up to 500 keywords or sites and get their
// numbers side by side in one sheet. Click a row to research it on its own.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { addCalendarItems, type Site } from "@/lib/db";
import { TASK_COST } from "@/lib/plans";
import { BULK_LIMIT, bulkList, MARKETS, stageFromIntent, type DomainBulkRow, type KwSummary } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { domainHref, keywordHref, plainClick, setUrl, urlParams } from "@/lib/researchUrl";
import { useStash } from "@/lib/stash";
import { BrandLogo } from "../BrandLogo";
import { Sheet } from "../Sheet";
import { CalendarIcon, favicon, Thinking } from "../ui";
import { flag, KdDot, short } from "./KeywordOverview";
import { BAR_BUTTON, BAR_FIELD, downloadCsv, fmtCpc, post, Sparkline } from "./shared";

const HEADER = /^(keywords?|domains?|urls?|sites?|websites?|pages?|query|queries|term|terms)$/i;

/** The first column of each line in a CSV or text file, without a header row. */
function readFile(text: string): string[] {
  const cells = text
    .split(/\r?\n/)
    .map((l) => l.split(/[,\t;]/)[0]?.trim().replace(/^["']|["']$/g, "") ?? "")
    .filter(Boolean);
  return cells.length && HEADER.test(cells[0]) ? cells.slice(1) : cells;
}

/** A big paste box with a file upload and a live count against the limit. */
function BulkInput({ value, onChange, noun, placeholder, disabled }: { value: string; onChange: (v: string) => void; noun: string; placeholder: string; disabled?: boolean }) {
  const file = useRef<HTMLInputElement | null>(null);
  const count = bulkList(value).length;
  const over = count > BULK_LIMIT;
  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={`${noun} to analyze, one per line`}
        rows={8}
        disabled={disabled}
        className="aw-textarea min-h-40 w-full resize-y font-mono text-[14px]"
      />
      <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted">
        <span className={`aw-num ${over ? "font-medium text-neg" : ""}`}>
          {count.toLocaleString("en-US")} / {BULK_LIMIT} {noun}
          {over ? ` · remove ${count - BULK_LIMIT} to run` : ""}
        </span>
        <span className="text-rule">|</span>
        <button type="button" className="aw-text-link text-[12px]" onClick={() => file.current?.click()} disabled={disabled}>
          Upload CSV or TXT
        </button>
        {value ? (
          <button type="button" className="aw-text-link text-[12px]" onClick={() => onChange("")} disabled={disabled}>
            Clear
          </button>
        ) : null}
        <span className="ml-auto">One per line. Repeats and blank lines are skipped.</span>
        <input
          ref={file}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const lines = readFile(await f.text());
            onChange([value.trim(), ...lines].filter(Boolean).join("\n"));
          }}
        />
      </div>
    </div>
  );
}

function CountrySelect({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <select aria-label="Country" value={value} onChange={(e) => onChange(e.target.value)} className={BAR_FIELD}>
      {Object.keys(MARKETS).map((c) => (
        <option key={c} value={c}>
          {flag(c)} {c}
        </option>
      ))}
    </select>
  );
}

/** What a run costs, shown before it starts. */
const costNote = (n: number) => (n ? `Uses ${TASK_COST.bulk(Math.min(n, BULK_LIMIT))} tasks · free when the results are saved` : "");

function Stats({ items }: { items: [string, string, string?][] }) {
  return (
    <div className="aw-stats aw-stats--tight" style={{ ["--cols" as string]: items.length }}>
      {items.map(([lab, num, sub]) => (
        <div key={lab} className="aw-stat">
          <div className="aw-stat__lab">{lab}</div>
          <div className="flex flex-col gap-1">
            <span className="aw-stat__num">{num}</span>
            {sub ? <span className="text-[12px] text-muted">{sub}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

const pct = (c: number | null) => (c === null ? null : Math.round(c <= 1 ? c * 100 : c));
const FEATURE = (t: string) => t.replace(/_/g, " ");
const NewTab = ({ href }: { href: string }) => (
  <a href={href} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Open ${href} in a new tab`} title="Open in a new tab" className="inline-flex shrink-0 p-0.5 text-muted hover:text-brand">
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  </a>
);

type Recent = { id: string; count: number; country: string; created_at: string };

const ago = (iso: string) => {
  const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

/**
 * Saved runs: each finished run has its own link (?mode=bulk&bulk=id). Opens the run the address bar
 * names, follows Back and Forward, and lists this site's latest runs.
 */
function useSavedRuns<R extends { id?: string | null }>(
  sb: SupabaseClient,
  site: Site,
  kind: "keywords" | "domains",
  result: R | null,
  show: (items: string[], country: string, result: R) => void,
) {
  const [recent, setRecent] = useState<Recent[] | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const { data, error: e } = await sb.from("bulk_runs").select("id, count, country, created_at").eq("site_id", site.id).eq("kind", kind).order("created_at", { ascending: false }).limit(8);
    // Before supabase/033_bulk_runs.sql there is no list, and nothing else changes.
    setRecent(e ? null : (data as Recent[]));
  }, [sb, site.id, kind]);

  async function open(id: string, push: boolean) {
    setError("");
    if (push) setUrl({ mode: "bulk", bulk: id }, true);
    if (result?.id === id) return;
    const { data, error: e } = await sb.from("bulk_runs").select("items, country, result").eq("id", id).maybeSingle();
    if (e || !data) return setError("This bulk analysis was deleted, or it belongs to another workspace.");
    show(data.items as string[], data.country as string, { ...(data.result as R), id, country: data.country });
  }
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });

  useEffect(() => {
    const fromUrl = () => {
      const id = urlParams().get("bulk");
      if (id) openRef.current(id, false);
    };
    const id = urlParams().get("bulk");
    if (id) fromUrl();
    // Showing a saved run without its link: put the link in the address bar.
    else if (result?.id) setUrl({ mode: "bulk", bulk: result.id }, false);
    // The list arrives later, from the database.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    window.addEventListener("popstate", fromUrl);
    return () => window.removeEventListener("popstate", fromUrl);
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { recent, refresh, open, error };
}

/** The latest saved runs, as links. */
function RecentRuns({ runs, current, noun, path, onOpen }: { runs: Recent[] | null; current?: string | null; noun: string; path: string; onOpen: (id: string) => void }) {
  if (!runs?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px]">
      <span className="text-muted">Recent runs</span>
      {runs.map((r) => (
        <a
          key={r.id}
          href={`${path}?mode=bulk&bulk=${r.id}`}
          className={`aw-chip aw-chip--btn ${r.id === current ? "is-on" : ""}`}
          title={new Date(r.created_at).toLocaleString()}
          onClick={(e) => {
            if (!plainClick(e)) return;
            e.preventDefault();
            onOpen(r.id);
          }}
        >
          {r.count.toLocaleString("en-US")} {noun} · {flag(r.country)} · {ago(r.created_at)}
        </a>
      ))}
    </div>
  );
}

type KwResult = { rows: KwSummary[]; cost: number; country: string; id?: string | null };

/** Up to 500 keywords: volume, difficulty, intent, CPC, trend and SERP features side by side. */
export function BulkKeywords({ sb, auth, site, canEdit, onResearch }: { sb: SupabaseClient; auth: RunAuth; site: Site; canEdit: boolean; onResearch: (keyword: string) => void }) {
  const k = (name: string) => `kwb:${site.id}:${name}`;
  const [text, setText] = useStash(k("text"), "");
  const [country, setCountry] = useStash(k("country"), site.profile.country && MARKETS[site.profile.country] ? site.profile.country : "United States");
  const [result, setResult] = useStash<KwResult | null>(k("result"), null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const list = bulkList(text);
  const saved = useSavedRuns<KwResult>(sb, site, "keywords", result, (items, c, r) => {
    setText(items.join("\n"));
    setCountry(c);
    setResult(r);
    setPicked(new Set());
  });

  async function run() {
    if (!list.length || list.length > BULK_LIMIT) return;
    setError("");
    setNotice("");
    setPicked(new Set());
    setBusy(`Checking ${list.length.toLocaleString("en-US")} keywords...`);
    try {
      const r = await post<{ rows: KwSummary[]; cost: number; id?: string | null }>(auth, "/api/research/report", { action: "bulk", keywords: list, country, siteId: site.id });
      setResult({ ...r, country });
      setUrl({ mode: "bulk", bulk: r.id }, true);
      saved.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function addToPlan(rows: KwSummary[]) {
    setError("");
    try {
      const n = await addCalendarItems(
        sb,
        auth.workspaceId,
        rows.map((r) => ({ site_id: site.id, keyword: r.keyword, secondary: [], stage: stageFromIntent(r.intent), theme: null, volume: r.volume, difficulty: r.kd, intent: r.intent, cpc: r.cpc, source: "bulk analysis" })),
      );
      setNotice(`${n} added to the Content Plan.${n < rows.length ? ` ${rows.length - n} were already in it.` : ""}`);
      setPicked(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const rows = result?.rows ?? [];
  const empty = (r: KwSummary) => r.volume === null && r.kd === null;
  const withKd = rows.filter((r) => r.kd !== null);
  const exportCsv = () =>
    downloadCsv(
      "bulk-keywords.csv",
      ["keyword", "volume", "kd", "intent", "cpc", "competition", "trend", "serp features", "ai overview"],
      rows.map((r) => [r.keyword, r.volume, r.kd, r.intent, r.cpc, pct(r.competition), r.trend.map((t) => t.volume).join("|"), r.serp.filter((t) => t !== "organic").join("|"), r.serp.includes("ai_overview") ? "yes" : "no"]),
    );

  return (
    <div className="flex flex-col gap-5">
      <form
        className="aw-frame flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <BulkInput value={text} onChange={setText} noun="keywords" placeholder={"crm software\nbest crm for small business\nhubspot alternatives"} disabled={Boolean(busy)} />
        <div className="flex flex-wrap items-center gap-3">
          <CountrySelect value={country} onChange={setCountry} />
          <button type="submit" className={BAR_BUTTON} disabled={!canEdit || Boolean(busy) || !list.length || list.length > BULK_LIMIT}>
            Analyze {list.length > 1 ? `${list.length.toLocaleString("en-US")} keywords` : ""}
          </button>
          <span className="text-[12px] text-muted">{costNote(list.length)}</span>
        </div>
        <RecentRuns runs={saved.recent} current={result?.id} noun="keywords" path="/keywords" onOpen={(id) => saved.open(id, true)} />
      </form>

      {error || saved.error ? <p className="aw-error">{error || saved.error}</p> : null}
      {notice ? <div className="aw-callout">{notice}</div> : null}
      {busy ? <Thinking text={busy} /> : null}

      {!busy && result ? (
        <>
          <Stats
            items={[
              ["Keywords", rows.length.toLocaleString("en-US"), `${flag(result.country)} ${result.country}`],
              ["Total volume", short(rows.reduce((n, r) => n + (r.volume ?? 0), 0)), "searches a month"],
              ["Average KD", withKd.length ? String(Math.round(withKd.reduce((n, r) => n + r.kd!, 0) / withKd.length)) : "–", "0 easy, 100 hard"],
              ["AI Overview", String(rows.filter((r) => r.serp.includes("ai_overview")).length), "show one on Google"],
              ["No data", String(rows.filter(empty).length), "too new or too rare"],
            ]}
          />
          <div className="aw-frame">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-faint px-5 py-3">
              <span className="text-[13px] text-muted">{result.cost ? `Cost $${result.cost.toFixed(3)}` : "Free, saved results"}</span>
              <span className="flex flex-wrap items-center gap-2">
                <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => navigator.clipboard?.writeText(rows.map((r) => r.keyword).join("\n")).then(() => setNotice("Keywords copied."))}>
                  Copy keywords
                </button>
                <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={exportCsv}>
                  Export CSV
                </button>
              </span>
            </div>
            {picked.size && canEdit ? (
              <div className="flex flex-wrap items-center gap-3 border-b border-rule-faint bg-brand-pale px-5 py-2.5">
                <span className="text-[13px] font-medium text-ink">{picked.size} selected</span>
                <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={() => addToPlan(rows.filter((r) => picked.has(r.keyword)))}>
                  <CalendarIcon />
                  Add to Content Plan
                </button>
                <button type="button" className="aw-text-link text-[13px]" onClick={() => setPicked(new Set())}>
                  Clear
                </button>
              </div>
            ) : null}
            <Sheet<KwSummary>
              label="Bulk keywords"
              rows={rows}
              rowKey={(r) => r.keyword}
              sort={{ key: "volume", desc: true }}
              selected={canEdit ? picked : undefined}
              onSelect={canEdit ? setPicked : undefined}
              pageSize={100}
              height="none"
              cols={[
                {
                  id: "keyword",
                  label: "Keyword",
                  type: "text",
                  value: (r) => r.keyword,
                  width: 260,
                  cell: (r) =>
                    canEdit ? (
                      <a
                        href={keywordHref(r.keyword, result.country)}
                        className="aw-text-link text-left"
                        title={`Research "${r.keyword}"`}
                        onClick={(e) => {
                          if (!plainClick(e)) return;
                          e.preventDefault();
                          onResearch(r.keyword);
                        }}
                      >
                        {r.keyword}
                      </a>
                    ) : (
                      r.keyword
                    ),
                },
                { id: "volume", label: "Volume", type: "number", value: (r) => r.volume },
                { id: "kd", label: "KD %", type: "number", value: (r) => r.kd, cell: (r) => <KdDot kd={r.kd} /> },
                { id: "intent", label: "Intent", type: "list", value: (r) => r.intent },
                { id: "cpc", label: "CPC", type: "number", value: (r) => r.cpc, cell: (r) => fmtCpc(r.cpc) },
                { id: "comp", label: "Competition", type: "number", value: (r) => pct(r.competition) },
                {
                  id: "trend",
                  label: "Trend",
                  type: "number",
                  value: (r) => (r.trend.length > 1 ? r.trend[r.trend.length - 1].volume - r.trend[0].volume : null),
                  cell: (r) => <Sparkline values={r.trend.map((t) => t.volume)} />,
                },
                {
                  id: "serp",
                  label: "SERP features",
                  type: "number",
                  value: (r) => r.serp.filter((t) => t !== "organic").length || null,
                  cell: (r) => {
                    const f = r.serp.filter((t) => t !== "organic");
                    return f.length ? <span title={f.map(FEATURE).join(", ")}>{f.length}</span> : <span className="text-muted">–</span>;
                  },
                },
                { id: "aio", label: "AI Overview", type: "list", value: (r) => (r.serp.includes("ai_overview") ? "Yes" : "No"), options: ["Yes", "No"] },
              ]}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

type DomResult = { rows: DomainBulkRow[]; cost: number; country: string; skipped: number; id?: string | null };
const KIND: Record<DomainBulkRow["kind"], { label: string; scope: "domain" | "subdomain" | "url" }> = {
  domain: { label: "Domain", scope: "domain" },
  subdomain: { label: "Subdomain", scope: "subdomain" },
  page: { label: "Page", scope: "url" },
};

/** Up to 500 sites or pages: keywords, visits and traffic value side by side. */
export function BulkDomains({ sb, auth, site, canEdit, onOpen }: { sb: SupabaseClient; auth: RunAuth; site: Site; canEdit: boolean; onOpen: (target: string, scope: "domain" | "subdomain" | "url") => void }) {
  const k = (name: string) => `domb:${site.id}:${name}`;
  const [text, setText] = useStash(k("text"), "");
  const [country, setCountry] = useStash(k("country"), site.profile.country && MARKETS[site.profile.country] ? site.profile.country : "United States");
  const [result, setResult] = useStash<DomResult | null>(k("result"), null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const list = bulkList(text);
  const saved = useSavedRuns<DomResult>(sb, site, "domains", result, (items, c, r) => {
    setText(items.join("\n"));
    setCountry(c);
    setResult(r);
  });

  async function run() {
    if (!list.length || list.length > BULK_LIMIT) return;
    setError("");
    setBusy(`Sizing up ${list.length.toLocaleString("en-US")} ${list.length === 1 ? "site" : "sites"} on Google...`);
    try {
      const r = await post<Omit<DomResult, "country">>(auth, "/api/research/domain", { action: "bulk", targets: list, country, siteId: site.id });
      setResult({ ...r, country });
      setUrl({ mode: "bulk", bulk: r.id }, true);
      saved.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const rows = result?.rows ?? [];
  const sum = (f: (r: DomainBulkRow) => number | null) => rows.reduce((n, r) => n + (f(r) ?? 0), 0);
  const me = site.domain.replace(/^www\./, "");
  const href = (r: DomainBulkRow) => (r.kind === "page" ? r.target : `https://${r.target}`);

  return (
    <div className="flex flex-col gap-5">
      <form
        className="aw-frame flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <BulkInput value={text} onChange={setText} noun="sites" placeholder={"hubspot.com\nblog.hubspot.com\nsalesforce.com/products/crm"} disabled={Boolean(busy)} />
        <div className="flex flex-wrap items-center gap-3">
          <CountrySelect value={country} onChange={setCountry} />
          <button type="submit" className={BAR_BUTTON} disabled={!canEdit || Boolean(busy) || !list.length || list.length > BULK_LIMIT}>
            Analyze {list.length > 1 ? `${list.length.toLocaleString("en-US")} sites` : ""}
          </button>
          <span className="text-[12px] text-muted">{costNote(list.length)}</span>
        </div>
        <RecentRuns runs={saved.recent} current={result?.id} noun="sites" path="/domain-research" onOpen={(id) => saved.open(id, true)} />
      </form>

      {error || saved.error ? <p className="aw-error">{error || saved.error}</p> : null}
      {busy ? <Thinking text={busy} /> : null}

      {!busy && result ? (
        <>
          <Stats
            items={[
              ["Sites", rows.length.toLocaleString("en-US"), `${flag(result.country)} ${result.country}`],
              ["Visits / mo", short(sum((r) => r.traffic)), "from Google, all sites"],
              ["Keywords", short(sum((r) => r.keywords)), "ranked in the top 100"],
              ["Traffic value", `$${short(sum((r) => r.value))}`, "what those visits cost in ads"],
              ["No data", String(rows.filter((r) => r.keywords === null).length), result.skipped ? `${result.skipped} ${result.skipped === 1 ? "line was not a site" : "lines were not sites"}` : "not on Google yet"],
            ]}
          />
          <div className="aw-frame">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-faint px-5 py-3">
              <span className="text-[13px] text-muted">{result.cost ? `Cost $${result.cost.toFixed(3)}` : "Free, saved results"}</span>
              <button
                type="button"
                className="aw-btn aw-btn--secondary aw-btn--sm"
                onClick={() =>
                  downloadCsv(
                    "bulk-sites.csv",
                    ["site", "type", "keywords", "visits per month", "traffic value", "paid keywords", "paid visits"],
                    rows.map((r) => [r.target, KIND[r.kind].label, r.keywords, r.traffic, r.value, r.paidKeywords, r.paidTraffic]),
                  )
                }
              >
                Export CSV
              </button>
            </div>
            <Sheet<DomainBulkRow>
              label="Bulk sites"
              rows={rows}
              rowKey={(r) => r.target}
              sort={{ key: "traffic", desc: true }}
              pageSize={100}
              height="none"
              cols={[
                {
                  id: "site",
                  label: "Site",
                  type: "text",
                  value: (r) => r.target,
                  width: 300,
                  cell: (r) => {
                    const host = r.kind === "page" ? new URL(r.target).hostname : r.target;
                    const label = r.kind === "page" ? r.target.replace(/^https:\/\//, "") : r.target;
                    return (
                      <span className="flex min-w-0 items-center gap-2">
                        <BrandLogo src={favicon(host)} name={host} size={14} />
                        {canEdit ? (
                          <a
                            href={domainHref(r.target, KIND[r.kind].scope, result.country)}
                            className="aw-text-link min-w-0 truncate text-left"
                            title={`Domain Research for ${label}`}
                            onClick={(e) => {
                              if (!plainClick(e)) return;
                              e.preventDefault();
                              onOpen(r.target, KIND[r.kind].scope);
                            }}
                          >
                            {label}
                          </a>
                        ) : (
                          <span className="min-w-0 truncate">{label}</span>
                        )}
                        {host.replace(/^www\./, "") === me ? <span className="aw-badge">You</span> : null}
                        <NewTab href={href(r)} />
                      </span>
                    );
                  },
                },
                { id: "kind", label: "Type", type: "list", value: (r) => KIND[r.kind].label },
                { id: "keywords", label: "Keywords", type: "number", value: (r) => r.keywords },
                { id: "traffic", label: "Visits / mo", type: "number", value: (r) => r.traffic },
                { id: "value", label: "Traffic value", type: "number", value: (r) => r.value, cell: (r) => (r.value === null ? <span className="text-muted">–</span> : `$${r.value.toLocaleString("en-US")}`) },
                { id: "paidKeywords", label: "Paid keywords", type: "number", value: (r) => r.paidKeywords },
                { id: "paidTraffic", label: "Paid visits", type: "number", value: (r) => r.paidTraffic },
              ]}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
