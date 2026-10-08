"use client";

import { useState } from "react";
import { isAnswered, type Run } from "@/lib/chats";
import type { Brand } from "@/lib/db";
import { competitorCards, type CompetitorCard } from "@/lib/stats";
import { BrandLogo } from "./BrandLogo";
import { EngineName } from "./Engines";

const YOU_COLOR = "#0943B0";
const OTHER_COLOR = "#767570";
const favicon = (domain: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
const when = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** A small ring filled to a percent. The number always shows next to it. */
function Ring({ value, color, size = 44 }: { value: number | null; color: string; size?: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  const len = ((value ?? 0) / 100) * c;
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" className="shrink-0">
      <circle cx={20} cy={20} r={r} fill="none" stroke="var(--aw-skel)" strokeWidth={6} />
      {len > 0 ? (
        <circle cx={20} cy={20} r={r} fill="none" stroke={color} strokeWidth={6} strokeDasharray={`${len} ${c - len}`} transform="rotate(-90 20 20)" />
      ) : null}
    </svg>
  );
}

function Change({ now, before }: { now: number | null; before: number | null }) {
  if (now === null || before === null) return null;
  const d = Math.round(now - before);
  if (!d) return null;
  return (
    <span className={`whitespace-nowrap text-[12px] font-medium ${d > 0 ? "text-pos" : "text-neg"}`}>
      {d > 0 ? "▲" : "▼"} {Math.abs(d)} pts
    </span>
  );
}

function CardRow({ card, brand, engines, total, updated, next }: { card: CompetitorCard; brand: Brand; engines: string[]; total: number; updated: string; next: string }) {
  const guess = `${card.name.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`;
  const logo = card.isYou ? brand.logo : favicon(card.domain ?? guess);
  const color = card.isYou ? YOU_COLOR : OTHER_COLOR;
  return (
    <article
      className="flex flex-col gap-4 border border-rule bg-surface p-5"
      // Your own card carries the 2px blue marker on its left edge.
      style={card.isYou ? { boxShadow: "inset 2px 0 0 #0943B0" } : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex min-w-0 items-center gap-3 ">
          <BrandLogo src={logo} name={card.name} size={44} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-[17px] font-medium text-ink">{card.name}</span>
              {card.isYou ? <span className="aw-badge">You</span> : null}
            </div>
            <div className="truncate text-[14px] text-muted">{card.domain ?? "Website unknown"}</div>
          </div>
        </div>

        <div className="flex shrink-0 gap-8">
          <div className="flex flex-col">
            <span className="text-[13px] text-muted">Prompts</span>
            <span className="aw-num text-[22px] font-medium text-ink">
              {card.prompts}
              <span className="text-[14px] font-normal text-muted">/{total}</span>
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[13px] text-muted">Avg position</span>
            <span className="aw-num text-[22px] font-medium text-ink">{card.mentions ? `#${card.position.toFixed(1)}` : "–"}</span>
          </div>
        </div>

      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-rule pt-4 sm:grid-cols-3 lg:grid-cols-6">
          {engines.map((e) => {
            const v = card.byEngine[e];
            return (
              <div key={e} className="flex min-w-0 items-center gap-2">
                <Ring value={v} color={color} size={40} />
                <div className="flex min-w-0 flex-col">
                  <span className="aw-num text-[20px] font-medium leading-tight text-ink">{v === null ? "–" : `${Math.round(v)}%`}</span>
                  <span className="truncate text-[12px] text-muted">
                    <EngineName engine={e} size={12} />
                  </span>
                  <Change now={v} before={card.before[e]} />
                </div>
              </div>
            );
          })}
      </div>
      <div className="text-right text-[12px] text-muted">
        Updated: {updated} → Next: {next}
      </div>
    </article>
  );
}

/** Your brand and the top competitors, with each engine's visibility from the latest run. */
export function CompetitorsPage({ brand, runs }: { brand: Brand; runs: Run[] }) {
  const [mode, setMode] = useState<"mentions" | "citations">("mentions");
  const done = runs.filter((r) => r.chats.some(isAnswered));
  const latest = done.at(-1);
  const previous = done.at(-2) ?? null;

  if (!latest) {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <h1 className="aw-h2 mb-0!">Competitors</h1>
        <div className="aw-callout text-[16px]!">No results yet. Run your prompts from the Dashboard, or wait for the daily run.</div>
      </div>
    );
  }

  const cards = competitorCards(latest, previous, { name: brand.name, domain: brand.domain }, mode);
  const engines = latest.engines.filter((e) => latest.chats.some((c) => c.engine === e));
  const total = new Set(latest.chats.map((c) => c.prompt)).size;
  const at = new Date(latest.at);
  const updated = when(at);
  const next = brand.daily ? when(new Date(at.getTime() + 864e5)) : "when you click Run";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="aw-h2 mb-0!">Competitors</h1>
        <div role="tablist" aria-label="Measure" className="flex gap-1 border border-rule bg-white p-1">
          {(["mentions", "citations"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={` px-4 py-1.5 text-[14px] font-medium ${mode === m ? "bg-ink text-white" : "text-body hover:bg-paper"}`}
            >
              {m === "mentions" ? "Mentions" : "Citations"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-4">
        {cards.map((c) => (
          <CardRow key={c.name} card={c} brand={brand} engines={engines} total={total} updated={updated} next={next} />
        ))}
      </div>
    </div>
  );
}
