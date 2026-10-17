"use client";

import { useState } from "react";
import type { CalendarItem } from "@/lib/db";
import { nextMonday, type Stage } from "@/lib/research";
import { Sheet, type Col } from "../Sheet";
import { AiIcon, SidePanel } from "../ui";
import { CalendarGrid } from "./CalendarGrid";
import { byStage, Difficulty, fmtCpc, PLAN_VIEWS, statusLabel, StageTag, Tick, ViewSwitch, type PlanView } from "./shared";

type Row = CalendarItem & { cpc: number | null };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** A day this many days after next Monday, so the sample calendar always shows the weeks ahead. */
const day = (n: number | null) => {
  if (n === null) return null;
  const d = nextMonday();
  d.setDate(d.getDate() + n);
  return iso(d);
};

/** A made-up Content Plan for Acme, shown before a brand has its own. */
const SAMPLE: Row[] = (
  [
    ["quickbooks alternatives", "bofu", 4400, 41, "commercial", 15.6, "update", "Competitor comparisons", 0, "brief", "Our page ranks #14. Add a pricing table and FAQs."],
    ["best accounting software for small business", "bofu", 9900, 62, "commercial", 18.4, "new", "Software comparisons", 1, "writing", "Compare 8 tools on price, payroll and bank sync."],
    ["acme vs quickbooks", "bofu", 1300, 28, "commercial", 12.1, "new", "Competitor comparisons", 3, "planned", "Honest side-by-side. Win on ease of use."],
    ["invoice software for freelancers", "bofu", 2900, 35, "transactional", 9.8, "new", "Invoicing", 8, "planned", "Lead with the free plan."],
    ["payroll software for small business", "bofu", 6600, 52, "commercial", 21.3, "new", "Payroll", 14, "planned", "Show setup in 10 minutes."],
    ["acme pricing", "bofu", 880, 12, "transactional", 7.4, "new", "Pricing", 17, "planned", "Plain pricing table and a free trial link."],
    ["how to do bookkeeping for a small business", "mofu", 6600, 47, "informational", 4.2, "new", "Bookkeeping basics", 7, "planned", "Step-by-step guide with a free template."],
    ["cash basis vs accrual accounting", "mofu", 5400, 38, "informational", 3.1, "update", "Bookkeeping basics", null, "planned", "Refresh the 2023 post. Add examples."],
    ["small business tax deductions", "tofu", 14800, 58, "informational", 6.5, "new", "Taxes", 10, "planned", "Checklist post. Good for links."],
    ["what is a balance sheet", "tofu", 22200, 66, "informational", 1.9, "new", "Finance 101", null, "planned", "Short explainer with a sample sheet."],
  ] as const
)
  .map(
    ([keyword, stage, volume, kd, intent, cpc, action, theme, due, status, notes], i): Row => ({
      id: `sample-${i}`,
      site_id: "sample",
      keyword,
      secondary: [],
      stage: stage as Stage,
      theme,
      volume,
      difficulty: kd,
      intent,
      cpc,
      status,
      due_date: day(due),
      owner: i % 3 === 0 ? "Sam" : i % 3 === 1 ? "Priya" : null,
      url: null,
      notes,
      source: "content plan",
      created_at: "",
      action,
      current_url: action === "update" ? `https://acme.com/blog/${keyword.replace(/\s+/g, "-")}` : null,
      current_rank: action === "update" ? 14 : null,
      brief_status: status === "brief" || status === "writing" ? "done" : null,
      brief_error: null,
      brief_at: null,
    }),
  )
  .sort(byStage);

