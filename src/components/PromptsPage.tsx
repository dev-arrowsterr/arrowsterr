"use client";

import { Fragment, useEffect, useState } from "react";
import { loadRun, ownMention, saveRun, type Chat, type Run } from "@/lib/chats";
import type { Brand } from "./App";
import { BrandLogo } from "./BrandLogo";
import { Markdown } from "./Markdown";

// Few calls at once keeps the small Render server from running out of memory.
const CONCURRENCY = 3;

const ENGINE_LOGOS: Record<string, string> = {
  ChatGPT: "https://arrowsterr.com/wp-content/uploads/2026/10/ChatGPT-Logo.jpg",
  Claude: "https://arrowsterr.com/wp-content/uploads/2026/10/Claude-Logo.webp",
  Gemini: "https://arrowsterr.com/wp-content/uploads/2026/10/Gemini-Logo.webp",
  Perplexity: "https://www.google.com/s2/favicons?domain=perplexity.ai&sz=128",
};

function EngineName({ engine, size = 18 }: { engine: string; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <BrandLogo src={ENGINE_LOGOS[engine] ?? ""} name={engine} size={size} />
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

async function askOne(engine: string, prompt: string, brand: Brand, attempt = 0): Promise<Chat> {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine, prompt, brand: brand.name, domain: brand.domain }),
    });
    const data = await res.json().catch(() => null);
    if (data === null) {
      // Render answered for us, which means the server restarted or was busy. Try once more.
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 5000));
        return askOne(engine, prompt, brand, 1);
      }
      return { engine, prompt, text: "", sources: [], brands: [], error: `The server returned ${res.status}. Check Render Logs for a crash or out of memory message.` };
    }
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
              {run
                ? cols.map((e) => (
                    <th key={e}>
                      <EngineName engine={e} />
                    </th>
                  ))
                : null}
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
                      <ChatTabs engines={cols} find={(e) => find(p, e)} brand={brand.name} />
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

/** One tab per engine. Click a tab to read that engine's answer. */
function ChatTabs({ engines, find, brand }: { engines: string[]; find: (engine: string) => Chat | undefined; brand: string }) {
  const [tab, setTab] = useState(engines[0]);
  const c = find(tab);
  return (
    <div className="flex flex-col py-2">
      <div role="tablist" className="flex flex-wrap gap-1 border-b-2 border-line">
        {engines.map((e) => (
          <button
            key={e}
            type="button"
            role="tab"
            aria-selected={tab === e}
            onClick={() => setTab(e)}
            className={`-mb-0.5 flex items-center gap-3 rounded-t-aw border-2 border-b-0 px-4 py-2 text-[15px] font-medium ${
              tab === e ? "border-line bg-white text-ink" : "border-transparent text-g600 hover:text-brand"
            }`}
          >
            <EngineName engine={e} size={20} />
            <ChatPill chat={find(e)} brand={brand} />
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-5 border-2 border-t-0 border-line bg-white p-5">
        {!c ? (
          <p className="aw-small">Waiting for {tab}...</p>
        ) : (
          <>
            {c.error ? <p className="aw-error">{c.error}</p> : null}
            {c.brands.length ? (
              <div className="flex flex-col gap-2">
                <span className="aw-label mb-0!">Brands in this answer (position · sentiment)</span>
                <div className="flex flex-wrap gap-2">
                  {c.brands.map((b) => (
                    <span key={b.name} className={`aw-pill ${b.name.toLowerCase() === brand.toLowerCase() ? "is-on" : ""}`}>
                      #{b.position} {b.name} · {b.sentiment}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {c.text ? <Markdown text={c.text} /> : null}
            {c.sources.length ? (
              <div className="flex flex-col gap-2">
                <span className="aw-label mb-0!">Sources</span>
                <ul className="aw-list aw-list--tight aw-list--dots">
                  {c.sources.map((s) => (
                    <li key={s.url} className="text-[14px]! break-all">
                      <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">
                        {s.title || s.domain}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
