"use client";

import { useState } from "react";
import type { Brand } from "@/lib/db";

/** Manage the prompts a brand tracks. Results live on the Dashboard. */
export function PromptsPage({
  brand,
  readOnly = false,
  onChange,
  onRemove,
}: {
  brand: Brand;
  readOnly?: boolean;
  onChange: (b: Brand) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState("");
  function add() {
    const p = draft.trim();
    if (!p || brand.prompts.includes(p)) return;
    onChange({ ...brand, prompts: [...brand.prompts, p] });
    setDraft("");
  }
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="aw-h2 mb-0!">Prompts</h1>
        <span className="aw-tag">{brand.prompts.length} tracked</span>
      </div>
      {readOnly ? <p className="aw-small">You can view prompts. Editors and admins can change them.</p> : null}
      {readOnly ? null : (
      <div className="flex gap-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add a prompt, like: best review management tool for restaurants"
          className="aw-input"
        />
        <button type="button" className="aw-btn aw-btn--primary" onClick={add}>
          Add
        </button>
      </div>
      )}
      <div className="aw-table-wrap">
        <table className="aw-table aw-table--compact">
          <thead>
            <tr>
              <th>Tracked prompt</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {brand.prompts.map((p) => (
              <tr key={p}>
                <td>{p}</td>
                <td className="w-24 text-right">
                  {readOnly ? null : (
                  <button
                    type="button"
                    className="aw-btn aw-btn--secondary aw-btn--sm"
                    onClick={() => onChange({ ...brand, prompts: brand.prompts.filter((x) => x !== p) })}
                  >
                    Remove
                  </button>
                  )}
                </td>
              </tr>
            ))}
            {!brand.prompts.length ? (
              <tr>
                <td colSpan={2} className="aw-small">
                  {readOnly ? "No prompts yet." : "No prompts yet. Add one above."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {readOnly ? null : (
      <button
        type="button"
        className="aw-text-link self-start"
        onClick={() => {
          if (confirm(`Stop tracking ${brand.name}?`)) onRemove();
        }}
      >
        Remove this brand
      </button>
      )}
    </div>
  );
}