const COLS: Col<Row>[] = [
  { id: "keyword", label: "Keyword", type: "text", value: (r) => r.keyword, width: 260 },
  { id: "stage", label: "Stage", type: "list", value: (r) => (r.stage ? r.stage.toUpperCase() : ""), width: 80, cell: (r) => <StageTag stage={r.stage} /> },
  { id: "status", label: "Status", type: "list", value: (r) => statusLabel(r), width: 110 },
  { id: "due", label: "Planned", type: "date", value: (r) => r.due_date, width: 110, cell: (r) => (r.due_date ? new Date(`${r.due_date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : <span className="text-muted">Idea</span>) },
  { id: "volume", label: "Volume", type: "number", value: (r) => r.volume, width: 80 },
  { id: "kd", label: "Difficulty", type: "number", value: (r) => r.difficulty, width: 100, cell: (r) => <Difficulty kd={r.difficulty} /> },
  { id: "cpc", label: "CPC", type: "number", value: (r) => r.cpc, width: 70, cell: (r) => fmtCpc(r.cpc) },
  { id: "action", label: "Job", type: "list", value: (r) => (r.action === "update" ? "Update page" : "New page"), width: 100 },
  { id: "theme", label: "Theme", type: "list", value: (r) => r.theme, width: 160 },
  { id: "notes", label: "Notes", type: "text", value: (r) => r.notes, width: 300 },
];

/** What the Content Plan is. It stays at the top of the page, before and after the plan is built. */
export function PlanIntro({ canEdit, busy, built, onBuild, trial }: { canEdit: boolean; busy: boolean; built: boolean; onBuild: () => void; trial?: { onUpgrade: () => void } }) {
  return (
    <section className="aw-frame flex flex-col gap-3 p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="aw-h3 mb-0!">Your Content Plan, built by an AI agent</h2>
        {built ? (
          <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
            <Tick />
            Your plan is built
          </span>
        ) : null}
      </div>
      <p className="text-[15px] text-ink">Our revenue-driven content strategy AI agent can:</p>
      <ul className="flex flex-col gap-2 text-[15px] text-ink">
        {[
          "Learn about your business, deeply",
          "Cherry-pick the keywords that have the highest revenue potential",
          "Plan 12 weeks of content with dates, ready-to-buy topics first",
          "Find pages you already have that could rank higher with a quick content update",
          "Read Google's top 10 for any keyword, write the brief, then write the draft with the Agentic Writer",
        ].map((x) => (
          <li key={x} className="flex items-start gap-2.5">
            <span className="mt-0.5 text-brand">
              <AiIcon />
            </span>
            {x}
          </li>
        ))}
      </ul>
      <p className="text-[15px] text-ink">Edit it like a spreadsheet: move dates, paste in your own keywords, and click any keyword to research it and write it.</p>
      {!built && canEdit ? (
        <button type="button" className="aw-btn aw-btn--accent mt-2 self-start" onClick={onBuild} disabled={busy}>
          <AiIcon />
          {busy ? "Starting..." : "Build my content plan"}
        </button>
      ) : null}
      {trial ? (
        <p className="text-[13px] text-muted">
          Your free trial plan has 10 content items. You can edit, research and write all of them.{" "}
          <button type="button" className="aw-text-link" onClick={trial.onUpgrade}>
            Upgrade for the full 120-item plan
          </button>
        </p>
      ) : null}
      {built || canEdit ? null : <p className="aw-small">Ask an editor to build the Content Plan.</p>}
    </section>
  );
}

/** The Acme sample, as a list or on the calendar. Click a keyword to see what each piece holds. */
export function PlanSample() {
  const [view, setView] = useState<PlanView>("list");
  const [open, setOpen] = useState<Row | null>(null);
  const toggle = <ViewSwitch value={view} onChange={setView} options={PLAN_VIEWS} />;
  return (
    <>
      <section className="aw-frame">
        <div className="aw-frame__head justify-between">
          <h2 className="aw-h4">Sample: a Content Plan for Acme</h2>
          <span className="aw-chip">Example only · click a keyword</span>
        </div>
        {view === "list" ? (
          <Sheet<Row> id="plan:sample" label="Sample Content Plan" rows={SAMPLE} cols={COLS} rowKey={(r) => r.id} sort={{ key: "stage", desc: false }} height="none" showFilters={false} counts={false} toolbar={toggle} onOpen={setOpen} />
        ) : (
          <div className="p-4">
            <CalendarGrid items={SAMPLE} canEdit={false} onMove={() => {}} onDay={() => {}} onOpen={(id) => setOpen(SAMPLE.find((r) => r.id === id) ?? null)} toolbar={toggle} />
          </div>
        )}
      </section>
      {open ? <DemoPiece row={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

type DemoTab = "overview" | "serp" | "brief" | "draft";

/** What a real piece holds, filled with sample data: the SERP analysis, the brief and the Agentic Writer. */
function DemoPiece({ row, onClose }: { row: Row; onClose: () => void }) {
  const [tab, setTab] = useState<DemoTab>("draft");
  const tabs: { id: DemoTab; label: React.ReactNode }[] = [
    { id: "overview", label: "Overview" },
    { id: "serp", label: <>SERP analysis <Tick /></> },
    { id: "brief", label: <>Content Brief <Tick /></> },
    { id: "draft", label: "Agentic Writer" },
  ];
  const serp = [
    ["forbes.com", `The 10 Best ${row.keyword.replace(/\b\w/g, (c) => c.toUpperCase())} in ${new Date().getFullYear()}`, 3400, 14],
    ["nerdwallet.com", `${row.keyword.replace(/\b\w/g, (c) => c.toUpperCase())}: Our Picks`, 2900, 11],
    ["reddit.com", `What are you using for ${row.keyword}?`, 900, 0],
    ["g2.com", `Top ${row.keyword.replace(/\b\w/g, (c) => c.toUpperCase())} Reviews`, 1800, 9],
  ] as const;
  return (
    <SidePanel title={row.keyword} kicker="Sample content piece" onClose={onClose}>
      <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
        <StageTag stage={row.stage} />
        <span className="aw-num">{row.volume?.toLocaleString("en-US")} searches / mo</span>
        <Difficulty kd={row.difficulty} />
        <span className="aw-status aw-status--pending">{statusLabel(row)}</span>
      </div>
      <div className="aw-seg self-start" role="tablist" aria-label="Content piece">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={tab === t.id ? "is-on" : ""}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "overview" ? (
        <div className="aw-frame grid gap-4 p-6 sm:grid-cols-2">
          {[
            ["Keyword", row.keyword],
            ["Status", statusLabel(row)],
            ["Publish date", row.due_date ?? "Not scheduled"],
            ["Owner", row.owner ?? "–"],
            ["Job", row.action === "update" ? `Update ${row.current_url}` : "New page"],
            ["Notes", row.notes],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col gap-1">
              <span className="aw-label">{k}</span>
              <span className="text-[14px] text-ink">{v}</span>
            </div>
          ))}
        </div>
      ) : tab === "serp" ? (
        <section className="aw-frame">
          <div className="aw-frame__head justify-between">
            <h3 className="aw-h4">Google&apos;s top results · United States</h3>
            <span className="aw-small">The brief reads this. No second search.</span>
          </div>
          <table className="aw-table">
            <thead>
              <tr>
                <th className="w-12">#</th>
                <th>Page</th>
                <th className="w-24">Words</th>
                <th className="w-24">Tables</th>
              </tr>
            </thead>
            <tbody>
              {serp.map(([d, t, w, tb], i) => (
                <tr key={d}>
                  <td className="aw-num">{i + 1}</td>
                  <td>
                    <span className="flex flex-col">
                      <span className="text-ink">{t}</span>
                      <span className="text-[12px] text-muted">{d}</span>
                    </span>
                  </td>
                  <td className="aw-num">{w.toLocaleString("en-US")}</td>
                  <td className="aw-num">{tb}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : tab === "brief" ? (
        <section className="aw-frame flex flex-col gap-3 p-6">
          <span className="aw-label">Search intent</span>
          <p className="text-[14px] text-ink">Buyers comparing tools before a free trial. They want prices, must-have features and an honest pick.</p>
          <span className="aw-label">Outline</span>
          <ol className="list-decimal pl-5 text-[14px] text-ink">
            <li>Introduction: the problem, why it costs money, the fix</li>
            <li>H2: How we picked</li>
            <li>H2: The 8 best options, compared (table: price, payroll, bank sync)</li>
            <li>H2: Where Acme fits</li>
            <li>H2: FAQs</li>
          </ol>
        </section>
      ) : (
        <section className="aw-frame overflow-hidden">
          <div className="flex flex-wrap items-center gap-1 border-b border-rule bg-white px-3 py-2">
            {["H1", "H2", "H3", "B", "I", "•", "1.", "🔗", "⊞"].map((b) => (
              <span key={b} className="aw-tool">
                {b}
              </span>
            ))}
            <span className="ml-auto aw-small">Saved</span>
          </div>
          <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="aw-doc flex flex-col gap-3 px-8 py-8">
              <h1 className="text-[28px] font-semibold text-ink">{row.keyword.replace(/\b\w/g, (c) => c.toUpperCase())}: An Honest Guide</h1>
              <p className="text-[15px] leading-relaxed text-body">Picking the wrong tool costs more than its price. You lose hours to manual entry, miss tax deadlines and pay for features you never use. This guide compares the options on what matters to a small team.</p>
              <h2 className="text-[20px] font-semibold text-ink">How we picked</h2>
              <p className="text-[15px] leading-relaxed text-body">We tested each tool for two weeks with real invoices, a payroll run and three bank accounts.</p>
              <div className="border-l-2 border-brand bg-brand-pale px-4 py-3 text-[13px] text-ink">✦ The agent is writing “The 8 best options, compared” with a pricing table…</div>
            </div>
            <aside className="flex flex-col gap-2 border-t border-rule bg-surface-2 p-4 lg:border-t-0 lg:border-l">
              <span className="aw-label">Agentic Writer</span>
              {[
                ["Introduction", true],
                ["How we picked", true],
                ["The 8 best options, compared", false],
                ["Where Acme fits", false],
                ["FAQs", false],
              ].map(([s, done]) => (
                <span key={String(s)} className="flex items-center justify-between gap-2 rounded-[6px] bg-white px-3 py-2 text-[13px] text-ink">
                  {s}
                  {done ? <Tick /> : <span className="aw-chip">Write</span>}
                </span>
              ))}
              <p className="mt-2 text-[12px] text-muted">On your own plan, click any keyword and write it here, section by section, in your brand&apos;s voice. Then publish to your CMS.</p>
            </aside>
          </div>
        </section>
      )}
    </SidePanel>
  );
}
