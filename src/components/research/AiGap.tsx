"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";
import type { Chat } from "@/lib/chats";
import type { Site } from "@/lib/db";
import type { RunAuth } from "@/lib/runner";
import { Sheet, type Col } from "../Sheet";
import { Card, Empty } from "../ui";
import { gaps, useAiIdeas, type AiIdea } from "./AiIdeas";
import { Difficulty, StageTag } from "./shared";
import { addToBank } from "./TopicBank";

type Miss = ReturnType<typeof gaps>[number];

/** AI Gap: prompts where AI names rivals instead of you, and the keywords that would close them. */
export function AiGap({
  sb,
  auth,
  site,
  canEdit,
  onSite,
  brand,
  chats,
  planned,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  site: Site;
  canEdit: boolean;
  onSite: (s: Site) => void;
  brand: string;
  chats: Chat[];
  planned: string[];
}) {
  const ideas = useAiIdeas(auth, site, brand, chats, [...planned, ...(site.profile.bank ?? []).map((b) => b.keyword)]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");

  const misses = gaps(chats, brand)
    .filter((g) => g.named / g.answers < 0.5 || (g.position ?? 0) > 3)
    .sort((a, b) => a.named / a.answers - b.named / b.answers);

  const missCols: Col<Miss>[] = [
    { id: "prompt", label: "Prompt", type: "text", value: (r) => r.prompt, width: 360 },
    { id: "named", label: "You're named", type: "number", value: (r) => Math.round((r.named / r.answers) * 100), cell: (r) => `${r.named} of ${r.answers}` },
    { id: "position", label: "Your spot", type: "number", value: (r) => r.position, cell: (r) => (r.position ? `#${r.position.toFixed(1)}` : <span className="text-muted">–</span>) },
    { id: "instead", label: "Named instead", type: "text", value: (r) => r.instead.join(", "), cell: (r) => r.instead.join(" · ") || <span className="text-muted">–</span> },
  ];
  const ideaCols: Col<AiIdea>[] = [
    { id: "keyword", label: "Keyword", type: "text", value: (r) => r.keyword, width: 260 },
    { id: "volume", label: "Volume", type: "number", value: (r) => r.volume },
    { id: "kd", label: "Difficulty", type: "number", value: (r) => r.kd, cell: (r) => <Difficulty kd={r.kd} /> },
    { id: "stage", label: "Stage", type: "list", value: (r) => r.stage, cell: (r) => <StageTag stage={r.stage} /> },
    { id: "action", label: "Job", type: "list", value: (r) => (r.action === "update" ? "Update page" : "New page"), options: ["New page", "Update page"] },
    { id: "prompt", label: "Closes", type: "text", value: (r) => r.prompt, width: 280 },
  ];

  function bank() {
    const list = ideas.list.filter((i) => picked.has(i.keyword));
    const n = addToBank(
      sb,
      site,
      onSite,
      list.map((i) => ({ keyword: i.keyword, volume: i.volume, kd: i.kd, intent: i.intent, stage: i.stage, action: i.action, url: i.url, notes: i.why || null })),
      "AI gap",
    );
    setPicked(new Set());
    setNotice(n ? `${n} added to the Topic Bank.` : "Already in the Topic Bank.");
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="aw-kpis" style={{ ["--cols" as string]: 3 }}>
        {[
          { lab: "Prompts with a gap", v: misses.length, tone: "text-neg" },
          { lab: "Not named at all", v: misses.filter((m) => m.named === 0).length, tone: "text-ink" },
          { lab: "Keyword ideas", v: ideas.list.length, tone: "text-brand" },
        ].map((x) => (
          <div key={x.lab} className="aw-kpi">
            <span className="aw-kpi__lab">{x.lab}</span>
            <span className={`aw-kpi__num ${x.tone}`}>{x.v}</span>
          </div>
        ))}
      </div>

      <Card title="Prompts where rivals win">
        {misses.length ? <Sheet<Miss> id={`aigap:${site.id}`} label="AI gaps" rows={misses} cols={missCols} rowKey={(r) => r.prompt} sort={{ key: "named", desc: false }} height="40vh" /> : <Empty>No gaps in this period.</Empty>}
      </Card>

      {ideas.error ? <p className="aw-error">{ideas.error}</p> : null}
      {notice ? <div className="aw-callout">{notice}</div> : null}
      <Card
        title="Keywords that close the gaps"
        action={
          canEdit ? (
            <button type="button" className={`aw-btn aw-btn--sm ${ideas.loaded ? "aw-btn--secondary" : "aw-btn--accent"}`} onClick={ideas.find} disabled={ideas.busy || !misses.length}>
              {ideas.busy ? "Finding..." : ideas.loaded ? "Refresh" : "✦ Find keywords"}
            </button>
          ) : null
        }
      >
        {picked.size && canEdit ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-rule-faint bg-brand-pale px-5 py-2.5">
            <span className="text-[13px] font-medium text-ink">{picked.size} selected</span>
            <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={bank}>
              Add to Topic Bank
            </button>
          </div>
        ) : null}
        {ideas.loaded ? (
          <Sheet<AiIdea>
            id={`aigap-ideas:${site.id}`}
            label="Keywords from AI gaps"
            rows={ideas.list}
            cols={ideaCols}
            rowKey={(r) => r.keyword}
            sort={{ key: "volume", desc: true }}
            selected={canEdit ? picked : undefined}
            onSelect={canEdit ? setPicked : undefined}
            height="50vh"
          />
        ) : null}
      </Card>
    </div>
  );
}
