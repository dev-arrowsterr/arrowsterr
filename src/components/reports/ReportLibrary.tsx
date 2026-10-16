"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";
import { UNLIMITED } from "@/lib/plans";
import { KIND_LABEL, TEMPLATES, type Template } from "@/lib/reportDoc";
import type { RunAuth } from "@/lib/runner";
import { Dropdown, Pop } from "../Pickers";
import { SampleRows, SampleStats, ToolIntro } from "../ToolIntro";
import { Seg } from "../ui";
import { Confirm, Modal } from "./Dialog";
import { ago, errText, post } from "./reportApi";
import { REPORT_COLS, type Library, type SavedReport } from "./types";

type Tab = "all" | "ai" | "content";
type Own = "all" | "mine" | "archived";
type Filters = { own: Own; brand: string; q: string };
const FILTER_KEY = "arrowsterr.reports.filters";

function readFilters(): Filters {
  try {
    return { own: "all", brand: "", q: "", ...JSON.parse(localStorage.getItem(FILTER_KEY) ?? "{}") };
  } catch {
    return { own: "all", brand: "", q: "" };
  }
}

/** The report library (docs/reports.md, section 3): templates on top, saved reports below. */
export function ReportLibrary({
  sb,
  auth,
  lib,
  brandId,
  canEdit,
  onOpen,
  onChange,
  reload,
  onPlans,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  lib: Library;
  brandId: string;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onChange: (lib: Library) => void;
  reload: () => Promise<void>;
  onPlans: () => void;
}) {
  const [tab, setTab] = useState<Tab>("all");
  const [filters, setFiltersState] = useState<Filters>(readFilters);
  const [making, setMaking] = useState<Template | null>(null);
  const [renaming, setRenaming] = useState<SavedReport | null>(null);
  const [deleting, setDeleting] = useState<SavedReport | null>(null);
  const [menu, setMenu] = useState<{ r: SavedReport; anchor: DOMRect } | null>(null);
  const [limitHit, setLimitHit] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const setFilters = (p: Partial<Filters>) => {
    const next = { ...filters, ...p };
    setFiltersState(next);
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked. Filters reset on the next visit.
    }
  };

  const active = lib.reports.filter((r) => !r.archived_at);
  const atLimit = active.length >= lib.limits.saved;
  const brandName = (id: string) => lib.brands.find((b) => b.id === id)?.name ?? "–";
  const q = filters.q.trim().toLowerCase();
  const rows = lib.reports
    .filter((r) => (filters.own === "archived" ? r.archived_at : !r.archived_at))
    .filter((r) => filters.own !== "mine" || r.created_by === lib.me)
    .filter((r) => !filters.brand || r.brand_id === filters.brand)
    .filter((r) => !q || r.name.toLowerCase().includes(q) || brandName(r.brand_id).toLowerCase().includes(q));
  const templates = TEMPLATES.filter((t) => tab === "all" || t.tab === tab);

  const start = (t: Template) => (atLimit ? setLimitHit(true) : setMaking(t));
  const replace = (r: SavedReport) => onChange({ ...lib, reports: lib.reports.map((x) => (x.id === r.id ? r : x)) });

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError("");
    try {
      await fn();
    } catch (e) {
      if ((e as { limit?: boolean }).limit) setLimitHit(true);
      else setError(errText(e));
    } finally {
      setBusy("");
    }
  }

  const duplicate = (r: SavedReport) =>
    act("dup", async () => {
      if (atLimit) return setLimitHit(true);
      const { report } = await post<{ report: SavedReport }>(auth, "/api/reports/create", { fromId: r.id });
      onChange({ ...lib, reports: [report, ...lib.reports] });
      onOpen(report.id);
    });
  const archive = (r: SavedReport, on: boolean) =>
    act("archive", async () => {
      if (!on && atLimit) return setLimitHit(true);
      const { data, error } = await sb.from("reports").update({ archived_at: on ? new Date().toISOString() : null }).eq("id", r.id).select(REPORT_COLS).single();
      if (error) throw new Error(error.message);
      replace(data as SavedReport);
    });

  const menuItems = (r: SavedReport) =>
    [
      { label: "Open", run: () => onOpen(r.id), show: true },
      { label: "Duplicate", run: () => duplicate(r), show: canEdit },
      { label: "Rename", run: () => setRenaming(r), show: canEdit },
      { label: r.archived_at ? "Restore" : "Archive", run: () => archive(r, !r.archived_at), show: canEdit },
      { label: "Delete", run: () => setDeleting(r), show: canEdit, danger: true },
    ].filter((x) => x.show);

  const gallery = (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="aw-h4">Templates</h2>
        <Seg
          label="Template type"
          value={tab}
          onChange={setTab}
          options={[
            { id: "all", label: `All ${TEMPLATES.length}` },
            { id: "ai", label: `AI Visibility ${TEMPLATES.filter((t) => t.tab === "ai").length}` },
            { id: "content", label: `Content ${TEMPLATES.filter((t) => t.tab === "content").length}` },
          ]}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {templates.map((t) => (
          <button key={t.id} type="button" disabled={!canEdit} onClick={() => start(t)} className="aw-frame flex min-h-36 flex-col items-start gap-2 p-4 text-left transition-colors hover:border-brand disabled:cursor-default">
            <span className="aw-tag">{KIND_LABEL[t.kind]}</span>
            <span className="text-[15px] font-medium text-ink">{t.name}</span>
            <span className="text-[13px] text-body">{t.text}</span>
            {canEdit ? <span className="mt-auto text-[13px] font-medium text-brand">Use template</span> : null}
          </button>
        ))}
      </div>
    </section>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="aw-h2">Reports</h1>
        <span className="flex items-center gap-3">
          {lib.limits.saved < UNLIMITED ? (
            <span className="aw-micro">
              {active.length} of {lib.limits.saved} reports
            </span>
          ) : null}
          {canEdit ? (
            <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={() => start(TEMPLATES[0])}>
              New report
            </button>
          ) : null}
        </span>
      </div>
      {error ? <p className="aw-error">{error}</p> : null}

      {!lib.reports.length ? (
        <ToolIntro
          eyebrow="Start here"
          title="Send clients a report they'll actually read"
          lead="Save a report once, pick its dates, and share a link that stays up to date, a PDF, or both."
          action={
            canEdit ? (
              <>
                <button type="button" className="aw-btn aw-btn--accent" onClick={() => start(TEMPLATES[0])}>
                  Use the monthly template
                </button>
                <button type="button" className="aw-btn aw-btn--secondary" onClick={() => start(TEMPLATES[1])}>
                  Start with a one-pager
                </button>
              </>
            ) : null
          }
          features={[
            { title: "Your numbers, any dates", text: "Last month, last quarter or any dates you pick, compared with the period before or last year.", visual: <SampleStats items={[["Visibility", "38%"], ["Rank", "#2"], ["AI visits", "412"]]} /> },
            { title: "Your blocks, your order", text: "Turn sections on or off and move them. The report saves as you go.", visual: <SampleRows rows={[["AI scorecard", 90], ["Wins and watch list", 70], ["Who AI recommends", 55]]} /> },
            { title: "Live links and PDFs", text: "A live link shows fresh numbers every time it opens. Add a password and an end date on Pro." },
          ]}
        />
      ) : null}

      {gallery}

      {lib.reports.length ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Seg
              label="Show"
              value={filters.own}
              onChange={(own) => setFilters({ own })}
              options={[
                { id: "all", label: "All" },
                { id: "mine", label: "Mine" },
                { id: "archived", label: "Archived" },
              ]}
            />
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <Dropdown<string> label="Brand" value={filters.brand} onChange={(brand) => setFilters({ brand })} className="aw-dropdown--sm w-44" options={[{ id: "", label: "All brands" }, ...lib.brands.map((b) => ({ id: b.id, label: b.name }))]} />
              <span className="w-56">
                <input value={filters.q} onChange={(e) => setFilters({ q: e.target.value })} placeholder="Search reports" aria-label="Search reports" className="aw-input py-1.5! text-[14px]!" />
              </span>
            </span>
          </div>
          <div className="aw-table-wrap overflow-x-auto">
            <table className="aw-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="w-44">Brand</th>
                  <th className="w-32">Updated</th>
                  <th className="w-24 text-right">Views</th>
                  <th className="w-24 text-right">Links</th>
                  <th className="w-12" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <button type="button" className="flex flex-col items-start text-left" onClick={() => onOpen(r.id)}>
                        <span className="font-medium text-ink hover:underline">{r.name}</span>
                        <span className="text-[12px] text-muted">{KIND_LABEL[r.kind]}</span>
                      </button>
                    </td>
                    <td>{brandName(r.brand_id)}</td>
                    <td title={new Date(r.updated_at).toLocaleString()}>{ago(r.updated_at)}</td>
                    <td className="aw-num text-right">{lib.views[r.id] ?? 0}</td>
                    <td className="aw-num text-right">{lib.shared[r.id] ?? 0}</td>
                    <td>
                      <button type="button" aria-label={`Actions for ${r.name}`} aria-haspopup="menu" className="aw-btn aw-btn--ghost aw-btn--sm px-2!" onClick={(e) => setMenu({ r, anchor: e.currentTarget.getBoundingClientRect() })}>
                        ⋯
                      </button>
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={6} className="text-muted">
                      No reports match.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {menu ? (
        <Pop anchor={menu.anchor} onClose={() => setMenu(null)} label={`Actions for ${menu.r.name}`} width={180}>
          <ul role="menu" className="aw-pop__list">
            {menuItems(menu.r).map((m) => (
              <li key={m.label} role="none">
                <button
                  type="button"
                  role="menuitem"
                  autoFocus={m.label === "Open"}
                  className={`aw-pop__opt ${m.danger ? "text-neg!" : ""}`}
                  onClick={() => {
                    setMenu(null);
                    m.run();
                  }}
                >
                  {m.label}
                </button>
              </li>
            ))}
          </ul>
        </Pop>
      ) : null}

      {making ? (
        <NewReport
          lib={lib}
          template={making}
          brandId={lib.brands.some((b) => b.id === brandId) ? brandId : (lib.brands[0]?.id ?? "")}
          onClose={() => setMaking(null)}
          onMade={(report) => {
            setMaking(null);
            onChange({ ...lib, reports: [report, ...lib.reports] });
            onOpen(report.id);
          }}
          onLimit={() => {
            setMaking(null);
            setLimitHit(true);
          }}
          auth={auth}
        />
      ) : null}

      {renaming ? (
        <Rename
          name={renaming.name}
          onClose={() => setRenaming(null)}
          onSave={async (name) => {
            const { data, error } = await sb.from("reports").update({ name }).eq("id", renaming.id).select(REPORT_COLS).single();
            if (error) throw new Error(error.message);
            replace(data as SavedReport);
            setRenaming(null);
          }}
        />
      ) : null}

      {deleting ? (
        <Confirm
          title="Delete report"
          text={lib.shared[deleting.id] ? `Delete ${deleting.name} and its ${lib.shared[deleting.id]} link${lib.shared[deleting.id] === 1 ? "" : "s"}? Clients lose access.` : `Delete ${deleting.name}? This can't be undone.`}
          action="Delete"
          busy={busy === "delete"}
          error={error}
          onClose={() => {
            setDeleting(null);
            setError("");
          }}
          onConfirm={() =>
            act("delete", async () => {
              const { error } = await sb.from("reports").delete().eq("id", deleting.id);
              if (error) throw new Error(error.message);
              onChange({ ...lib, reports: lib.reports.filter((x) => x.id !== deleting.id) });
              setDeleting(null);
              void reload();
            })
          }
        />
      ) : null}

      {limitHit ? (
        <Modal title="Report limit reached" onClose={() => setLimitHit(false)} width="max-w-md">
          <p className="text-[14px] text-body">
            {active.length} of {lib.limits.saved} reports on your plan. Archive one or upgrade to make more.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setLimitHit(false)}>
              Close
            </button>
            <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={onPlans}>
              See plans
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/** Pick a template's brand and name, then make the report. */
function NewReport({ lib, template, brandId, auth, onClose, onMade, onLimit }: { lib: Library; template: Template; brandId: string; auth: RunAuth; onClose: () => void; onMade: (r: SavedReport) => void; onLimit: () => void }) {
  const [pick, setPick] = useState(template.id);
  const [brand, setBrand] = useState(brandId);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = TEMPLATES.find((x) => x.id === pick) ?? template;
  const fallback = `${t.name} · ${lib.brands.find((b) => b.id === brand)?.name ?? ""}`;

  async function make(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { report } = await post<{ report: SavedReport }>(auth, "/api/reports/create", { template: t.id, brandId: brand, name: name.trim() });
      onMade(report);
    } catch (err) {
      if ((err as { limit?: boolean }).limit) return onLimit();
      setError(errText(err));
      setBusy(false);
    }
  }

  return (
    <Modal title="New report" onClose={onClose}>
      <form onSubmit={make} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] text-body">
          Template
          <Dropdown<string> label="Template" value={pick} onChange={setPick} options={TEMPLATES.map((x) => ({ id: x.id, label: x.name }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-body">
          Brand
          <Dropdown<string> label="Brand" value={brand} onChange={setBrand} options={lib.brands.map((b) => ({ id: b.id, label: b.name }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-body">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={fallback} className="aw-input py-2! text-[14px]!" />
        </label>
        {error ? <p className="aw-error">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="aw-btn aw-btn--primary aw-btn--sm" disabled={busy || !brand}>
            {busy ? "Making..." : "Make report"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Rename a report. */
export function Rename({ name, onSave, onClose }: { name: string; onSave: (name: string) => Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title="Rename report" onClose={onClose} width="max-w-md">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave(value.trim());
          } catch (err) {
            setError(errText(err));
            setBusy(false);
          }
        }}
      >
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} maxLength={120} aria-label="Report name" className="aw-input py-2! text-[14px]!" />
        {error ? <p className="aw-error">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="aw-btn aw-btn--primary aw-btn--sm" disabled={busy || !value.trim()}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
