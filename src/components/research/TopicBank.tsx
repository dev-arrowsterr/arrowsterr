"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { addCalendarItems, listCalendar, saveSite, type BankRow, type Site } from "@/lib/db";
import { MARKETS, slots, stageFromIntent, STAGES, type Stage } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { Sheet, type Col, type Edit } from "../Sheet";
import { AiIcon, Card, UploadIcon } from "../ui";
import { PlanProgress } from "./AgenticResearch";
import { KeywordPanel } from "./KeywordPanel";
import { useStash } from "@/lib/stash";
import type { KeywordRun } from "@/lib/db";
import { PlanWizard } from "./PlanWizard";
import { Difficulty, fmtCpc, post, STAGE_LABEL, StageTag } from "./shared";

/** A made-up Topic Bank for Acme, shown before a brand has its own. */
const SAMPLE: Row[] = (
  [
    ["best accounting software for small business", "bofu", 9900, 62, "commercial", 18.4, "new", "Software comparisons", "Compare 8 tools on price, payroll and bank sync."],
    ["acme vs quickbooks", "bofu", 1300, 28, "commercial", 12.1, "new", "Competitor comparisons", "Honest side-by-side. Win on ease of use."],
    ["quickbooks alternatives", "bofu", 4400, 41, "commercial", 15.6, "update", "Competitor comparisons", "Our page ranks #14. Add pricing table and FAQs."],
    ["invoice software for freelancers", "bofu", 2900, 35, "transactional", 9.8, "new", "Invoicing", "Lead with the free plan."],
    ["how to do bookkeeping for a small business", "mofu", 6600, 47, "informational", 4.2, "new", "Bookkeeping basics", "Step-by-step guide with a free template."],
    ["cash basis vs accrual accounting", "mofu", 5400, 38, "informational", 3.1, "update", "Bookkeeping basics", "Refresh the 2023 post. Add examples."],
    ["how to reconcile a bank statement", "mofu", 3600, 30, "informational", 2.7, "new", "Bookkeeping basics", "Show it done in Acme with screenshots."],
    ["small business tax deductions", "tofu", 14800, 58, "informational", 6.5, "new", "Taxes", "Checklist post. Good for links."],
    ["what is a balance sheet", "tofu", 22200, 66, "informational", 1.9, "new", "Finance 101", "Short explainer with a sample sheet."],
    ["quarterly estimated taxes due dates", "tofu", 8100, 33, "informational", 2.2, "new", "Taxes", "Update every year. Easy win."],
  ] as const
).map(([keyword, stage, volume, kd, intent, cpc, action, theme, notes], i) => ({ id: `sample-${i}`, keyword, stage, volume, kd, intent, cpc, action, theme, notes, source: "sample", added: "", enriched: true }));

const BLANKS = 8; // empty rows always waiting at the bottom of the sheet
type Row = BankRow & { blank?: boolean };
const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clean = (k: string) => k.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 120);
/** A row has Google data once it was enriched, or when it came with an intent from research. */
export const isEnriched = (r: BankRow) => Boolean(r.enriched || r.intent);
const num = (v: string | undefined) => {
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return v && String(v).trim() && Number.isFinite(n) ? n : null;
};

/** Split CSV text into rows of cells, with quoted cells and commas, semicolons or tabs. */
export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = first.includes("\t") ? "\t" : first.split(";").length > first.split(",").length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** Topic Bank rows from a CSV: a keyword column, plus volume, difficulty and notes when the file has them. */
export function rowsFromCsv(text: string): { keyword: string; volume: number | null; kd: number | null; notes: string | null }[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const find = (re: RegExp) => head.findIndex((h) => re.test(h));
  const hasHead = find(/keyword|query|term|topic|phrase/) >= 0;
  const col = hasHead
    ? { keyword: find(/keyword|query|term|topic|phrase/), volume: find(/volume|searches/), kd: find(/difficulty|^kd/), notes: find(/note|comment/) }
    : { keyword: 0, volume: rows[0].length > 1 && num(rows[0][1]) !== null ? 1 : -1, kd: -1, notes: -1 };
  return (hasHead ? rows.slice(1) : rows)
    .map((r) => ({
      keyword: r[col.keyword]?.trim() ?? "",
      volume: col.volume >= 0 ? num(r[col.volume]) : null,
      kd: col.kd >= 0 ? num(r[col.kd]) : null,
      notes: col.notes >= 0 ? r[col.notes]?.trim() || null : null,
    }))
    .filter((r) => r.keyword);
}

