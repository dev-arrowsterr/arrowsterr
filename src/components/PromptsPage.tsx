"use client";

import { Fragment, useState } from "react";
import { flatPrompts, type Brand, type Topic } from "@/lib/db";
import { promptRows } from "@/lib/metrics";
import { MAX_PROMPTS, MAX_TOPICS, PROMPTS_PER_TOPIC } from "@/lib/onboarding";
import type { View } from "@/lib/view";
import { BrandLogo } from "./BrandLogo";
import { ENGINE_LOGOS } from "./Engines";
import { BrandName, favicon, pct, pos, score, Seg } from "./ui";

/** Prompt performance in detail, and the editor for topics and prompts. */
export function PromptsPage({ view, readOnly, onChange, onRemove }: { view: View; readOnly: boolean; onChange: (b: Brand) => void; onRemove: () => void }) {
  const [tab, setTab] = useState<"results" | "edit">("results");
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="aw-h2">Prompts</h1>
        <div className="flex items-center gap-3">
          <span className="aw-tag">
            {view.brand.prompts.length} of {MAX_PROMPTS} prompts
          </span>
          {!readOnly ? (
            <Seg
              label="Prompts view"
              value={tab}
              onChange={setTab}
              options={[
                { id: "results", label: "Results" },
                { id: "edit", label: "Edit topics and prompts" },
              ]}
            />
          ) : null}
        </div>
      </div>
      {tab === "results" || readOnly ? <Results view={view} /> : <Editor brand={view.brand} onChange={onChange} onRemove={onRemove} />}
    </div>
  );
}

const ENGINE_SHORT: Record<string, string> = { ChatGPT: "ChatGPT", Claude: "Claude", Gemini: "Gemini", Perplexity: "Perplexity", "AI Overview": "AIO", "AI Mode": "AI Mode" };

