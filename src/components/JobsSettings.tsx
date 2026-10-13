"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { Dropdown } from "./Pickers";
import { downloadCsv } from "./research/shared";
import { atLeast, getUsage, getWorkspaceSettings, topicsOf, type Brand, type Workspace } from "@/lib/db";
import { mergePrompts, promptsFromCsv } from "@/lib/csvImport";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const day = () => new Date().toISOString().slice(0, 10);
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "workspace";

function Status({ error, saved }: { error: string; saved: string }) {
  if (error) return <p className="aw-error">{error}</p>;
  if (saved) return <p className="aw-callout text-[15px]!">{saved}</p>;
  return null;
}

/** Bring prompts in from a CSV, and take prompts, answers and the Content Plan out as CSV. */
export function ExportsSettings({ sb, ws, brands, onBrand }: { sb: SupabaseClient; ws: Workspace; brands: Brand[]; onBrand: (b: Brand) => Promise<void> }) {
  const canEdit = atLeast(ws.role, "editor");
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const brand = brands.find((b) => b.id === brandId) ?? brands[0];
  const name = slug(ws.name);

  async function run(what: string, fn: () => Promise<string | void>) {
    setBusy(what);
    setError("");
    setSaved("");
    try {
      const note = await fn();
      if (note) setSaved(note);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }

  async function importFile(file: File) {
    await run("import", async () => {
      if (!brand) throw new Error("Add a brand first.");
      const rows = promptsFromCsv(await file.text());
      if (!rows.length) throw new Error("No prompts found. Put one prompt per row, in a column named prompt (and topic, if you like).");
      const { brand: next, added, skipped } = mergePrompts(brand, rows);
      if (!added) return `All ${rows.length} prompts are already in ${brand.name}.`;
      const usage = await getUsage(sb, ws.id);
      const room = usage.promptLimit - usage.prompts;
      if (added > room) throw new Error(`Your plan has room for ${Math.max(0, room)} more prompts, and this file adds ${added}. Remove some rows, or boost the plan.`);
      await onBrand(next);
      return `Added ${added} prompt${added === 1 ? "" : "s"} to ${brand.name}${skipped ? `. ${skipped} were already there` : ""}. Ctrl + Z takes them out again.`;
    });
  }

  const exportPrompts = () =>
    run("prompts", async () => {
      const rows = brands.flatMap((b) => topicsOf(b).flatMap((t) => t.prompts.map((p) => [b.name, t.name, p])));
      if (!rows.length) throw new Error("There are no prompts yet.");
      downloadCsv(`${name}-prompts-${day()}.csv`, ["brand", "topic", "prompt"], rows);
    });

  const exportAnswers = () =>
    run("answers", async () => {
      if (!brand) throw new Error("Add a brand first.");
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data, error: err } = await sb.from("answers").select("at, engine, prompt, text").eq("brand_id", brand.id).gte("at", since).order("at", { ascending: false }).limit(5000);
      if (err) throw new Error(err.message);
      if (!data?.length) throw new Error(`No AI answers for ${brand.name} in the last ${days} days.`);
      downloadCsv(
        `${slug(brand.name)}-ai-answers-${day()}.csv`,
        ["date", "ai", "prompt", "answer"],
        data.map((r) => [String(r.at).slice(0, 16).replace("T", " "), r.engine, r.prompt, r.text]),
      );
      return data.length === 5000 ? "Saved the newest 5,000 answers. Pick fewer days for older ones." : undefined;
    });

  const exportPlan = () =>
    run("plan", async () => {
      const [{ data: sites }, { data, error: err }] = await Promise.all([
        sb.from("sites").select("id, name").eq("workspace_id", ws.id),
        sb
          .from("calendar_items")
          .select("site_id, keyword, secondary, stage, theme, volume, difficulty, intent, status, action, due_date, owner, url, current_url, notes")
          .eq("workspace_id", ws.id)
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(5000),
      ]);
      if (err) throw new Error(err.message);
      if (!data?.length) throw new Error("The Content Plan is empty.");
      const site = new Map((sites ?? []).map((s) => [s.id as string, s.name as string]));
      downloadCsv(
        `${name}-content-plan-${day()}.csv`,
        ["website", "keyword", "other keywords", "stage", "theme", "volume", "difficulty", "intent", "status", "new or update", "due date", "owner", "url", "notes"],
        data.map((r) => [
          site.get(r.site_id) ?? "",
          r.keyword,
          (r.secondary ?? []).join("; "),
          r.stage?.toUpperCase(),
          r.theme,
          r.volume,
          r.difficulty,
          r.intent,
          r.status,
          r.action,
          r.due_date,
          r.owner,
          r.url || r.current_url,
          r.notes,
        ]),
      );
    });

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <Status error={error} saved={saved} />

      <section className="flex flex-col gap-4">
        <div>
          <h3 className="aw-h4">Import prompts</h3>
          <p className="aw-small mt-1">A CSV with one prompt per row. Name the columns prompt and topic to sort them into topics. Prompts already tracked are skipped.</p>
        </div>
        {brands.length ? (
          <div className="flex flex-wrap items-center gap-3">
            {brands.length > 1 ? (
              <div className="w-56">
                <Dropdown label="Brand" value={brand?.id ?? ""} onChange={setBrandId} options={brands.map((b) => ({ id: b.id, label: b.name }))} />
              </div>
            ) : null}
            <label className={`aw-btn aw-btn--primary ${canEdit && !busy ? "cursor-pointer" : "pointer-events-none opacity-50"}`}>
              {busy === "import" ? "Importing..." : "Choose CSV file"}
              <input
                type="file"
                accept=".csv,.txt,.tsv,text/csv,text/plain"
                className="hidden"
                disabled={!canEdit || Boolean(busy)}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) importFile(f);
                }}
              />
            </label>
            <button
              type="button"
              className="aw-text-link text-[13px]"
              onClick={() => downloadCsv("prompts-template.csv", ["prompt", "topic"], [["What is the best tool for tracking AI visibility?", "AI visibility"]])}
            >
              Get a template
            </button>
          </div>
        ) : (
          <p className="aw-small">Add a brand first.</p>
        )}
        {!canEdit ? <p className="aw-small">Viewers can export, but only editors can import.</p> : null}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="aw-h4">Export</h3>
        <div className="aw-table-wrap">
          <table className="aw-table">
            <tbody>
              <tr>
                <td>
                  <div className="font-medium text-ink">Prompts</div>
                  <div className="aw-small">Every brand&apos;s prompts with their topics.</div>
                </td>
                <td className="text-right">
                  <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={Boolean(busy)} onClick={exportPrompts}>
                    Download CSV
                  </button>
                </td>
              </tr>
              <tr>
                <td>
                  <div className="font-medium text-ink">AI answers</div>
                  <div className="aw-small mb-2">The full answer each AI gave, by date and prompt.</div>
                  <div className="flex flex-wrap gap-2">
                    {brands.length > 1 ? (
                      <div className="w-48">
                        <Dropdown
                          label="Brand"
                          className="aw-dropdown--sm w-full"
                          value={brand?.id ?? ""}
                          onChange={setBrandId}
                          options={brands.map((b) => ({
                            id: b.id,
                            label: b.name,
                          }))}
                        />
                      </div>
                    ) : null}
                    <Dropdown<number>
                      label="Period"
                      className="aw-dropdown--sm"
                      value={days}
                      onChange={setDays}
                      options={[7, 30, 90, 365].map((d) => ({
                        id: d,
                        label: `Last ${d} days`,
                      }))}
                    />
                  </div>
                </td>
                <td className="text-right align-top">
                  <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={Boolean(busy) || !brand} onClick={exportAnswers}>
                    {busy === "answers" ? "Getting..." : "Download CSV"}
                  </button>
                </td>
              </tr>
              <tr>
                <td>
                  <div className="font-medium text-ink">Content Plan</div>
                  <div className="aw-small">Every planned page across your websites.</div>
                </td>
                <td className="text-right">
                  <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={Boolean(busy)} onClick={exportPlan}>
                    {busy === "plan" ? "Getting..." : "Download CSV"}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="aw-small">Keyword research, domain research and bulk analyses each have their own Export button on their page.</p>
      </section>
    </div>
  );
}

