"use client";

import { useState } from "react";
import { ownMention, type Chat } from "@/lib/chats";
import { BrandLogo } from "./BrandLogo";
import { Markdown } from "./Markdown";

export const ENGINE_LOGOS: Record<string, string> = {
  ChatGPT: "https://arrowsterr.com/wp-content/uploads/2026/10/ChatGPT-Logo.jpg",
  Claude: "https://arrowsterr.com/wp-content/uploads/2026/10/Claude-Logo.webp",
  Gemini: "https://arrowsterr.com/wp-content/uploads/2026/10/Gemini-Logo.webp",
  Perplexity: "https://www.google.com/s2/favicons?domain=perplexity.ai&sz=128",
  "AI Overview": "https://www.google.com/s2/favicons?domain=google.com&sz=128",
  "AI Mode": "https://www.google.com/s2/favicons?domain=google.com&sz=128",
};

export function EngineName({ engine, size = 18 }: { engine: string; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <BrandLogo src={ENGINE_LOGOS[engine] ?? ""} name={engine} size={size} />
      {engine}
    </span>
  );
}

// Every status carries a word, so color is never the only signal.
export function ChatPill({ chat, brand }: { chat?: Chat; brand: string }) {
  if (!chat) return <span className="aw-status aw-status--pending">Waiting</span>;
  if (chat.error && !chat.text) return <span className="aw-status aw-status--warn">Error</span>;
  const own = ownMention(chat, brand);
  if (own) return <span className="aw-status aw-status--ranked">Mentioned #{own.position}</span>;
  return <span className="aw-status aw-status--missed">Not mentioned</span>;
}

/** One tab per engine. Click a tab to read that engine's answer. */
export function ChatTabs({ engines, find, brand }: { engines: string[]; find: (engine: string) => Chat | undefined; brand: string }) {
  const [tab, setTab] = useState(engines[0]);
  const c = find(tab);
  return (
    <div className="flex flex-col">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-rule">
        {engines.map((e) => (
          <button
            key={e}
            type="button"
            role="tab"
            aria-selected={tab === e}
            onClick={() => setTab(e)}
            className={`-mb-0.5 flex items-center gap-3 border border-b-0 px-4 py-2 text-[15px] font-medium ${
              tab === e ? "border-rule bg-surface text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            <EngineName engine={e} size={20} />
            <ChatPill chat={find(e)} brand={brand} />
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-5 border border-t-0 border-rule bg-white p-5">
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