function Results({ view }: { view: View }) {
  const { brand, current, filter, topics, engines } = view;
  const [open, setOpen] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const rows = promptRows(current, topics, engines, brand.name, filter);
  if (!topics.length) return <div className="aw-callout">No prompts yet. Open Edit topics and prompts to add some.</div>;

  return (
    <div className="flex flex-col gap-4">
      {topics.map((t) => {
        const list = rows.filter((r) => r.topic === t.name);
        const seen = list.filter((r) => r.visibility !== null);
        const vis = seen.length ? seen.reduce((n, r) => n + r.visibility!, 0) / seen.length : null;
        const isClosed = closed.has(t.name);
        return (
          <section key={t.name} className="aw-frame">
            <button
              type="button"
              onClick={() => setClosed((s) => (s.has(t.name) ? new Set([...s].filter((x) => x !== t.name)) : new Set([...s, t.name])))}
              className="flex w-full items-center justify-between gap-3 rounded-none border-b border-rule-faint px-5 py-3.5 text-left hover:bg-surface-2"
              aria-expanded={!isClosed}
            >
              <span className="text-[15px] font-medium text-ink">
                {t.name} <span className="font-normal text-muted">({t.prompts.length} prompts)</span>
              </span>
              <span className="flex items-center gap-3 text-[13px] text-muted">
                Visibility <b className="aw-num text-ink">{pct(vis)}</b>
                <span aria-hidden="true">{isClosed ? "▾" : "▴"}</span>
              </span>
            </button>
            {isClosed ? null : (
              <div className="overflow-x-auto">
                <table className="aw-table aw-table--compact">
                  <thead>
                    <tr>
                      <th>Prompt</th>
                      <th>Visibility</th>
                      <th>Position</th>
                      <th>Sentiment</th>
                      <th>Latest by model</th>
                      <th>Top brands</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <Fragment key={r.prompt}>
                        <tr className="cursor-pointer" onClick={() => setOpen(open === r.prompt ? null : r.prompt)} aria-expanded={open === r.prompt}>
                          <td className="min-w-64 text-ink">
                            <span className="mr-2 text-muted">{open === r.prompt ? "▾" : "▸"}</span>
                            {r.prompt}
                          </td>
                          <td className="aw-num">{pct(r.visibility)}</td>
                          <td className="aw-num">{pos(r.position)}</td>
                          <td className="aw-num">{score(r.sentiment)}</td>
                          <td>
                            <span className="flex flex-wrap gap-1">
                              {r.latest.map((c) => (
                                <span
                                  key={c.engine}
                                  title={`${c.engine}: ${c.status === "named" ? `named at #${c.position}` : c.status === "missed" ? "not named" : c.status === "error" ? "no answer" : "not checked"}`}
                                  className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium ${
                                    c.status === "named" ? "border-pos/30 bg-pos-bg text-pos" : c.status === "missed" ? "border-neg/20 bg-neg-bg text-neg" : "border-rule bg-surface-2 text-muted"
                                  }`}
                                >
                                  <BrandLogo src={ENGINE_LOGOS[c.engine] ?? ""} name={c.engine} size={12} />
                                  {c.status === "named" ? `#${c.position}` : c.status === "missed" ? "No" : "–"}
                                </span>
                              ))}
                            </span>
                          </td>
                          <td>
                            <span className="flex items-center gap-1">
                              {r.topBrands.slice(0, 4).map((b) => (
                                <span key={b.name} title={`${b.name}: named ${b.count} times`}>
                                  <BrandLogo src={b.isYou ? brand.logo : favicon(`${b.name.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`)} name={b.name} size={18} />
                                </span>
                              ))}
                            </span>
                          </td>
                        </tr>
                        {open === r.prompt ? (
                          <tr>
                            <td colSpan={6} className="bg-surface-2">
                              <div className="grid gap-5 py-2 md:grid-cols-3">
                                <div className="flex flex-col gap-2">
                                  <span className="aw-label mb-0">Latest by model</span>
                                  <ul className="flex flex-col gap-1.5">
                                    {r.latest.map((c) => (
                                      <li key={c.engine} className="flex items-center justify-between gap-3 text-[13px]">
                                        <span className="flex items-center gap-2">
                                          <BrandLogo src={ENGINE_LOGOS[c.engine] ?? ""} name={c.engine} size={14} />
                                          {ENGINE_SHORT[c.engine] ?? c.engine}
                                        </span>
                                        <span className={`aw-status ${c.status === "named" ? "aw-status--ranked" : c.status === "missed" ? "aw-status--missed" : "aw-status--pending"}`}>
                                          {c.status === "named" ? `Named #${c.position}` : c.status === "missed" ? "Not named" : c.status === "error" ? "No answer" : "Not checked"}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                  {r.latestAt ? <span className="aw-micro">Checked {new Date(r.latestAt).toLocaleString()}</span> : null}
                                </div>
                                <div className="flex flex-col gap-2">
                                  <span className="aw-label mb-0">Brands named ({r.answers} answers)</span>
                                  <ul className="flex flex-col gap-1.5">
                                    {r.topBrands.map((b) => (
                                      <li key={b.name} className="flex items-center justify-between gap-3 text-[13px]">
                                        <BrandName name={b.name} logo={b.isYou ? brand.logo : undefined} isYou={b.isYou} size={16} />
                                        <span className="aw-num text-muted">{pct((b.count / Math.max(r.answers, 1)) * 100)}</span>
                                      </li>
                                    ))}
                                    {!r.topBrands.length ? <li className="aw-small">No brands named yet.</li> : null}
                                  </ul>
                                </div>
                                <div className="flex flex-col gap-2">
                                  <span className="aw-label mb-0">Sites cited</span>
                                  <ul className="flex flex-col gap-1.5">
                                    {r.sources.map((s) => (
                                      <li key={s.domain} className="flex items-center justify-between gap-3 text-[13px]">
                                        <span className="flex min-w-0 items-center gap-2">
                                          <BrandLogo src={favicon(s.domain)} name={s.domain} size={16} />
                                          <span className="truncate">{s.domain}</span>
                                        </span>
                                        <span className="aw-num text-muted">{s.count}×</span>
                                      </li>
                                    ))}
                                    {!r.sources.length ? <li className="aw-small">No sites cited yet.</li> : null}
                                  </ul>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Rename, add and remove topics and prompts. Saves on every change. */
function Editor({ brand, onChange, onRemove }: { brand: Brand; onChange: (b: Brand) => void; onRemove: () => void }) {
  const topics: Topic[] = brand.topics.length ? brand.topics : brand.prompts.length ? [{ name: "Other prompts", prompts: brand.prompts }] : [];
  const [newTopic, setNewTopic] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const total = flatPrompts(topics).length;
  const save = (next: Topic[]) => onChange({ ...brand, topics: next, prompts: flatPrompts(next) });

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <label className="flex cursor-pointer items-start gap-3 rounded-aw border border-rule bg-white px-4 py-3 shadow-aw-sm">
        <input type="checkbox" checked={brand.daily} onChange={(e) => onChange({ ...brand, daily: e.target.checked })} className="mt-1 h-4 w-4 accent-[#0943B0]" />
        <span className="flex flex-col">
          <span className="text-[14px] font-medium text-ink">Run every day</span>
          <span className="aw-small">{brand.daily ? "On. The server checks every prompt on every model once a day." : "Off. Prompts only run when you click Run now."}</span>
        </span>
      </label>

      {topics.map((t, ti) => (
        <section key={`${ti}-${t.name}`} className="aw-frame">
          <div className="flex items-center gap-2 border-b border-rule-faint px-4 py-3">
            <input
              aria-label="Topic name"
              defaultValue={t.name}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== t.name) save(topics.map((x, i) => (i === ti ? { ...x, name: v } : x)));
              }}
              className="aw-input flex-1 py-2! font-medium"
            />
            <span className="aw-small whitespace-nowrap">{t.prompts.length} prompts</span>
            <button
              type="button"
              className="aw-btn aw-btn--secondary aw-btn--sm"
              onClick={() => {
                if (confirm(`Remove the topic "${t.name}" and its prompts?`)) save(topics.filter((_, i) => i !== ti));
              }}
            >
              Remove
            </button>
          </div>
          <ul className="flex flex-col gap-1.5 p-3">
            {t.prompts.map((p, pi) => (
              <li key={`${pi}-${p}`} className="flex items-center gap-2 rounded-aw bg-surface-2 px-2 py-1.5">
                <input
                  aria-label="Prompt"
                  defaultValue={p}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== p) save(topics.map((x, i) => (i === ti ? { ...x, prompts: x.prompts.map((y, j) => (j === pi ? v : y)) } : x)));
                  }}
                  className="min-w-0 flex-1 bg-transparent px-2 py-1 text-[14px] text-ink outline-none focus:bg-white"
                />
                <button
                  type="button"
                  aria-label={`Remove prompt: ${p}`}
                  className="px-2 text-[16px] text-muted hover:text-neg"
                  onClick={() => save(topics.map((x, i) => (i === ti ? { ...x, prompts: x.prompts.filter((_, j) => j !== pi) } : x)))}
                >
                  ×
                </button>
              </li>
            ))}
            <li className="flex gap-2 pt-1">
              <input
                value={drafts[ti] ?? ""}
                onChange={(e) => setDrafts({ ...drafts, [ti]: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const v = (drafts[ti] ?? "").trim();
                  if (!v || total >= MAX_PROMPTS) return;
                  save(topics.map((x, i) => (i === ti ? { ...x, prompts: [...x.prompts, v] } : x)));
                  setDrafts({ ...drafts, [ti]: "" });
                }}
                placeholder={total >= MAX_PROMPTS ? `You have used all ${MAX_PROMPTS} prompts` : "+ Add prompt and press Enter"}
                disabled={total >= MAX_PROMPTS}
                className="aw-input py-2!"
              />
            </li>
          </ul>
        </section>
      ))}

      <div className="flex gap-2">
        <input
          value={newTopic}
          onChange={(e) => setNewTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const v = newTopic.trim();
            if (!v || topics.length >= MAX_TOPICS) return;
            save([...topics, { name: v, prompts: [v] }]);
            setNewTopic("");
          }}
          placeholder={topics.length >= MAX_TOPICS ? `You can track up to ${MAX_TOPICS} topics` : "Add a topic, like: review management software"}
          disabled={topics.length >= MAX_TOPICS}
          className="aw-input"
        />
        <button
          type="button"
          className="aw-btn aw-btn--secondary"
          disabled={!newTopic.trim() || topics.length >= MAX_TOPICS || total >= MAX_PROMPTS}
          onClick={() => {
            save([...topics, { name: newTopic.trim(), prompts: [newTopic.trim()] }]);
            setNewTopic("");
          }}
        >
          Add topic
        </button>
      </div>
      <p className="aw-small">
        Up to {MAX_TOPICS} topics and {MAX_PROMPTS} prompts. A new topic starts with its own name as the first prompt. Aim for about {PROMPTS_PER_TOPIC} prompts per topic.
      </p>
      <button
        type="button"
        className="aw-text-link self-start text-neg!"
        onClick={() => {
          if (confirm(`Stop tracking ${brand.name}? Its results will be deleted.`)) onRemove();
        }}
      >
        Remove this brand
      </button>
    </div>
  );
}