/** Add ideas to a site's Topic Bank, skipping keywords already there. Returns how many were added. */
export function addToBank(sb: SupabaseClient, site: Site, onSite: (s: Site) => void, rows: (Partial<BankRow> & { keyword: string })[], source: string): number {
  const bank = site.profile.bank ?? [];
  const have = new Set(bank.map((b) => b.keyword));
  const added = new Date().toISOString().slice(0, 10);
  const fresh: BankRow[] = [];
  for (const r of rows) {
    const keyword = clean(r.keyword);
    if (!keyword || have.has(keyword)) continue;
    have.add(keyword);
    fresh.push({ stage: stageFromIntent(r.intent ?? null), volume: null, kd: null, intent: null, notes: null, ...r, keyword, source: r.source ?? source, id: newId(), added });
  }
  if (!fresh.length) return 0;
  const s2 = { ...site, profile: { ...site.profile, bank: [...bank, ...fresh] } };
  onSite(s2);
  saveSite(sb, s2).catch(() => {});
  return fresh.length;
}

/** The Topic Bank: a spreadsheet of content ideas, plus every content plan you generate. Approve ideas onto the Editorial Calendar when you are ready. */
export function TopicBank({ sb, auth, site, canEdit, onSite, onCalendar }: { sb: SupabaseClient; auth: RunAuth; site: Site; canEdit: boolean; onSite: (s: Site) => void; onCalendar: () => void }) {
  const [wizard, setWizard] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [latest, setLatest] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [paste, setPaste] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState<BankRow | null>(null);
  const [runs] = useStash<KeywordRun[] | null>(`agentic:${site.id}:runs`, null);
  const hasPlan = Boolean(runs?.some((r) => r.status === "done" || r.status === "running"));
  const bank = site.profile.bank ?? [];
  const latestSite = useRef(site);
  useEffect(() => {
    latestSite.current = site;
  }, [site]);
  const fromPlan = useCallback((rows: Omit<BankRow, "id" | "added">[]) => {
    addToBank(sb, latestSite.current, (s) => {
      latestSite.current = s;
      onSite(s);
    }, rows, "content plan");
  }, [sb, onSite]);

  // The last date already on the calendar, so approved ideas are scheduled after it.
  useEffect(() => {
    let live = true;
    listCalendar(sb, site.id)
      .then((items) => live && setLatest(items.map((i) => i.due_date).filter((d): d is string => Boolean(d)).sort().pop() ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sb, site.id, refresh]);

  async function save(next: BankRow[]) {
    const s2 = { ...site, profile: { ...site.profile, bank: next } };
    onSite(s2);
    try {
      await saveSite(sb, s2);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const addKeywords = (list: (string | { keyword: string; volume: number | null; kd: number | null; notes: string | null })[], source = "added by hand") => {
    const have = new Set(bank.map((b) => b.keyword));
    const rows: BankRow[] = [];
    for (const x of list) {
      const r = typeof x === "string" ? { keyword: x, volume: null, kd: null, notes: null } : x;
      const keyword = clean(r.keyword);
      if (!keyword || have.has(keyword)) continue;
      have.add(keyword);
      rows.push({ id: newId(), keyword, stage: null, volume: r.volume, kd: r.kd, intent: null, notes: r.notes, source, added: new Date().toISOString().slice(0, 10) });
    }
    if (rows.length) save([...bank, ...rows]);
    return rows.length;
  };
  async function upload(f: File) {
    setError("");
    setNotice("");
    const list = rowsFromCsv(await f.text());
    if (!list.length) return setError("No keywords found in that file. Put them in a column called Keyword.");
    const n = addKeywords(list, "CSV upload");
    setNotice(`${n} keywords added from ${f.name}.${n < list.length ? ` ${list.length - n} were already in the bank.` : ""}`);
  }
  const patch = (id: string, p: Partial<BankRow>) => save(bank.map((b) => (b.id === id ? { ...b, ...p } : b)));

  // Fill in volume, difficulty, intent and CPC from Google data, 700 keywords per call.
  async function enrich(rows: BankRow[]) {
    if (!rows.length) return;
    setBusy("enrich");
    setError("");
    try {
      const country = site.profile.country && MARKETS[site.profile.country] ? site.profile.country : "United States";
      type Got = { keyword: string; volume: number | null; kd: number | null; intent: string | null; cpc: number | null };
      const by = new Map<string, Got>();
      for (let i = 0; i < rows.length; i += 700) {
        const out = await post<{ rows: Got[] }>(auth, "/api/research/report", { action: "bulk", keywords: rows.slice(i, i + 700).map((r) => r.keyword), country });
        for (const r of out.rows) by.set(r.keyword, r);
      }
      const now = latestSite.current.profile.bank ?? [];
      save(
        now.map((b) => {
          const g = by.get(b.keyword);
          if (!g) return b;
          return { ...b, volume: g.volume ?? b.volume, kd: g.kd ?? b.kd, intent: g.intent ?? b.intent, cpc: g.cpc ?? b.cpc ?? null, stage: b.stage ?? stageFromIntent(g.intent), enriched: true };
        }),
      );
      setNotice(`${by.size} keywords enriched with Google data.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  const bare = bank.filter((b) => !isEnriched(b));

  async function toCalendar() {
    const RANK = { bofu: 0, mofu: 1, tofu: 2 } as const;
    const rows = bank.filter((b) => picked.has(b.id)).sort((a, b) => (a.stage ? RANK[a.stage] : 3) - (b.stage ? RANK[b.stage] : 3) || (b.volume ?? 0) - (a.volume ?? 0));
    setError("");
    try {
      // Spread the ideas over the calendar at the pace picked for content plans, after what is already planned.
      const perWeek = site.profile.planBrief?.perWeek;
      const from = (() => {
        const want = site.profile.planBrief?.start ? new Date(`${site.profile.planBrief.start}T00:00:00`) : new Date();
        if (!latest) return want;
        const after = new Date(`${latest}T00:00:00`);
        after.setDate(after.getDate() + 1);
        return after > want ? after : want;
      })();
      const dates = perWeek ? slots(from, perWeek, rows.length) : [];
      const n = await addCalendarItems(
        sb,
        auth.workspaceId,
        rows.map((r, i) => ({
          site_id: site.id,
          due_date: dates[i] ?? null,
          keyword: r.keyword,
          secondary: r.others ?? [],
          stage: r.stage,
          theme: r.theme ?? null,
          volume: r.volume,
          difficulty: r.kd,
          intent: r.intent,
          cpc: r.cpc ?? null,
          source: `topic bank${r.source !== "added by hand" ? `: ${r.source}` : ""}`,
          notes: r.notes,
          action: r.action ?? "new",
          current_url: r.url ?? null,
          current_rank: r.rank ?? null,
        })),
      );
      save(bank.filter((b) => !picked.has(b.id)));
      setPicked(new Set());
      setNotice(`${n} moved to the Editorial Calendar.${n < rows.length ? ` ${rows.length - n} were already on it.` : ""}`);
      setRefresh((x) => x + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const rows: Row[] = [
    ...bank,
    ...Array.from({ length: BLANKS }, (_, i): Row => ({ id: `blank-${i}`, keyword: "", stage: null, volume: null, kd: null, intent: null, notes: null, source: "", added: "", blank: true })),
  ];
  const ed = <E,>(x: E) => (canEdit ? x : undefined);
  const text = (k: "keyword" | "notes"): Edit<Row> => ({
    kind: "text",
    save: (r, v) => {
      if (r.blank) return k === "keyword" && v ? addKeywords([v]) : undefined;
      if (k === "keyword") return v && patch(r.id, { keyword: clean(v) });
      patch(r.id, { notes: v });
    },
  });
  const cols: Col<Row>[] = [
    { id: "keyword", label: "Keyword", type: "text", value: (r) => r.keyword || null, width: 260, cell: (r) => (r.blank ? <span className="text-faint">{canEdit ? "+ Type a keyword" : ""}</span> : r.keyword), edit: ed(text("keyword")) },
    {
      id: "stage",
      label: "Stage",
      type: "list",
      value: (r) => (r.stage ? STAGE_LABEL[r.stage] : ""),
      options: ["BOFU", "MOFU", "TOFU"],
      cell: (r) => (r.blank ? null : <StageTag stage={r.stage} />),
      edit: ed<Edit<Row>>({ kind: "select", options: [{ id: "", label: "None" }, ...STAGES.map((x) => ({ id: x.id, label: STAGE_LABEL[x.id] }))], value: (r) => r.stage ?? "", save: (r, v) => !r.blank && patch(r.id, { stage: (v || null) as Stage | null }) }),
    },
    {
      id: "data",
      label: "Data",
      type: "list",
      value: (r) => (r.blank ? null : isEnriched(r) ? "Enriched" : "Not enriched"),
      options: ["Enriched", "Not enriched"],
      cell: (r) => (r.blank || isEnriched(r) ? null : <span className="aw-status aw-status--pending">Not enriched</span>),
    },
    { id: "volume", label: "Volume", type: "number", value: (r) => r.volume, cell: (r) => (r.blank ? null : r.volume === null ? <span className="text-muted">–</span> : r.volume.toLocaleString("en-US")) },
    { id: "kd", label: "Difficulty", type: "number", value: (r) => r.kd, cell: (r) => (r.blank ? null : <Difficulty kd={r.kd} />) },
    { id: "intent", label: "Intent", type: "list", value: (r) => r.intent, cell: (r) => (r.blank ? null : (r.intent ?? <span className="text-muted">–</span>)) },
    { id: "cpc", label: "CPC", type: "number", value: (r) => r.cpc ?? null, cell: (r) => (r.blank ? null : fmtCpc(r.cpc ?? null)) },
    { id: "action", label: "Job", type: "list", value: (r) => (r.blank ? null : r.action === "update" ? "Update page" : "New page"), options: ["New page", "Update page"] },
    { id: "theme", label: "Theme", type: "list", value: (r) => r.theme ?? null },
    {
      id: "url",
      label: "Existing page",
      type: "text",
      value: (r) => r.url ?? null,
      cell: (r) =>
        r.url ? (
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="block max-w-56 truncate" title={r.url}>
            {r.url.replace(/^https?:\/\/(www\.)?/, "")}
          </a>
        ) : null,
    },
    { id: "notes", label: "Notes", type: "text", value: (r) => r.notes, width: 240, cell: (r) => (r.blank ? null : (r.notes ?? <span className="text-muted">–</span>)), edit: ed(text("notes")) },
    { id: "source", label: "Source", type: "list", value: (r) => r.source || null, cell: (r) => (r.blank ? null : r.source) },
    { id: "added", label: "Added", type: "date", value: (r) => r.added || null, cell: (r) => (r.blank ? null : r.added) },
  ];

  const toolbar = canEdit ? (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          addKeywords(paste.split(/\n|,|;/), "pasted");
          setPaste("");
        }}
      >
        <input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste keywords, comma separated" aria-label="Paste keywords" className="aw-input w-72! py-1.5! text-[13px]!" />
        <button type="submit" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={!paste.trim()}>
          Add
        </button>
      </form>
      <input
        ref={file}
        type="file"
        accept=".csv,text/csv,.tsv,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
      <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => file.current?.click()}>
        <UploadIcon />
        Upload CSV
      </button>
      {bare.length ? (
        <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => enrich(bare)} disabled={Boolean(busy)}>
          {busy === "enrich" ? "Enriching..." : `Enrich all ${bare.length}`}
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-5">
      {canEdit && runs && !hasPlan ? <BankIntro onStart={() => setWizard(true)} /> : null}
      {runs && !hasPlan && !bank.length ? (
        <Card title="Sample: a Topic Bank for Acme" action={<span className="aw-chip">Example only</span>}>
          <Sheet<Row> id="bank:sample" label="Sample Topic Bank" rows={SAMPLE} cols={cols.map((c) => ({ ...c, edit: undefined }))} rowKey={(r) => r.id} sort={{ key: "stage", desc: false }} height="40vh" />
        </Card>
      ) : null}
      {error ? <p className="aw-error">{error}</p> : null}
      {notice ? (
        <div className="aw-callout flex flex-wrap items-center justify-between gap-3">
          {notice}
          {/calendar/i.test(notice) ? (
            <button type="button" className="aw-text-link" onClick={onCalendar}>
              View calendar
            </button>
          ) : null}
        </div>
      ) : null}

      <Card action={toolbar}>
        {picked.size && canEdit ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-rule-faint bg-brand-pale px-5 py-2.5">
            <span className="text-[13px] font-medium text-ink">{picked.size} selected</span>
            <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={toCalendar}>
              Move to calendar
            </button>
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => enrich(bank.filter((b) => picked.has(b.id)))} disabled={Boolean(busy)}>
              {busy === "enrich" ? "Enriching..." : "Enrich"}
            </button>
            <button
              type="button"
              className="aw-btn aw-btn--secondary aw-btn--sm"
              onClick={() => {
                save(bank.filter((b) => !picked.has(b.id)));
                setPicked(new Set());
              }}
            >
              Delete
            </button>
          </div>
        ) : null}
        <Sheet<Row>
          id={`bank:${site.id}`}
          label="Topic Bank"
          rows={rows}
          cols={cols}
          rowKey={(r) => r.id}
          sort={{ key: "stage", desc: false }}
          onOpen={setOpen}
          canOpen={(r) => !r.blank}
          selected={canEdit ? picked : undefined}
          onSelect={canEdit ? setPicked : undefined}
          canSelect={(r) => !r.blank}
          height="60vh"
        />
      </Card>

      <PlanProgress sb={sb} site={site} refresh={refresh} onRows={fromPlan} />
      {wizard ? (
        <PlanWizard
          sb={sb}
          auth={auth}
          site={site}
          onSite={onSite}
          onClose={() => setWizard(false)}
          onStarted={() => {
            setWizard(false);
            setRefresh((n) => n + 1);
          }}
        />
      ) : null}
      {open ? (
        <KeywordPanel
          sb={sb}
          auth={auth}
          site={site}
          keyword={open.keyword}
          seed={{ volume: open.volume, kd: open.kd, intent: open.intent, cpc: open.cpc ?? null }}
          canEdit={canEdit}
          onSite={onSite}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

/** What the free Topic Bank is, before a brand has one. */
function BankIntro({ onStart }: { onStart: () => void }) {
  return (
    <section className="aw-frame grid gap-6 p-6 md:grid-cols-[minmax(0,1fr)_240px] md:p-8">
      <div className="flex flex-col gap-3">
        <span className="aw-label">Free, once per brand</span>
        <h2 className="aw-h3 mb-0!">Your Topic Bank, built by an AI agent</h2>
        <p className="text-[15px] text-body">Our revenue-driven content strategy AI agent can:</p>
        <ul className="flex flex-col gap-2 text-[15px] text-ink">
          {[
            "Learn about your business, deeply",
            "Cherry-pick the keywords that have the highest revenue potential",
            "Craft a detailed Topic Bank with every metric you need to make informed decisions",
            "Find pages you already have that could rank higher with a quick content update",
          ].map((x) => (
            <li key={x} className="flex items-start gap-2.5">
              <span className="mt-0.5 text-brand">
                <AiIcon />
              </span>
              {x}
            </li>
          ))}
        </ul>
        <p className="text-[15px] text-body">
          You can add your own keywords by typing, pasting or uploading a CSV. Once done, you can import the best ones into the Editorial Calendar when you are ready to write.
        </p>
      </div>
      <div className="flex flex-col justify-center gap-3 border-rule md:border-l md:pl-6">
        <span className="text-[13px] text-muted">Ready in about 10 minutes. You can leave this page while it works.</span>
        <button type="button" className="aw-btn aw-btn--accent self-start" onClick={onStart}>
          <AiIcon />
          Generate Topic Bank
        </button>
      </div>
    </section>
  );
}
