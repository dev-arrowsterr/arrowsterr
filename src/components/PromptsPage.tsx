"use client";

import { Fragment, useEffect, useState } from "react";
import { loadRun, ownMention, saveRun, type Chat, type Run } from "@/lib/chats";
import type { Brand } from "./App";
import { BrandLogo } from "./BrandLogo";
import { Markdown } from "./Markdown";

const CONCURRENCY = 6;
const ENGINE_COLORS: Record<string, string> = {
  ChatGPT: "var(--aw-e-chatgpt)",
  Claude: "var(--aw-e-claude)",
  Gemini: "var(--aw-e-gemini)",
  Perplexity: "var(--aw-e-perplexity)",
};

function EngineChip({ engine }: { engine: string }) {
  return (
    <span className="aw-engine">
      <i style={{ background: ENGINE_COLORS[engine] ?? "var(--aw-g500)" }} />
      {engine}
    </span>
  );
}

// Every status carries a word, so color is never the only signal.
function ChatPill({ chat, brand }: { chat?: Chat; brand: string }) {
  if (!chat) return <span className="aw-status aw-status--pending">Waiting</span>;
  if (chat.error && !chat.text) return <span className="aw-status aw-status--warn">Error</span>;
  const own = ownMention(chat, brand);
  if (own) return <span className="aw-status aw-status--ranked">Mentioned #{own.position}</span>;
  return <span className="aw-status aw-status--missed">Not mentioned</span>;
}

