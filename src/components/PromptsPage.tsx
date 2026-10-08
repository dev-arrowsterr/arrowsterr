"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { Fragment, useEffect, useRef, useState } from "react";
import type { Chat } from "@/lib/chats";
import { flatPrompts, latestAnswers, topicsOf, type Answer, type Brand, type Topic } from "@/lib/db";
import { answered, brandStats, promptDetail, promptRows, rankOf, stability, topicRows, trend, type EngineCell } from "@/lib/metrics";
import type { PromptsSnapshot } from "@/lib/reportTypes";
import type { RunAuth } from "@/lib/runner";
import { MAX_PROMPTS, MAX_TOPICS } from "@/lib/onboarding";
import type { View } from "@/lib/view";
import { BrandLogo } from "./BrandLogo";
import { ENGINE_LOGOS, EngineName } from "./Engines";
import { Markdown } from "./Markdown";
import { TrendChart } from "./TrendChart";
import { BrandName, Delta, Empty, favicon, OTHER_COLORS, pct, Seg, Tip, TIPS, YOU_COLOR } from "./ui";

type Props = {
  sb: SupabaseClient;
  auth: RunAuth;
  view: View;
  readOnly: boolean;
  focusTopic?: string | null;
  onChange: (b: Brand) => void;
  onRemove: () => void;
  onCompetitor: (name: string) => void;
};

