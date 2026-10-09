"use client";

import { useState } from "react";
import { ownMention, type Chat } from "@/lib/chats";
import type { CalendarItem } from "@/lib/db";
import type { Stage } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { STATUSES } from "./ContentPiece";
import { post, STAGE_COLORS, StageTag } from "./shared";

export type NewPiece = { keyword: string; stage?: Stage | null; notes?: string | null };
type Idea = { key: string; keyword: string; title: string; why: string; stage: Stage | null; tag: string };

/** Prompts where AI skips the brand or ranks it low, with who it names instead. */
function gaps(chats: Chat[], brand: string) {
  const by = new Map<string, Chat[]>();
  for (const c of chats) by.set(c.prompt, [...(by.get(c.prompt) ?? []), c]);
  return [...by.entries()]
    .map(([prompt, list]) => {
      const mine = list.map((c) => ownMention(c, brand)).filter((m): m is NonNullable<typeof m> => Boolean(m));
      const others = new Map<string, number>();
      for (const c of list) for (const b of c.brands) if (b.name.toLowerCase() !== brand.toLowerCase()) others.set(b.name, (others.get(b.name) ?? 0) + 1);
      const sites = new Map<string, number>();
      for (const c of list) for (const s of c.sources) if (s.domain) sites.set(s.domain, (sites.get(s.domain) ?? 0) + 1);
      return {
        prompt,
        answers: list.length,
        named: mine.length,
        position: mine.length ? mine.reduce((n, m) => n + m.position, 0) / mine.length : null,
        instead: [...others.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n),
        sites: [...sites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => d),
      };
    })
    .filter((g) => g.answers > 0);
}

/** One day of the editorial calendar: what is planned, and ideas from AI visibility to add. */
export function DayPanel({
  auth,
  date,
  items,
  planned,
  chats,
  brand,
  domain,
  canEdit,
  onOpen,
  onAdd,
}: {
  auth: RunAuth;
  date: string;
  items: CalendarItem[];
  planned: string[];
  chats: Chat[];
  brand: string;
  domain: string;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onAdd: (p: NewPiece) => void;
}) {
  const [draft, setDraft] = useState("");
  const [more, setMore] = useState<Idea[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const taken = new Set(planned.map((k) => k.toLowerCase()));

  const g = gaps(chats, brand);
  const missed = g.filter((x) => x.named / x.answers < 0.34).sort((a, b) => a.named / a.answers - b.named / b.answers || b.answers - a.answers);
  const weak = g.filter((x) => x.named / x.answers >= 0.34 && (x.position ?? 0) > 3).sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
  const ideas: Idea[] = [
    ...missed.slice(0, 5).map((x) => ({
      key: `m:${x.prompt}`,
      keyword: x.prompt.toLowerCase().replace(/[?!.]+$/, ""),
      title: x.prompt,
      why: `Named in ${x.named} of ${x.answers} answers.${x.instead.length ? ` AI picks ${x.instead.join(", ")}.` : ""}`,
      stage: null,
      tag: "AI skips you",
    })),
    ...weak.slice(0, 3).map((x) => ({
      key: `w:${x.prompt}`,
      keyword: x.prompt.toLowerCase().replace(/[?!.]+$/, ""),
      title: x.prompt,
      why: `You sit at #${x.position!.toFixed(1)}.${x.instead.length ? ` Ahead of you: ${x.instead.slice(0, 2).join(", ")}.` : ""}`,
      stage: null,
      tag: "Climb the list",
    })),
  ].filter((i) => !taken.has(i.keyword));

  async function askAi() {
    setBusy(true);
    setError("");
    try {
      const out = await post<{ ideas: { title: string; keyword: string; stage: Stage | null; angle: string; why: string }[] }>(auth, "/api/content-ideas", {
        brand,
        domain,
        date,
        data: {
          missed: missed.slice(0, 10).map((x) => ({ prompt: x.prompt, named: `${x.named}/${x.answers}`, namedInstead: x.instead })),
          weak: weak.slice(0, 6).map((x) => ({ prompt: x.prompt, position: x.position })),
          sites: [...new Set(g.flatMap((x) => x.sites))].slice(0, 12),
          planned: planned.slice(0, 150),
        },
      });
      setMore(out.ideas.map((i) => ({ key: `a:${i.keyword}`, keyword: i.keyword, title: i.title, why: `${i.angle} ${i.why}`.trim(), stage: i.stage, tag: "AI idea" })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const add = (i: Idea) => {
    onAdd({ keyword: i.keyword, stage: i.stage, notes: i.title !== i.keyword ? `${i.title}\n${i.why}` : i.why });
    setAdded(new Set([...added, i.key]));
  };
  const card = (i: Idea) => (
    <li key={i.key} className="flex items-start gap-4 border-b border-rule-faint px-5 py-4 last:border-b-0">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="aw-chip">{i.tag}</span>
          {i.stage ? <StageTag stage={i.stage} /> : null}
        </span>
        <span className="text-[15px] font-medium text-ink">{i.title}</span>
        <span className="text-[13px] text-body">{i.why}</span>
      </span>
      {canEdit ? (
        <button type="button" className={`aw-btn aw-btn--sm shrink-0 ${added.has(i.key) ? "aw-btn--secondary" : "aw-btn--primary"}`} disabled={added.has(i.key)} onClick={() => add(i)}>
          {added.has(i.key) ? "Added" : "+ Add"}
        </button>
      ) : null}
    </li>
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section className="flex flex-col gap-3">
        <h3 className="aw-h4">Content for this day</h3>
        <ul className="flex flex-col gap-2">
          {items.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => onOpen(i.id)}
                className="aw-frame flex w-full items-center gap-3 border-l-4! px-4 py-3 text-left transition-shadow hover:shadow-aw"
                style={{ borderLeftColor: i.stage ? STAGE_COLORS[i.stage] : "var(--aw-faint)" }}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[15px] font-medium text-ink">{i.keyword}</span>
                  <span className="text-[12px] text-muted">
                    {STATUSES.find((s) => s.id === i.status)?.label}
                    {i.brief_status === "done" && i.status === "planned" ? " · Brief ready" : i.brief_status === "running" ? " · Brief writing" : ""}
                  </span>
                </span>
                <span className="text-muted" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}
          {!items.length ? <li className="aw-small rounded-aw border border-dashed border-rule px-4 py-6 text-center">Nothing planned yet</li> : null}
        </ul>
        {canEdit ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = draft.trim().replace(/\s+/g, " ");
              if (v) onAdd({ keyword: v });
              setDraft("");
            }}
          >
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a keyword or title" aria-label="Add content" className="aw-input h-11! flex-1 py-0!" />
            <button type="submit" className="aw-btn aw-btn--primary h-11! py-0!" disabled={!draft.trim()}>
              Add
            </button>
          </form>
        ) : null}
      </section>

      <section className="aw-frame flex flex-col self-start">
        <div className="aw-frame__head">
          <h3 className="aw-h4">Ideas from AI visibility</h3>
          {canEdit ? (
            <button type="button" className="aw-btn aw-btn--accent aw-btn--sm" onClick={askAi} disabled={busy}>
              {busy ? "Thinking..." : "✦ More ideas"}
            </button>
          ) : null}
        </div>
        {error ? <p className="aw-error m-4">{error}</p> : null}
        <ul className="flex flex-col">
          {[...(more ?? []), ...ideas].map(card)}
          {!ideas.length && !more ? <li className="aw-small px-5 py-6">No gaps in the last results. Click More ideas.</li> : null}
        </ul>
      </section>
    </div>
  );
}