async function askOne(engine: string, prompt: string, brand: Brand): Promise<Chat> {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine, prompt, brand: brand.name, domain: brand.domain }),
    });
    const data = await res.json().catch(() => ({ error: `The server returned ${res.status}.` }));
    return {
      engine,
      prompt,
      text: data.text ?? "",
      sources: data.sources ?? [],
      brands: data.brands ?? [],
      error: data.error ?? (res.ok ? null : `Error ${res.status}`),
    };
  } catch (e) {
    return { engine, prompt, text: "", sources: [], brands: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export function PromptsPage({ brand, onChange, onRemove }: { brand: Brand; onChange: (b: Brand) => void; onRemove: () => void }) {
  const [engines, setEngines] = useState<string[] | null>(null);
  const [run, setRun] = useState<Run | null>(() => loadRun(brand.id));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    fetch("/api/engines")
      .then((r) => r.json())
      .then((d) => setEngines(d.engines ?? []))
      .catch(() => setEngines([]));
  }, []);

  async function runNow() {
    if (!engines?.length) return;
    const jobs = engines.flatMap((engine) => brand.prompts.map((prompt) => ({ engine, prompt })));
    const fresh: Run = { at: new Date().toISOString(), engines, chats: [] };
    setRun(fresh);
    setRunning(true);
    setProgress({ done: 0, total: jobs.length });
    let next = 0;
    const chats: Chat[] = [];
    const worker = async () => {
      while (next < jobs.length) {
        const { engine, prompt } = jobs[next++];
        const chat = await askOne(engine, prompt, brand);
        chats.push(chat);
        setRun({ ...fresh, chats: [...chats] });
        setProgress({ done: chats.length, total: jobs.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
    saveRun(brand.id, { ...fresh, chats });
    setRunning(false);
  }

  function add() {
    const p = draft.trim();
    if (!p || brand.prompts.includes(p)) return;
    onChange({ ...brand, prompts: [...brand.prompts, p] });
    setDraft("");
  }

  const cols = run?.engines ?? engines ?? [];
  const find = (prompt: string, engine: string) => run?.chats.find((c) => c.prompt === prompt && c.engine === engine);
  const answered = run?.chats.filter((c) => c.text) ?? [];
  const mentioned = answered.filter((c) => ownMention(c, brand.name));
  const firstError = run?.chats.find((c) => c.error)?.error;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="aw-h2 mb-0!">Prompts</h1>
        <div className="flex items-center gap-3">
          {run && !running ? <span className="aw-small">Last run {new Date(run.at).toLocaleString()}</span> : null}
          <button type="button" className="aw-btn aw-btn--primary" onClick={runNow} disabled={running || !engines?.length || !brand.prompts.length}>
            {running ? "Running..." : "Run now"}
          </button>
        </div>
      </div>

      {engines && !engines.length ? (
        <p className="aw-error">No engine keys are set on Render. Add at least one of OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY or PERPLEXITY_API_KEY.</p>
      ) : null}

      {running ? (
        <div className="flex flex-col gap-2">
          <div className="aw-progress">
            <div className="aw-progress__fill" style={{ width: `${Math.max(3, (progress.done / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
          <span className="aw-small aw-num">
            {progress.done} of {progress.total} chats in. Keep this tab open.
          </span>
        </div>
      ) : null}

      {answered.length ? (
        <div className="aw-card-stat self-start">
          <span className="aw-stat__num">{Math.round((mentioned.length / answered.length) * 100)}%</span>
          <div className="aw-stat__lab">
            {brand.name} was mentioned in {mentioned.length} of {answered.length} chats
          </div>
        </div>
      ) : null}

      {firstError ? <p className="aw-error">First error: {firstError}</p> : null}

      <div className="aw-table-wrap table-scroll">
        <table className="aw-table aw-table--compact">
          <thead>
            <tr>
              <th>Prompt</th>
              {run ? cols.map((e) => <th key={e}>{e}</th>) : null}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {brand.prompts.map((p) => (
              <Fragment key={p}>
                <tr className={run ? "cursor-pointer" : undefined} onClick={() => run && setOpen(open === p ? null : p)}>
                  <td className="min-w-64">
                    {run ? <span className="mr-2 text-g500">{open === p ? "▾" : "▸"}</span> : null}
                    {p}
                  </td>
                  {run ? cols.map((e) => <td key={e}>{running || find(p, e) ? <ChatPill chat={find(p, e)} brand={brand.name} /> : "–"}</td>) : null}
                  <td className="w-24 text-right">
                    <button
                      type="button"
                      className="aw-btn aw-btn--secondary aw-btn--sm"
                      disabled={running}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onChange({ ...brand, prompts: brand.prompts.filter((x) => x !== p) });
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
                {open === p && run ? (
                  <tr>
                    <td colSpan={cols.length + 2} className="bg-paper!">
                      <div className="aw-grid-2 py-2">
                        {cols.map((e) => {
                          const c = find(p, e);
                          if (!c) return null;
                          return (
                            <div key={e} className="aw-frame min-w-0">
                              <div className="aw-frame__head justify-between">
                                <EngineChip engine={e} />
                                <ChatPill chat={c} brand={brand.name} />
                              </div>
                              <div className="aw-frame__body flex flex-col gap-4">
                                {c.error ? <p className="aw-error">{c.error}</p> : null}
                                {c.brands.length ? (
                                  <div className="flex flex-wrap gap-2">
                                    {c.brands.map((b) => (
                                      <span
                                        key={b.name}
                                        className={`aw-pill ${b.name.toLowerCase() === brand.name.toLowerCase() ? "is-on" : ""}`}
                                        title={`Sentiment ${b.sentiment}`}
                                      >
                                        #{b.position} {b.name} · {b.sentiment}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                                {c.text ? <Markdown text={c.text} /> : null}
                                {c.sources.length ? (
                                  <p className="aw-small break-words">
                                    <strong>Sources:</strong> {[...new Set(c.sources.map((s) => s.domain))].join(", ")}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex max-w-3xl gap-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add a prompt"
          className="aw-input"
        />
        <button type="button" className="aw-btn aw-btn--secondary" onClick={add}>
          Add
        </button>
      </div>

      <div className="flex items-center gap-3">
        <BrandLogo src={brand.logo} name={brand.name} size={20} />
        <button
          type="button"
          className="aw-text-link"
          onClick={() => {
            if (confirm(`Stop tracking ${brand.name}?`)) onRemove();
          }}
        >
          Remove this brand
        </button>
      </div>
    </div>
  );
}
