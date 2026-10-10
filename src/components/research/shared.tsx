"use client";

// Small pieces the Research pages share.
import { createContext } from "react";
import type { Stage } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";

export const STAGE_COLORS: Record<Stage, string> = { bofu: "#0943B0", mofu: "#F5B70A", tofu: "#28A745" };
export const STAGE_LABEL: Record<Stage, string> = { bofu: "BOFU", mofu: "MOFU", tofu: "TOFU" };

/** The funnel stage as a word with a colored mark, so color is never the only signal. */
export function StageTag({ stage }: { stage: Stage | null }) {
  if (!stage) return <span className="text-muted">–</span>;
  return (
    <span className="inline-flex items-center gap-1.5 border border-rule bg-white px-1.5 py-0.5 font-mono text-[11px] text-ink">
      <i className="inline-block h-2 w-2" style={{ background: STAGE_COLORS[stage] }} aria-hidden="true" />
      {STAGE_LABEL[stage]}
    </span>
  );
}

/** Keyword difficulty as a number and a word. */
export function Difficulty({ kd }: { kd: number | null }) {
  if (kd === null || kd === undefined) return <span className="text-muted">–</span>;
  const word = kd < 30 ? "Easy" : kd < 50 ? "Medium" : kd < 70 ? "Hard" : "Very hard";
  const color = kd < 30 ? "var(--aw-pos)" : kd < 50 ? "var(--aw-warn)" : "var(--aw-neg)";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="aw-num text-ink">{kd}</span>
      <span className="text-[12px]" style={{ color }}>
        {word}
      </span>
    </span>
  );
}

/** Searches over the last 12 months as a tiny line. */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-muted">–</span>;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 60},${18 - (v / max) * 16}`).join(" ");
  return (
    <svg viewBox="0 0 60 20" width="60" height="20" role="img" aria-label={`Last 12 months: ${values.join(", ")}`}>
      <polyline points={pts} fill="none" stroke="var(--aw-brand)" strokeWidth="1.5" />
    </svg>
  );
}

export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("en-US"));
export const fmtCpc = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `$${n.toFixed(2)}`);

const FEATURES: Record<string, string> = {
  ai_overview: "AI Overview",
  people_also_ask: "People also ask",
  featured_snippet: "Snippet",
  video: "Video",
  local_pack: "Local",
  shopping: "Shopping",
  popular_products: "Products",
  images: "Images",
  top_stories: "News",
};
/** The Google features on a keyword's results page, AI Overview first. */
export function SerpTags({ serp }: { serp: string[] }) {
  const tags = Object.keys(FEATURES).filter((f) => serp.includes(f)).slice(0, 3);
  if (!tags.length) return <span className="text-muted">–</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className={`whitespace-nowrap border px-1.5 py-0.5 text-[11px] ${t === "ai_overview" ? "border-brand bg-brand-pale text-brand" : "border-rule text-body"}`}>
          {FEATURES[t]}
        </span>
      ))}
    </span>
  );
}

/** POST to one of our API routes as the signed-in user. */
export async function post<T>(auth: RunAuth, path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` },
    body: JSON.stringify({ ...body, workspaceId: auth.workspaceId }),
  });
  const data = await res.json().catch(() => ({ error: `The server returned ${res.status}.` }));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data as T;
}

/** Save rows as a CSV file. */
export function downloadCsv(name: string, head: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [head, ...rows].map((r) => r.map(cell).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** A checkbox that can show "some selected". */
export function Check({ checked, some = false, onChange, label, disabled = false }: { checked: boolean; some?: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      ref={(el) => {
        if (el) el.indeterminate = some && !checked;
      }}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 cursor-pointer accent-[var(--aw-brand)] disabled:cursor-default"
    />
  );
}

/** A small input or select for toolbars and table cells. */
/** A select that sits in a search bar, as tall as the search box next to it. */
export const BAR_FIELD = "h-12 border border-rule bg-white px-3.5 text-[15px] text-ink focus:border-brand focus:outline-none disabled:bg-surface-2 disabled:text-muted";
export const BAR_INPUT = "aw-input h-12! min-w-56 flex-1 py-0!";
export const BAR_BUTTON = "aw-btn aw-btn--accent h-12! py-0!";
export const FIELD = "border border-rule bg-white px-2.5 py-1.5 text-[13px] text-ink focus:border-brand focus:outline-none disabled:bg-surface-2 disabled:text-muted";

/** Opens Domain Research on a site or page. Set by the Research page, so any panel can offer "Analyze SEO". */
export const AnalyzeSeo = createContext<((target: string, scope: "domain" | "subdomain" | "subfolder" | "url") => void) | null>(null);
