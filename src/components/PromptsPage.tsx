"use client";

import { useState } from "react";
import type { Brand } from "./App";

/** Manage the prompts a brand tracks. Results live on the Dashboard. */
export function PromptsPage({ brand, onChange, onRemove }: { brand: Brand; onChange: (b: Brand) => void; onRemove: () => void }) {
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
                  <button
                    type="button"
                    className="aw-btn aw-btn--secondary aw-btn--sm"
                    onClick={() => onChange({ ...brand, prompts: brand.prompts.filter((x) => x !== p) })}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {!brand.prompts.length ? (
              <tr>
                <td colSpan={2} className="aw-small">
                  No prompts yet. Add one above.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <TopicsSection brand={brand} onChange={onChange} />

      <button
        type="button"
        className="aw-text-link self-start"
        onClick={() => {
          if (confirm(`Stop tracking ${brand.name}?`)) onRemove();
        }}
      >
        Remove this brand
      </button>
    </div>
  );
}

/** Industry topics, and which ones this brand wants to be known for. */
function TopicsSection({ brand, onChange }: { brand: Brand; onChange: (b: Brand) => void }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const topics = brand.topics ?? [];
  const identity = new Set(brand.identity ?? []);

  async function suggest() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: brand.name, category: brand.category, prompts: brand.prompts }),
      });
      const data = await res.json().catch(() => ({ error: `The server returned ${res.status}.` }));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      onChange({ ...brand, topics: data.topics });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function add() {
    const t = draft.trim().toLowerCase();
    if (!t || topics.includes(t) || topics.length >= 8) return;
    onChange({ ...brand, topics: [...topics, t] });
    setDraft("");
  }

  function toggle(t: string) {
    const next = new Set(identity);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    onChange({ ...brand, identity: [...next] });
  }

  return (
    <section className="flex flex-col gap-4 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="aw-h3">Topics</h2>
        <span className="aw-tag">{topics.length} of 8</span>
      </div>
      <p className="aw-small">
        What buyers judge every brand in your industry on. Each run checks which topics AI links to you and your competitors. Tick the ones you
        want to be known for.
      </p>
      {!topics.length ? (
        <div>
          <button type="button" className="aw-btn aw-btn--primary" onClick={suggest} disabled={busy}>
            {busy ? "Suggesting..." : "Suggest topics"}
          </button>
        </div>
      ) : (
        <div className="aw-table-wrap">
          <table className="aw-table aw-table--compact">
            <thead>
              <tr>
                <th>Topic</th>
                <th>Want to be known for</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {topics.map((t) => (
                <tr key={t}>
                  <td>{t}</td>
                  <td>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={identity.has(t)} onChange={() => toggle(t)} className="h-4 w-4 accent-[#1E7A4D]" />
                      <span className="aw-small">{identity.has(t) ? "Yes" : "No"}</span>
                    </label>
                  </td>
                  <td className="w-24 text-right">
                    <button
                      type="button"
                      className="aw-btn aw-btn--secondary aw-btn--sm"
                      onClick={() =>
                        onChange({ ...brand, topics: topics.filter((x) => x !== t), identity: [...identity].filter((x) => x !== t) })
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error ? <p className="aw-error">{error}</p> : null}
      {topics.length && topics.length < 8 ? (
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
            placeholder="Add a topic, like: customer support"
            className="aw-input"
          />
          <button type="button" className="aw-btn aw-btn--secondary" onClick={add}>
            Add
          </button>
        </div>
      ) : null}
      <p className="aw-help mt-0!">Topic changes apply to your next run.</p>
    </section>
  );
}
