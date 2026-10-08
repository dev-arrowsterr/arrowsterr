"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type { Chat } from "@/lib/chats";
import { flatPrompts, type Brand, type Topic } from "@/lib/db";
import { answered, brandStats, promptRows, topicRows, trend, type EngineCell, type PromptRow } from "@/lib/metrics";
import { MAX_PROMPTS, MAX_TOPICS, PROMPTS_PER_TOPIC } from "@/lib/onboarding";
import type { View } from "@/lib/view";
import { BrandLogo } from "./BrandLogo";
import { ENGINE_LOGOS } from "./Engines";
import { TrendChart } from "./TrendChart";
import { BrandName, favicon, OTHER_COLORS, pct, pos, score, Seg, YOU_COLOR } from "./ui";

/** Prompt performance in detail, and the editor for topics and prompts. */
export function PromptsPage({
  view,
  readOnly,
  onChange,
  onRemove,
  onCompetitor,
  focusTopic,
}: {
  view: View;
  focusTopic?: string | null;
  readOnly: boolean;
  onChange: (b: Brand) => void;
  onRemove: () => void;
  onCompetitor: (name: string) => void;
}) {
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
      {tab === "results" || readOnly ? <Results view={view} focusTopic={focusTopic} onCompetitor={onCompetitor} /> : <Editor brand={view.brand} onChange={onChange} onRemove={onRemove} />}
    </div>
  );
}

const ENGINE_SHORT: Record<string, string> = { ChatGPT: "ChatGPT", Claude: "Claude", Gemini: "Gemini", Perplexity: "Perplexity", "AI Overview": "AIO", "AI Mode": "AI Mode" };
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
const ago = (iso: string | null) => {
  if (!iso) return "–";
  const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
  return d <= 0 ? "Today" : d === 1 ? "Yesterday" : `${d} days ago`;
};

/** A share with a thin bar under it. */
function Share({ v }: { v: number | null }) {
  return (
    <span className="flex flex-col gap-1">
      <span className="aw-num text-[14px] text-ink">{pct(v)}</span>
      <span className="block h-1 w-14 bg-rule-faint">
        <span className="block h-full bg-brand" style={{ width: `${v ?? 0}%` }} />
      </span>
    </span>
  );
}

