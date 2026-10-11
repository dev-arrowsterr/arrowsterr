"use client";

import type { Stage } from "@/lib/research";
import { Sheet, type Col } from "../Sheet";
import { AiIcon, Card } from "../ui";
import { Difficulty, fmtCpc, StageTag } from "./shared";

type Row = { id: string; keyword: string; stage: Stage; volume: number; kd: number; intent: string; cpc: number; action: "new" | "update"; theme: string; due: string | null; notes: string };

/** A made-up Content Plan for Acme, shown before a brand has its own. */
const SAMPLE: Row[] = (
  [
    ["quickbooks alternatives", "bofu", 4400, 41, "commercial", 15.6, "update", "Competitor comparisons", "2026-10-12", "Our page ranks #14. Add a pricing table and FAQs."],
    ["best accounting software for small business", "bofu", 9900, 62, "commercial", 18.4, "new", "Software comparisons", "2026-10-13", "Compare 8 tools on price, payroll and bank sync."],
    ["acme vs quickbooks", "bofu", 1300, 28, "commercial", 12.1, "new", "Competitor comparisons", "2026-10-15", "Honest side-by-side. Win on ease of use."],
    ["how to do bookkeeping for a small business", "mofu", 6600, 47, "informational", 4.2, "new", "Bookkeeping basics", "2026-10-19", "Step-by-step guide with a free template."],
    ["invoice software for freelancers", "bofu", 2900, 35, "transactional", 9.8, "new", "Invoicing", "2026-10-20", "Lead with the free plan."],
    ["small business tax deductions", "tofu", 14800, 58, "informational", 6.5, "new", "Taxes", "2026-10-22", "Checklist post. Good for links."],
    ["payroll software for small business", "bofu", 6600, 52, "commercial", 21.3, "new", "Payroll", "2026-10-26", "Show setup in 10 minutes."],
    ["cash basis vs accrual accounting", "mofu", 5400, 38, "informational", 3.1, "update", "Bookkeeping basics", "2026-10-27", "Refresh the 2023 post. Add examples."],
    ["acme pricing", "bofu", 880, 12, "transactional", 7.4, "new", "Pricing", "2026-10-29", "Plain pricing table and a free trial link."],
    ["what is a balance sheet", "tofu", 22200, 66, "informational", 1.9, "new", "Finance 101", null, "Short explainer with a sample sheet."],
  ] as const
).map(([keyword, stage, volume, kd, intent, cpc, action, theme, due, notes], i) => ({ id: `sample-${i}`, keyword, stage, volume, kd, intent, cpc, action, theme, due, notes }));

const COLS: Col<Row>[] = [
  { id: "due", label: "Planned", type: "date", value: (r) => r.due, width: 110, cell: (r) => (r.due ? new Date(`${r.due}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : <span className="text-muted">Idea</span>) },
  { id: "keyword", label: "Keyword", type: "text", value: (r) => r.keyword, width: 260 },
  { id: "stage", label: "Stage", type: "list", value: (r) => r.stage, width: 80, cell: (r) => <StageTag stage={r.stage} /> },
  { id: "volume", label: "Volume", type: "number", value: (r) => r.volume, width: 80, cell: (r) => r.volume.toLocaleString("en-US") },
  { id: "kd", label: "Difficulty", type: "number", value: (r) => r.kd, width: 100, cell: (r) => <Difficulty kd={r.kd} /> },
  { id: "cpc", label: "CPC", type: "number", value: (r) => r.cpc, width: 70, cell: (r) => fmtCpc(r.cpc) },
  { id: "action", label: "Job", type: "list", value: (r) => (r.action === "update" ? "Update page" : "New page"), width: 100 },
  { id: "theme", label: "Theme", type: "list", value: (r) => r.theme, width: 160 },
  { id: "notes", label: "Notes", type: "text", value: (r) => r.notes, width: 300 },
];

/** What the Content Plan is, with a sample, before a brand has one. */
export function PlanIntro({ canEdit, busy, onBuild }: { canEdit: boolean; busy: boolean; onBuild: () => void }) {
  return (
    <>
      <section className="aw-frame flex flex-col gap-3 p-6 md:p-8">
        <h2 className="aw-h3 mb-0!">Your Content Plan, built by an AI agent</h2>
        <p className="text-[15px] text-ink">Our revenue-driven content strategy AI agent can:</p>
        <ul className="flex flex-col gap-2 text-[15px] text-ink">
          {[
            "Learn about your business, deeply",
            "Cherry-pick the keywords that have the highest revenue potential",
            "Plan 12 weeks of content with dates, ready-to-buy topics first",
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
        <p className="text-[15px] text-ink">Once it is built, edit it freely: move dates, add your own keywords, and write each piece with the Agentic Writer.</p>
        {canEdit ? (
          <button type="button" className="aw-btn aw-btn--accent mt-2 self-start" onClick={onBuild} disabled={busy}>
            <AiIcon />
            {busy ? "Starting..." : "Build my content plan"}
          </button>
        ) : (
          <p className="aw-small">Ask an editor to build the Content Plan.</p>
        )}
      </section>
      <Card title="Sample: a Content Plan for Acme" action={<span className="aw-chip">Example only</span>}>
        <Sheet<Row> id="plan:sample" label="Sample Content Plan" rows={SAMPLE} cols={COLS} rowKey={(r) => r.id} height="none" showFilters={false} />
      </Card>
    </>
  );
}
