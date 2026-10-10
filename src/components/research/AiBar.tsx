"use client";

import { useState } from "react";
import type { RunAuth } from "@/lib/runner";
import { describeOps, type SheetKind, type SheetOp } from "@/lib/sheetAi";
import { AiIcon } from "../ui";
import { post } from "./shared";

/** Tell the AI what to do with the sheet. It shows the changes first. Click Apply to make them. */
export function AiBar({
  kind,
  auth,
  domain,
  rows,
  columns = [],
  tips,
  label,
  columnName = (k) => k,
  onApply,
}: {
  kind: SheetKind;
  auth: RunAuth;
  domain: string;
  rows: Record<string, unknown>[];
  columns?: { id: string; name: string }[];
  tips: string[];
  label: (id: string) => string;
  columnName?: (k: string) => string;
  onApply: (ops: SheetOp[]) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ reply: string; ops: SheetOp[] } | null>(null);
  const [done, setDone] = useState("");

  async function ask(instruction: string) {
    if (!instruction.trim()) return;
    setText(instruction);
    setBusy("ask");
    setError("");
    setDone("");
    setResult(null);
    try {
      setResult(await post<{ reply: string; ops: SheetOp[] }>(auth, "/api/sheet/ai", { kind, instruction, domain, rows, columns, today: new Date().toISOString().slice(0, 10) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function apply() {
    if (!result) return;
    setBusy("apply");
    setError("");
    try {
      await onApply(result.ops);
      setDone(`Done. ${result.ops.length} ${result.ops.length === 1 ? "change" : "changes"} made.`);
      setResult(null);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="aw-frame flex flex-col gap-3 p-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={kind === "plan" ? "Tell the AI what to do, like: approve every BOFU page with volume over 100" : "Tell the AI what to do, like: schedule all undated pages, 2 a week from Monday"}
          aria-label="Tell the AI what to do"
          className="aw-input min-w-64 flex-1 py-2! text-[14px]!"
        />
        <button type="submit" className="aw-btn aw-btn--accent aw-btn--sm" disabled={Boolean(busy) || !text.trim()}>
          <AiIcon />
          {busy === "ask" ? "Thinking..." : "Ask AI"}
        </button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <span className="aw-label">Try</span>
        {tips.map((t) => (
          <button key={t} type="button" className="aw-chip aw-chip--btn" onClick={() => ask(t)} disabled={Boolean(busy)}>
            {t}
          </button>
        ))}
      </div>
      {error ? <p className="aw-error">{error}</p> : null}
      {done ? <p className="text-[13px] text-pos">{done}</p> : null}
      {result ? (
        <div className="flex flex-col gap-3 border border-rule bg-surface-2 p-3">
          {result.reply ? <p className="text-[14px] text-ink">{result.reply}</p> : null}
          {result.ops.length ? (
            <>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-body">
                {describeOps(result.ops, label, columnName).slice(0, 12).map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
                {result.ops.length > 12 ? <li>and {result.ops.length - 12} more changes</li> : null}
              </ul>
              <span className="flex gap-2">
                <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={apply} disabled={Boolean(busy)}>
                  {busy === "apply" ? "Applying..." : "Apply"}
                </button>
                <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setResult(null)}>
                  Cancel
                </button>
              </span>
            </>
          ) : (
            <p className="aw-small">No changes to make.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