/** One model's latest answer to a prompt: named or not, and where your site was cited. */
function Cell({ c }: { c: EngineCell }) {
  if (c.status === "none") return <span className="text-muted">–</span>;
  if (c.status === "error") return <span className="aw-small">No answer</span>;
  return (
    <span className="flex flex-col items-start gap-1">
      <span
        title={c.status === "named" ? `${c.engine} named you at #${c.position}` : `${c.engine} did not name you`}
        className={`aw-status ${c.status === "named" ? "aw-status--ranked" : "aw-status--missed"} px-1.5! py-0.5! text-[11px]!`}
      >
        {c.status === "named" ? `Brand #${c.position}` : "Missing"}
      </span>
      {c.cited ? (
        <a
          href={c.cited.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={(e) => e.stopPropagation()}
          title={`Your page is source #${c.cited.rank}: ${shortUrl(c.cited.url)}`}
          className="aw-status aw-status--pending px-1.5! py-0.5! text-[11px]! no-underline"
        >
          Cited #{c.cited.rank} ↗
        </a>
      ) : null}
    </span>
  );
}

function Results({ view, focusTopic, onCompetitor }: { view: View; focusTopic?: string | null; onCompetitor: (name: string) => void }) {
  const { brand, current, filter, topics, engines } = view;
  const [open, setOpen] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [charts, setCharts] = useState<Set<string>>(new Set());
  const focusRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  const chats = answered(current, filter);
  const rows = promptRows(current, topics, engines, brand.name, filter, brand.domain);
  const tops = topicRows(chats, topics, engines, brand.name);
  if (!topics.length) return <div className="aw-callout">No prompts yet. Open Edit topics and prompts to add some.</div>;
  const flip = (set: Set<string>, k: string) => (set.has(k) ? new Set([...set].filter((x) => x !== k)) : new Set([...set, k]));
  const cols = engines.length + 3;

  return (
    <section className="aw-frame overflow-x-auto">
      <table className="aw-table aw-table--compact aw-table--tight min-w-[880px]">
        <thead>
          <tr>
            <th>Topic and prompt</th>
            <th className="w-24">Visibility</th>
            {engines.map((e) => (
              <th key={e} className="w-28">
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <BrandLogo src={ENGINE_LOGOS[e] ?? ""} name={e} size={14} />
                  {ENGINE_SHORT[e] ?? e}
                </span>
              </th>
            ))}
            <th className="w-28">Last checked</th>
          </tr>
        </thead>
        {topics.map((t) => {
          const top = tops.find((x) => x.topic === t.name)!;
          const list = rows.filter((r) => r.topic === t.name);
          const isClosed = closed.has(t.name);
          const last = list.map((r) => r.latestAt).filter(Boolean).sort().pop() ?? null;
          const showChart = charts.has(t.name);
          const inTopic = (c: Chat) => filter(c) && t.prompts.includes(c.prompt);
          const leaders = showChart
            ? brandStats(answered(current, inTopic), { name: brand.name, domain: brand.domain })
                .filter((s) => !s.isYou)
                .slice(0, 3)
                .map((s) => s.name)
            : [];
          const lines = [brand.name, ...leaders].map((n, i) => ({ name: n, isYou: i === 0, color: i === 0 ? YOU_COLOR : OTHER_COLORS[i - 1] }));
          return (
            <tbody key={t.name}>
              <tr ref={focusTopic === t.name ? focusRef : undefined} className={`bg-surface-2 ${focusTopic === t.name ? "is-you" : ""}`}>
                <td>
                  <span className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setClosed((s) => flip(s, t.name))}
                      aria-expanded={!isClosed}
                      className="flex items-center gap-2 text-left text-[15px] font-medium text-ink"
                    >
                      <span aria-hidden="true" className="text-muted">
                        {isClosed ? "▸" : "▾"}
                      </span>
                      {t.name}
                      <span className="font-normal text-muted">· {t.prompts.length} prompts</span>
                    </button>
                    <button type="button" className={`aw-chip aw-chip--btn ${showChart ? "is-on" : ""}`} onClick={() => setCharts((s) => flip(s, t.name))} aria-pressed={showChart}>
                      {showChart ? "Hide trend" : "Show trend"}
                    </button>
                  </span>
                </td>
                <td>
                  <Share v={top.visibility} />
                </td>
                {engines.map((e) => (
                  <td key={e}>
                    <Share v={top.byEngine[e]} />
                  </td>
                ))}
                <td className="aw-small whitespace-nowrap">{ago(last)}</td>
              </tr>
              {showChart ? (
                <tr>
                  <td colSpan={cols} className="bg-white">
                    <TrendChart points={trend(current, lines.map((l) => l.name), "visibility", inTopic)} lines={lines} metric="visibility" mode="line" />
                    <ul className="flex flex-wrap gap-x-5 gap-y-1 px-2 pb-2">
                      {lines.map((l) => (
                        <li key={l.name} className="flex items-center gap-2 text-[13px] text-body">
                          <i className="inline-block h-2.5 w-2.5" style={{ background: l.color }} />
                          {l.isYou ? `${l.name} (you)` : l.name}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ) : null}
              {isClosed
                ? null
                : list.map((r) => {
                    const isOpen = open === r.prompt;
                    return (
                      <Fragment key={r.prompt}>
                        <tr onClick={() => setOpen(isOpen ? null : r.prompt)} aria-expanded={isOpen} className={`cursor-pointer ${isOpen ? "bg-paper" : ""}`}>
                          <td>
                            <span className="flex items-start gap-2 pl-5">
                              <span aria-hidden="true" className="text-muted">
                                {isOpen ? "▾" : "▸"}
                              </span>
                              <span className="text-[14px] leading-snug text-ink">{r.prompt}</span>
                            </span>
                          </td>
                          <td className="aw-num">{pct(r.visibility)}</td>
                          {r.latest.map((c) => (
                            <td key={c.engine}>
                              <Cell c={c} />
                            </td>
                          ))}
                          <td className="aw-small whitespace-nowrap">{ago(r.latestAt)}</td>
                        </tr>
                        {isOpen ? (
                          <tr>
                            <td colSpan={cols} className="p-0!">
                              <Detail r={r} logo={brand.logo} onCompetitor={onCompetitor} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
            </tbody>
          );
        })}
      </table>
      <p className="aw-small border-t border-rule-faint px-4 py-3">
        Brand #N means the answer named you at that spot. Cited #N means your site was source number N. Click a prompt to see the brands and sites in its answers.
      </p>
    </section>
  );
}

/** Everything about one prompt: position and sentiment, brands named and sites cited. */
function Detail({ r, logo, onCompetitor }: { r: PromptRow; logo?: string; onCompetitor: (name: string) => void }) {
  return (
    <div className="grid gap-px border-t border-rule bg-rule lg:grid-cols-[0.8fr_1fr_1.4fr]">
      <div className="flex flex-col gap-4 bg-white p-5">
        <span className="aw-label">Your results · {r.answers} answers</span>
        <ul className="flex flex-col gap-3 text-[14px]">
          {[
            { lab: "Visibility", v: pct(r.visibility) },
            { lab: "Average position", v: pos(r.position) },
            { lab: "Sentiment", v: score(r.sentiment) },
          ].map((m) => (
            <li key={m.lab} className="flex items-center justify-between gap-3">
              <span className="text-body">{m.lab}</span>
              <span className="aw-num text-ink">{m.v}</span>
            </li>
          ))}
        </ul>
        {r.latestAt ? <span className="aw-label">Checked {new Date(r.latestAt).toLocaleString()}</span> : null}
      </div>
      <div className="flex flex-col gap-4 bg-white p-5">
        <span className="aw-label">Brands named</span>
        <ul className="flex flex-col gap-1">
          {r.topBrands.map((b) => (
            <li key={b.name}>
              <button
                type="button"
                onClick={() => !b.isYou && onCompetitor(b.name)}
                disabled={b.isYou}
                title={b.isYou ? undefined : `Open ${b.name} on the Competitors page`}
                className="flex w-full items-center justify-between gap-3 px-2 py-1.5 text-left text-[14px] hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent"
              >
                <BrandName name={b.name} domain={b.domain} logo={b.isYou ? logo : undefined} isYou={b.isYou} size={18} />
                <span className="aw-num text-muted">{pct((b.count / Math.max(r.answers, 1)) * 100)}</span>
              </button>
            </li>
          ))}
          {!r.topBrands.length ? <li className="aw-small">No brands named yet.</li> : null}
        </ul>
      </div>
      <div className="flex flex-col gap-4 bg-white p-5">
        <span className="aw-label">Sites cited</span>
        <ul className="flex flex-col gap-3">
          {r.sources.map((s) => (
            <li key={s.domain} className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-3 text-[14px]">
                <span className="flex min-w-0 items-center gap-2 text-ink">
                  <BrandLogo src={favicon(s.domain)} name={s.domain} size={16} />
                  <span className="truncate">{s.domain}</span>
                </span>
                <span className="aw-num text-muted">{s.count}×</span>
              </span>
              <ul className="flex flex-col gap-0.5 pl-6">
                {s.urls.slice(0, 3).map((u) => (
                  <li key={u.url} className="min-w-0 text-[13px]">
                    <a href={u.url} target="_blank" rel="noopener noreferrer nofollow" className="block truncate" title={u.url}>
                      {u.title || shortUrl(u.url)} ↗
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {!r.sources.length ? <li className="aw-small">No sites cited yet.</li> : null}
        </ul>
      </div>
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
          <span className="text-[14px] font-medium text-ink">Check every day</span>
          <span className="aw-small">{brand.daily ? "On. The server checks every prompt on every model once a day." : "Off. This brand is paused and is not checked."}</span>
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
