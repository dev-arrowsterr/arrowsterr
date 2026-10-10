"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { addCalendarItems, listCalendar, saveSite, type BankRow, type Site } from "@/lib/db";
import { MARKETS, slots, stageFromIntent, STAGES, type Stage } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { Sheet, type Col, type Edit } from "../Sheet";
import { Card } from "../ui";
import { PlanProgress } from "./AgenticResearch";
import { PlanWizard } from "./PlanWizard";
import { Difficulty, fmtCpc, post, STAGE_LABEL, StageTag } from "./shared";

const BLANKS = 8; // empty rows always waiting at the bottom of the sheet
type Row = BankRow & { blank?: boolean };
const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clean = (k: string) => k.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 120);

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
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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
  const addKeywords = (list: string[], source = "added by hand") => {
    const have = new Set(bank.map((b) => b.keyword));
    const rows = [...new Set(list.map(clean).filter((k) => k && !have.has(k)))].map(
      (keyword): BankRow => ({ id: newId(), keyword, stage: null, volume: null, kd: null, intent: null, notes: null, source, added: new Date().toISOString().slice(0, 10) }),
    );
    if (rows.length) save([...bank, ...rows]);
  };
  const patch = (id: string, p: Partial<BankRow>) => save(bank.map((b) => (b.id === id ? { ...b, ...p } : b)));

  async function checkVolume() {
    const rows = bank.filter((b) => picked.has(b.id));
    if (!rows.length) return;
    setBusy("volume");
    setError("");
    try {
      const country = site.profile.country && MARKETS[site.profile.country] ? site.profile.country : "United States";
      const out = await post<{ rows: { keyword: string; volume: number | null; kd: number | null; intent: string | null }[] }>(auth, "/api/research/report", { action: "bulk", keywords: rows.map((r) => r.keyword), country });
      const by = new Map(out.rows.map((r) => [r.keyword, r]));
      save(bank.map((b) => (by.has(b.keyword) ? { ...b, volume: by.get(b.keyword)!.volume, kd: by.get(b.keyword)!.kd, intent: by.get(b.keyword)!.intent, stage: b.stage ?? stageFromIntent(by.get(b.keyword)!.intent) } : b)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function toCalendar() {
    const rows = bank.filter((b) => picked.has(b.id));
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

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-end gap-4">
        {canEdit ? (
          <button type="button" className="aw-btn aw-btn--accent" onClick={() => setWizard(true)}>
            ✦ Generate content plan
          </button>
        ) : null}
      </div>
      {error ? <p className="aw-error">{error}</p> : null}
      {notice ? (
        <div className="aw-callout flex flex-wrap items-center justify-between gap-3">
          {notice}
          <button type="button" className="aw-text-link" onClick={onCalendar}>
            View calendar
          </button>
        </div>
      ) : null}

      <Card
        title={`Ideas ${bank.length}`}
        action={
          canEdit ? (
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
          ) : null
        }
      >
        {picked.size && canEdit ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-rule-faint bg-brand-pale px-5 py-2.5">
            <span className="text-[13px] font-medium text-ink">{picked.size} selected</span>
            <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={toCalendar}>
              Move to calendar
            </button>
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={checkVolume} disabled={Boolean(busy)}>
              {busy === "volume" ? "Checking..." : "Check search volume"}
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
          sort={{ key: "added", desc: false }}
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
    </div>
  );
}