type Action = {
  id: string;
  at: string;
  what: string;
  detail: string;
  status: "running" | "done" | "failed" | "limited";
  error?: string | null;
};
const STATUS: Record<Action["status"], { label: string; tone: string }> = {
  running: { label: "Running", tone: "aw-status--pending" },
  done: { label: "Done", tone: "aw-status--ranked" },
  failed: { label: "Failed", tone: "aw-status--missed" },
  limited: { label: "Stopped at daily limit", tone: "aw-status--warn" },
};

/** What Arrowsterr has been doing in the background: checks, plan builds, briefs and bulk analyses. */
export function JobsSettings({ sb, ws, brands }: { sb: SupabaseClient; ws: Workspace; brands: Brand[] }) {
  const [list, setList] = useState<Action[] | null>(null);
  const [tz, setTz] = useState<string | undefined>(undefined);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const name = new Map(brands.map((b) => [b.id, b.name]));
      const [runs, plans, briefs, bulk, sites] = await Promise.all([
        sb.from("runs").select("id, brand_id, at, source, status, expected, engines").eq("workspace_id", ws.id).order("at", { ascending: false }).limit(30),
        sb.from("keyword_runs").select("id, site_id, status, step, error, created_at").eq("workspace_id", ws.id).order("created_at", { ascending: false }).limit(15),
        sb
          .from("calendar_items")
          .select("id, keyword, brief_status, brief_error, brief_at, brief_started_at")
          .eq("workspace_id", ws.id)
          .not("brief_status", "is", null)
          .order("brief_at", { ascending: false, nullsFirst: true })
          .limit(20),
        sb.from("bulk_runs").select("id, kind, count, created_at").eq("workspace_id", ws.id).order("created_at", { ascending: false }).limit(15),
        sb.from("sites").select("id, name").eq("workspace_id", ws.id),
      ]);
      if (runs.error) throw new Error(runs.error.message);
      const site = new Map((sites.data ?? []).map((s) => [s.id as string, s.name as string]));
      const out: Action[] = [
        ...(runs.data ?? []).map((r) => ({
          id: `run-${r.id}`,
          at: r.at,
          what: `${r.source === "daily" ? "Daily check" : "Check now"} · ${name.get(r.brand_id) ?? "Removed brand"}`,
          detail: r.expected ? `${r.expected} AI answers across ${(r.engines ?? []).length} AI${(r.engines ?? []).length === 1 ? "" : "s"}` : `${(r.engines ?? []).length} AIs`,
          status: r.status as Action["status"],
        })),
        ...(plans.data ?? []).map((r) => ({
          id: `plan-${r.id}`,
          at: r.created_at,
          what: `Content Plan build · ${site.get(r.site_id) ?? "Website"}`,
          detail: r.status === "running" ? r.step || "Working" : "",
          status: r.status as Action["status"],
          error: r.error,
        })),
        ...(briefs.data ?? []).map((r) => ({
          id: `brief-${r.id}`,
          at: r.brief_at ?? r.brief_started_at ?? new Date().toISOString(),
          what: `Content brief · ${r.keyword}`,
          detail: "",
          status: r.brief_status as Action["status"],
          error: r.brief_error,
        })),
        ...(bulk.data ?? []).map((r) => ({
          id: `bulk-${r.id}`,
          at: r.created_at,
          what: `Bulk analysis · ${r.count} ${r.kind}`,
          detail: "",
          status: "done" as const,
        })),
      ].sort((a, b) => b.at.localeCompare(a.at));
      setList(out.slice(0, 50));
    } catch (e) {
      setError(message(e));
      setList([]);
    }
  }, [sb, ws.id, brands]);

  useEffect(() => {
    // Loading from Supabase on first render is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    getWorkspaceSettings(sb, ws.id).then((s) => setTz(s?.timezone ?? undefined));
  }, [load, sb, ws.id]);

  // While something runs, look again every 10 seconds.
  const live = list?.some((a) => a.status === "running");
  useEffect(() => {
    if (!live) return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [live, load]);

  const when = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: tz,
      });
    } catch {
      return new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
  };

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-[15px] text-body">The last 50 things Arrowsterr ran for this workspace.</p>
        <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={load}>
          Refresh
        </button>
      </div>
      {error ? <p className="aw-error">{error}</p> : null}
      {list === null ? (
        <p className="aw-small">Loading...</p>
      ) : !list.length ? (
        <p className="aw-callout text-[15px]!">Nothing has run yet. Checks, Content Plan builds, briefs and bulk analyses show up here.</p>
      ) : (
        <div className="aw-table-wrap">
          <table className="aw-table aw-table--compact">
            <thead>
              <tr>
                <th>Action</th>
                <th>Status</th>
                <th className="text-right">Started</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div className="line-clamp-2 text-ink">{a.what}</div>
                    {a.detail ? <div className="aw-small">{a.detail}</div> : null}
                    {a.status === "failed" && a.error ? <div className="text-[12px] text-neg">{a.error}</div> : null}
                  </td>
                  <td className="whitespace-nowrap">
                    <span className={`aw-status ${STATUS[a.status]?.tone ?? ""}`}>{STATUS[a.status]?.label ?? a.status}</span>
                  </td>
                  <td className="aw-num text-right whitespace-nowrap text-muted">{when(a.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