/** The home page for AI visibility: your scores and every topic and prompt. Editors change topics and prompts in place. */
export function PromptsPage(p: Props) {
  const { view, readOnly } = p;
  const brand = view.brand;
  const all = topicsOf(brand);
  const [newTopic, setNewTopic] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const shown = view.engines;
  const total = flatPrompts(all).length;

  const save = (next: Topic[]) => p.onChange({ ...brand, topics: next, prompts: flatPrompts(next) });
  const edit: Editing | null = readOnly
    ? null
    : {
        full: total >= MAX_PROMPTS,
        renameTopic: (from, to) => save(all.map((t) => (t.name === from ? { ...t, name: to } : t))),
        removeTopic: (name) => confirm(`Remove the topic "${name}" and its prompts?`) && save(all.filter((t) => t.name !== name)),
        addPrompt: (topic, text) => total < MAX_PROMPTS && save(all.map((t) => (t.name === topic && !t.prompts.includes(text) ? { ...t, prompts: [...t.prompts, text] } : t))),
        editPrompt: (topic, from, to) => save(all.map((t) => (t.name === topic ? { ...t, prompts: t.prompts.map((x) => (x === from ? to : x)) } : t))),
        removePrompt: (topic, text) => confirm(`Remove this prompt?\n\n${text}`) && save(all.map((t) => (t.name === topic ? { ...t, prompts: t.prompts.filter((x) => x !== text) } : t))),
      };

  async function share() {
    setSharing(true);
    setError("");
    try {
      const res = await fetch("/api/reports/share", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await p.auth.token()}` },
        body: JSON.stringify({ workspaceId: p.auth.workspaceId, brandId: brand.id, data: promptsSnapshot(view, shown) }),
      });
      const out = await res.json().catch(() => ({ error: `The server returned ${res.status}.` }));
      if (!res.ok) throw new Error(out.error || `Error ${res.status}`);
      setLink(out.url);
      navigator.clipboard?.writeText(out.url).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="aw-h2">Prompts</h1>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <span className="aw-tag">
            {total} of {MAX_PROMPTS} prompts
          </span>
          {!readOnly ? (
            <button type="button" className={`aw-chip aw-chip--btn ${brand.daily ? "is-on" : ""}`} aria-pressed={brand.daily} onClick={() => p.onChange({ ...brand, daily: !brand.daily })} title="The server checks every prompt on every model once a day">
              Daily checks {brand.daily ? "on" : "off"}
            </button>
          ) : null}
          {!readOnly ? (
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={share} disabled={sharing}>
              {sharing ? "Creating link..." : "Share"}
            </button>
          ) : null}
          {!readOnly ? (
            <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={() => setNewTopic("")} disabled={all.length >= MAX_TOPICS}>
              + Add topic
            </button>
          ) : null}
        </div>
      </div>
      {error ? <p className="aw-error">{error}</p> : null}
      {link ? (
        <div className="aw-callout flex flex-wrap items-center justify-between gap-3">
          <span className="break-all">
            Link copied. Anyone with it can view this report and save it as a PDF:{" "}
            <a href={link} target="_blank" rel="noopener noreferrer">
              {link}
            </a>
          </span>
          <button type="button" className="aw-text-link" onClick={() => setLink("")}>
            Close
          </button>
        </div>
      ) : null}
      {newTopic !== null ? (
        <form
          className="aw-frame flex flex-wrap items-center gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const v = newTopic.trim();
            if (!v || all.some((t) => t.name === v) || total >= MAX_PROMPTS) return;
            save([...all, { name: v, prompts: [v] }]);
            setNewTopic(null);
          }}
        >
          <input autoFocus value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="Topic name, like: review management software" aria-label="Topic name" className="aw-input min-w-64 flex-1 py-2! text-[14px]!" />
          <button type="submit" className="aw-btn aw-btn--primary aw-btn--sm" disabled={!newTopic.trim()}>
            Add topic
          </button>
          <button type="button" className="aw-text-link text-[13px]" onClick={() => setNewTopic(null)}>
            Cancel
          </button>
          <span className="aw-small w-full">A new topic starts with its own name as the first prompt. Add more under it. Up to {MAX_TOPICS} topics and {MAX_PROMPTS} prompts.</span>
        </form>
      ) : null}
      <Scores view={view} />
      <Results sb={p.sb} view={view} engines={shown} edit={edit} focusTopic={p.focusTopic} onCompetitor={p.onCompetitor} />
      {!readOnly ? (
        <button
          type="button"
          className="aw-text-link self-start text-[13px] text-neg! print:hidden"
          onClick={() => {
            if (confirm(`Stop tracking ${brand.name}? Its results will be deleted.`)) p.onRemove();
          }}
        >
          Remove this brand
        </button>
      ) : null}
    </div>
  );
}

/** A frozen copy of this page for a share link. */
function promptsSnapshot(view: View, engines: string[]): PromptsSnapshot {
  const { brand, current, filter, topics } = view;
  const chats = answered(current, filter);
  const stats = brandStats(chats, { name: brand.name, domain: brand.domain });
  const me = stats.find((s) => s.isYou);
  const rank = rankOf(stats, "visibility");
  const rows = promptRows(current, topics, engines, brand.name, filter, brand.domain);
  return {
    kind: "prompts",
    brand: { name: brand.name, domain: brand.domain, logo: brand.logo },
    days: view.days,
    at: new Date().toISOString(),
    engines,
    scores: chats.length && me ? { visibility: me.visibility, sentiment: me.sentiment, position: me.position, rank: rank?.rank ?? null, of: rank?.of ?? null } : null,
    topics: topicRows(chats, topics, engines, brand.name).map((t) => ({
      name: t.topic,
      visibility: t.visibility,
      byEngine: t.byEngine,
      prompts: rows
        .filter((r) => r.topic === t.topic)
        .map((r) => ({ prompt: r.prompt, visibility: r.visibility, at: r.latestAt, ranks: Object.fromEntries(r.latest.map((c) => [c.engine, c.status === "named" ? c.position : null])) })),
    })),
  };
}

type Editing = {
  full: boolean;
  renameTopic: (from: string, to: string) => void;
  removeTopic: (name: string) => void;
  addPrompt: (topic: string, text: string) => void;
  editPrompt: (topic: string, from: string, to: string) => void;
  removePrompt: (topic: string, text: string) => void;
};

/** A pen and a bin that show when the row is hovered. */
function RowTools({ label, onEdit, onRemove }: { label: string; onEdit: () => void; onRemove: () => void }) {
  return (
    <span className="ml-1 inline-flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 print:hidden">
      <button
        type="button"
        aria-label={`Edit ${label}`}
        title="Edit"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        className="px-1.5 text-[14px] text-brand hover:text-ink"
      >
        ✎
      </button>
      <button
        type="button"
        aria-label={`Delete ${label}`}
        title="Delete"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="px-1.5 text-[16px] leading-none text-neg hover:text-ink"
      >
        ×
      </button>
    </span>
  );
}

/** Edit text in place. Enter or leaving saves. Escape cancels. */
function InlineInput({ start, label, onSave, onCancel }: { start: string; label: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(start);
  const done = () => {
    const t = v.trim().replace(/\s+/g, " ");
    if (t && t !== start) onSave(t);
    else onCancel();
  };
  return (
    <input
      autoFocus
      value={v}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === "Enter") done();
        if (e.key === "Escape") onCancel();
      }}
      className="aw-input min-w-0 flex-1 py-1! text-[14px]!"
    />
  );
}

/** Position as a 0 to 100 score: #1 is 100, and each spot down takes 10 points off. */
const positionScore = (n: number | null) => (n === null ? null : Math.max(0, 110 - n * 10));

/** Visibility, sentiment and position, with change and rank. */
function Scores({ view }: { view: View }) {
  const { brand, current, previous, filter, days } = view;
  const you = { name: brand.name, domain: brand.domain };
  const chats = answered(current, filter);
  if (!chats.length) return <Empty>No results in the last {days} days yet. They show up after the first check finishes, then update every day.</Empty>;
  const prev = answered(previous, filter);
  const stats = brandStats(chats, you);
  const before = brandStats(prev, you);
  const me = stats.find((s) => s.isYou)!;
  const meBefore = before.find((s) => s.isYou);
  const hadBefore = prev.length > 0;
  const change = hadBefore ? me.visibility - (meBefore?.visibility ?? 0) : null;
  const headline =
    change === null
      ? `${brand.name}'s visibility is ${pct(me.visibility)} in the last ${days} days`
      : `${brand.name}'s visibility is ${Math.abs(change) < 0.5 ? "steady" : `trending ${change > 0 ? "up" : "down"} by ${Math.abs(change).toFixed(1)} points`} vs the ${days} days before`;

  return (
    <section className="aw-frame">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3.5">
        <span className="text-[15px] text-ink">{headline}</span>
        <span className="aw-label">Scores out of 100</span>
      </div>
      <div className="grid sm:grid-cols-3">
        {(
          [
            { id: "visibility", lab: "Visibility", tip: TIPS.visibility, now: me.visibility, before: hadBefore ? (meBefore?.visibility ?? 0) : null, help: "Share of AI answers that name you" },
            { id: "sentiment", lab: "Sentiment", tip: TIPS.sentiment, now: me.sentiment, before: hadBefore ? (meBefore?.sentiment ?? null) : null, help: "How well AI talks about you" },
            { id: "position", lab: "Position", tip: TIPS.positionScore, now: positionScore(me.position), before: hadBefore ? positionScore(meBefore?.position ?? null) : null, help: me.position === null ? "Not named yet" : `Average spot #${me.position.toFixed(1)} in the list` },
          ] as const
        ).map((m, i) => {
          const r = rankOf(stats, m.id);
          const rb = hadBefore ? rankOf(before, m.id) : null;
          return (
            <div key={m.id} className={`flex flex-col gap-3 px-5 py-5 ${i ? "border-t border-rule sm:border-t-0 sm:border-l" : ""}`}>
              <span className="aw-label">
                {m.lab}
                <Tip text={m.tip} />
              </span>
              <span className="flex items-baseline gap-2">
                <span className="aw-num text-[38px] leading-none tracking-tight text-ink">{m.now === null ? "–" : Math.round(m.now)}</span>
                <span className="aw-num text-[14px] text-muted">/100</span>
                <Delta now={m.now} before={m.before} digits={0} />
              </span>
              <span className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
                {m.help}
                <span className="aw-num">
                  {r ? `Rank ${r.rank} of ${r.of}` : "Not ranked"}
                  {r && rb && r.rank !== rb.rank ? <span className={r.rank < rb.rank ? "text-pos" : "text-neg"}>{r.rank < rb.rank ? " ↑" : " ↓"}</span> : null}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
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

/** One model's latest answer to a prompt: your spot in the list when it named you, blank when it did not. */
function Cell({ c }: { c: EngineCell }) {
  if (c.status !== "named") return null;
  return (
    <span title={`${c.engine} named you at #${c.position}`} className="aw-status aw-status--ranked px-1.5! py-0.5! text-[12px]!">
      #{c.position}
    </span>
  );
}

function Results({
  sb,
  view,
  engines,
  edit,
  focusTopic,
  onCompetitor,
}: {
  sb: SupabaseClient;
  view: View;
  engines: string[];
  edit: Editing | null;
  focusTopic?: string | null;
  onCompetitor: (name: string) => void;
}) {
  const { brand, current, filter, topics } = view;
  const [editing, setEditing] = useState<string | null>(null); // "t:topic" or "p:topic\nprompt"
  const [drafts, setDrafts] = useState<Record<string, string>>({});
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
  if (!topics.length) return <div className="aw-callout">No prompts yet. Click Add topic to start.</div>;
  const flip = (set: Set<string>, k: string) => (set.has(k) ? new Set([...set].filter((x) => x !== k)) : new Set([...set, k]));
  const cols = engines.length + 3;

  return (
    <section className="aw-frame overflow-x-auto">
      <table className="aw-table aw-table--compact aw-table--tight min-w-[880px]">
        <thead>
          <tr>
            <th>Topic and prompt</th>
            <th className="w-24">
              Visibility
              <Tip text={TIPS.visibility} />
            </th>
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
              <tr ref={focusTopic === t.name ? focusRef : undefined} className={`group bg-surface-2 ${focusTopic === t.name ? "is-you" : ""}`}>
                <td>
                  <span className="flex flex-wrap items-center gap-2">
                    {edit && editing === `t:${t.name}` ? (
                      <InlineInput
                        start={t.name}
                        label="Topic name"
                        onSave={(v) => {
                          edit.renameTopic(t.name, v);
                          setEditing(null);
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
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
                    )}
                    {edit && editing !== `t:${t.name}` ? <RowTools label={`topic ${t.name}`} onEdit={() => setEditing(`t:${t.name}`)} onRemove={() => edit.removeTopic(t.name)} /> : null}
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
                    const key = `p:${t.name}\n${r.prompt}`;
                    return (
                      <Fragment key={r.prompt}>
                        <tr onClick={() => editing !== key && setOpen(isOpen ? null : r.prompt)} aria-expanded={isOpen} className={`group cursor-pointer ${isOpen ? "bg-paper" : ""}`}>
                          <td>
                            <span className="flex items-start gap-2 pl-5">
                              <span aria-hidden="true" className="text-muted">
                                {isOpen ? "▾" : "▸"}
                              </span>
                              {edit && editing === key ? (
                                <InlineInput
                                  start={r.prompt}
                                  label="Prompt"
                                  onSave={(v) => {
                                    edit.editPrompt(t.name, r.prompt, v);
                                    setEditing(null);
                                  }}
                                  onCancel={() => setEditing(null)}
                                />
                              ) : (
                                <span className="text-[14px] leading-snug text-ink">{r.prompt}</span>
                              )}
                              {edit && editing !== key ? <RowTools label="prompt" onEdit={() => setEditing(key)} onRemove={() => edit.removePrompt(t.name, r.prompt)} /> : null}
                            </span>
                          </td>
                          <td className="aw-num">{pct(r.visibility)}</td>
                          {r.latest.filter((c) => engines.includes(c.engine)).map((c) => (
                            <td key={c.engine}>
                              <Cell c={c} />
                            </td>
                          ))}
                          <td className="aw-small whitespace-nowrap">{ago(r.latestAt)}</td>
                        </tr>
                        {isOpen ? (
                          <tr>
                            <td colSpan={cols} className="p-0!">
                              <Detail sb={sb} view={view} prompt={r.prompt} topic={r.topic} onCompetitor={onCompetitor} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
              {edit && !isClosed ? (
                <tr className="print:hidden">
                  <td colSpan={cols} className="py-1.5!">
                    <input
                      value={drafts[t.name] ?? ""}
                      onChange={(e) => setDrafts({ ...drafts, [t.name]: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const v = (drafts[t.name] ?? "").trim().replace(/\s+/g, " ");
                        if (!v) return;
                        edit.addPrompt(t.name, v);
                        setDrafts({ ...drafts, [t.name]: "" });
                      }}
                      disabled={edit.full}
                      placeholder={edit.full ? `You have used all ${MAX_PROMPTS} prompts` : "+ Add prompt and press Enter"}
                      aria-label={`Add a prompt to ${t.name}`}
                      className="ml-5 w-[calc(100%-1.25rem)] max-w-xl border border-transparent bg-transparent px-2 py-1 text-[14px] text-ink placeholder:text-muted hover:border-rule focus:border-brand focus:bg-white focus:outline-none"
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          );
        })}
      </table>
      <p className="aw-small border-t border-rule-faint px-4 py-3">
        #N is your spot in the list of brands that answer named. Blank means it did not name you. Click a prompt to see the brands and sites in its answers.
      </p>
    </section>
  );
}

const level = (n: number) => (n >= 80 ? "High" : n >= 50 ? "Medium" : "Low");

/** One prompt, one model at a time: rank, how steady the answers are, the brands, the linked sites and the full answer. */
function Detail({ sb, view, prompt, topic, onCompetitor }: { sb: SupabaseClient; view: View; prompt: string; topic: string; onCompetitor: (name: string) => void }) {
  const { brand, current, engines, filter } = view;
  const d = promptDetail(current, prompt, engines, { name: brand.name, domain: brand.domain }, filter);
  const [tab, setTab] = useState(d.engines.find((e) => e.answered)?.engine ?? engines[0]);
  const [scope, setScope] = useState<"latest" | "all">("latest");
  const [allSites, setAllSites] = useState(false);
  const [texts, setTexts] = useState<Answer[] | null>(null);
  useEffect(() => {
    let live = true;
    latestAnswers(sb, brand.id, prompt).then((a) => live && setTexts(a));
    return () => {
      live = false;
    };
  }, [sb, brand.id, prompt]);

  const cur = d.engines.find((e) => e.engine === tab) ?? d.engines[0];
  const st = stability(current, prompt, cur.engine, brand.name, filter);
  const last = d.engines.map((e) => e.at).filter(Boolean).sort().pop() ?? null;
  const brands = scope === "latest" ? st.brands.filter((b) => b.latest !== null).sort((a, b) => a.latest! - b.latest!) : st.brands;
  const full = texts?.find((t) => t.engine === cur.engine) ?? null;
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div className="flex flex-col gap-5 border-t border-rule bg-paper p-5">
      <div className="flex flex-col gap-1">
        <span className="aw-micro">
          {topic} · {last ? `Checked ${new Date(last).toLocaleString()}` : "Not checked yet"}
        </span>
        <span className="text-[17px] font-medium text-ink">{prompt}</span>
      </div>

      {/* Rank on each model. Pick one to see its answer. */}
      <div className="grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-3 xl:grid-cols-6" role="tablist" aria-label="Model">
        {d.engines.map((e) => (
          <button
            key={e.engine}
            type="button"
            role="tab"
            aria-selected={tab === e.engine}
            onClick={() => setTab(e.engine)}
            className={`flex flex-col gap-2 p-3 text-left ${tab === e.engine ? "bg-brand-pale shadow-[inset_0_-2px_0_var(--aw-brand)]" : "bg-white hover:bg-surface-2"}`}
          >
            <EngineName engine={e.engine} size={14} />
            <span className="aw-num text-[24px] leading-none text-ink">{e.rank !== null ? `#${e.rank}` : "\u00a0"}</span>
            <span className="aw-small">{!e.answered ? "No answer" : e.sentiment !== null ? `Sentiment ${Math.round(e.sentiment)}` : "\u00a0"}</span>
          </button>
        ))}
      </div>

      {!cur.answered ? (
        <p className="aw-small">No answer from {cur.engine} for this prompt in this period.</p>
      ) : (
        <>
          <section className="aw-frame">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule-faint px-4 py-3">
              <span className="aw-label">Brand mention stability</span>
              <span className="aw-small">
                Based on {st.runs.length} {st.runs.length === 1 ? "check" : "checks"} on {cur.engine}
              </span>
            </div>
            <div className="grid gap-px bg-rule-faint sm:grid-cols-2 xl:grid-cols-4">
              {[
                { lab: "Mention rate", v: pct(st.mentionRate), sub: `${st.runs.filter((r) => r.named).length} of ${st.runs.length} checks`, help: "How often you show up at all." },
                { lab: "Your stability", v: `${Math.round(st.yourStability)}`, tag: level(st.yourStability), sub: `Changed ${st.flips} ${st.flips === 1 ? "time" : "times"}`, help: "100 means you were always in or always out." },
                { lab: "All brands stability", v: `${Math.round(st.allStability)}`, tag: level(st.allStability), sub: "Across all brands", help: "100 means the same brands showed up every check." },
                { lab: "New brand rate", v: st.newBrandRate.toFixed(st.newBrandRate % 1 ? 1 : 0), sub: "New brands per check", help: `${st.brandsSeen} brands seen, about ${Math.round(st.perAnswer)} per answer.` },
              ].map((m) => (
                <div key={m.lab} className="flex flex-col gap-1.5 bg-white p-4">
                  <span className="aw-label">{m.lab}</span>
                  <span className="flex items-baseline gap-2">
                    <span className="aw-num text-[28px] leading-none text-ink">{m.v}</span>
                    {m.tag ? <span className="aw-tag">{m.tag}</span> : null}
                  </span>
                  <span className="text-[13px] text-ink">{m.sub}</span>
                  <span className="aw-small">{m.help}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-rule-faint px-4 py-3">
              <span className="aw-label">Your checks</span>
              <span className="flex flex-wrap gap-1">
                {st.runs.map((r) => (
                  <span
                    key={r.at}
                    title={`${day(r.at)}: ${r.named ? `named at #${r.rank}` : "not named"}`}
                    className={`inline-block h-4 w-4 border ${r.named ? "border-brand bg-brand" : "border-rule bg-white"}`}
                  />
                ))}
              </span>
              {st.runs.length ? (
                <span className="aw-small">
                  {day(st.runs[0].at)} to {day(st.runs[st.runs.length - 1].at)}
                </span>
              ) : null}
              <span className="flex items-center gap-3 text-[12px] text-body">
                <span className="flex items-center gap-1.5">
                  <i className="inline-block h-3 w-3 border border-brand bg-brand" /> Named
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="inline-block h-3 w-3 border border-rule bg-white" /> Not named
                </span>
              </span>
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <section className="aw-frame self-start">
              <div className="flex items-center justify-between gap-3 border-b border-rule-faint px-4 py-2.5">
                <span className="aw-label">Brand mentions</span>
                <Seg
                  label="Checks"
                  value={scope}
                  onChange={setScope}
                  options={[
                    { id: "latest", label: "Latest check" },
                    { id: "all", label: "All checks" },
                  ]}
                />
              </div>
              <table className="aw-table aw-table--compact aw-table--tight">
                <thead>
                  <tr>
                    {scope === "latest" ? <th className="w-10">#</th> : null}
                    <th>Brand</th>
                    <th className="w-32">Track record</th>
                    <th className="w-20">Stability</th>
                  </tr>
                </thead>
                <tbody>
                  {brands.map((b) => (
                    <tr key={b.name} className={b.isYou ? "is-you" : "cursor-pointer"} onClick={() => !b.isYou && onCompetitor(b.name)}>
                      {scope === "latest" ? <td className="aw-num text-muted">{b.latest}</td> : null}
                      <td className="max-w-48">
                        <BrandName name={b.name} domain={b.isYou ? brand.domain : b.domain} logo={b.isYou ? brand.logo : undefined} isYou={b.isYou} size={16} />
                      </td>
                      <td className="aw-num whitespace-nowrap">
                        {pct(b.rate)} · {b.seen}/{st.runs.length}
                      </td>
                      <td className="aw-num">{Math.round(b.stability)}</td>
                    </tr>
                  ))}
                  {!brands.length ? (
                    <tr>
                      <td colSpan={4} className="aw-small">
                        No brands named.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </section>

            <section className="aw-frame self-start">
              <div className="flex items-center justify-between gap-3 border-b border-rule-faint px-4 py-3">
                <span className="aw-label">Linked sites</span>
                <span className="aw-small">Latest check</span>
              </div>
              <ol className="divide-y divide-rule-faint">
                {(allSites ? cur.sources : cur.sources.slice(0, 10)).map((x, i) => (
                  <li key={x.url} className={`flex gap-3 px-4 py-2.5 ${x.isYou ? "bg-brand-pale" : ""}`}>
                    <span className="aw-num w-7 shrink-0 text-[13px] text-muted">#{i + 1}</span>
                    <span className="flex min-w-0 flex-col">
                      <a href={x.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-[14px]" title={x.title ?? x.url}>
                        {x.title || shortUrl(x.url)}
                      </a>
                      <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
                        <BrandLogo src={favicon(x.domain)} name={x.domain} size={12} />
                        <span className="truncate">{shortUrl(x.url)}</span>
                        {x.isYou ? <span className="aw-tag shrink-0">You</span> : null}
                      </span>
                    </span>
                  </li>
                ))}
                {!cur.sources.length ? <li className="aw-small px-4 py-4">No sites linked.</li> : null}
              </ol>
              {cur.sources.length > 10 ? (
                <button type="button" className="aw-text-link px-4 py-2.5 text-[13px]" onClick={() => setAllSites(!allSites)}>
                  {allSites ? "Show top 10" : `Show all ${cur.sources.length} linked sites`}
                </button>
              ) : null}
            </section>
          </div>

          {cur.queries.length ? (
            <section className="aw-frame">
              <div className="border-b border-rule-faint px-4 py-3">
                <span className="aw-label">Search queries</span>
              </div>
              <ul className="flex flex-col gap-1.5 px-4 py-3 text-[14px] text-ink">
                {cur.queries.map((q) => (
                  <li key={q} className="flex gap-2">
                    <span aria-hidden="true" className="text-muted">
                      ⌕
                    </span>
                    {q}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="aw-frame">
            <div className="flex items-center justify-between gap-3 border-b border-rule-faint px-4 py-3">
              <span className="aw-label">Full answer</span>
              {full ? <span className="aw-small">{new Date(full.at).toLocaleString()}</span> : null}
            </div>
            <div className="max-h-[640px] overflow-y-auto px-5 py-4">
              {texts === null ? (
                <span className="aw-small">Loading...</span>
              ) : full ? (
                <Markdown text={full.text} />
              ) : (
                <span className="aw-small">Full answers are saved from the next daily check. Run supabase/012_answers.sql in Supabase first if you have not.</span>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
