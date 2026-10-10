"use client";

import { useState } from "react";
import { ownMention, type Chat } from "@/lib/chats";
import type { Site } from "@/lib/db";
import type { Stage } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import { AiIcon } from "../ui";
import { Difficulty, fmtNum, post, StageTag } from "./shared";

/** A keyword idea from AI visibility gaps, checked for search volume. */
export type AiIdea = {
  keyword: string;
  action: "new" | "update";
  url: string | null;
  stage: Stage | null;
  why: string;
  prompt: string;
  volume: number | null;
  kd: number | null;
  intent: string | null;
};
export const IDEA_TYPE = "application/x-arrowsterr-idea";

/** Prompts where AI skips the brand or ranks it low, with who it names instead. */
export function gaps(chats: Chat[], brand: string) {
  const by = new Map<string, Chat[]>();
  for (const c of chats) by.set(c.prompt, [...(by.get(c.prompt) ?? []), c]);
  return [...by.entries()]
    .map(([prompt, list]) => {
      const mine = list.map((c) => ownMention(c, brand)).filter((m): m is NonNullable<typeof m> => Boolean(m));
      const others = new Map<string, number>();
      for (const c of list) for (const b of c.brands) if (b.name.toLowerCase() !== brand.toLowerCase()) others.set(b.name, (others.get(b.name) ?? 0) + 1);
      return {
        prompt,
        answers: list.length,
        named: mine.length,
        position: mine.length ? mine.reduce((n, m) => n + m.position, 0) / mine.length : null,
        instead: [...others.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n),
      };
    })
    .filter((g) => g.answers > 0);
}

/** Ideas for a site, kept while the app is open. find() asks the server for a fresh set. */
export function useAiIdeas(auth: RunAuth, site: Site, brand: string, chats: Chat[], planned: string[]) {
  const [ideas, setIdeas] = useStash<{ list: AiIdea[]; pages: number; at: string } | null>(`ideas:${site.id}`, null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function find() {
    setBusy(true);
    setError("");
    try {
      const g = gaps(chats, brand);
      const missed = g.filter((x) => x.named / x.answers < 0.34).sort((a, b) => a.named / a.answers - b.named / b.answers);
      const weak = g.filter((x) => x.named / x.answers >= 0.34 && (x.position ?? 0) > 3);
      const out = await post<{ ideas: AiIdea[]; pages: number; at: string }>(auth, "/api/content-ideas", {
        brand,
        siteId: site.id,
        data: {
          missed: missed.slice(0, 12).map((x) => ({ prompt: x.prompt, named: `${x.named}/${x.answers}`, namedInstead: x.instead })),
          weak: weak.slice(0, 8).map((x) => ({ prompt: x.prompt, position: x.position })),
          planned: planned.slice(0, 200),
        },
      });
      setIdeas({ list: out.ideas, pages: out.pages, at: out.at });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const taken = new Set(planned.map((k) => k.toLowerCase()));
  return { list: (ideas?.list ?? []).filter((i) => !taken.has(i.keyword)), loaded: Boolean(ideas), pages: ideas?.pages ?? 0, busy, error, find };
}

/** One idea as a card you can drag onto a day, or add with the button. */
export function IdeaCard({ idea, canEdit, onAdd, addLabel = "+ Add" }: { idea: AiIdea; canEdit: boolean; onAdd?: () => void; addLabel?: string }) {
  const path = idea.url ? idea.url.replace(/^https?:\/\/[^/]+/, "") || "/" : null;
  return (
    <li
      draggable={canEdit}
      onDragStart={(e) => {
        e.dataTransfer.setData(IDEA_TYPE, JSON.stringify(idea));
        e.dataTransfer.setData("text/plain", idea.keyword);
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={`flex items-start gap-3 rounded-aw border border-rule bg-white px-3.5 py-3 ${canEdit ? "cursor-grab active:cursor-grabbing hover:border-ink" : ""}`}
      title={idea.prompt ? `Helps: ${idea.prompt}` : undefined}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[14px] font-medium text-ink">{idea.keyword}</span>
        <span className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          {idea.stage ? <StageTag stage={idea.stage} /> : null}
          <span className="aw-num">{fmtNum(idea.volume)}/mo</span>
          <Difficulty kd={idea.kd} />
          {path ? <span className="aw-chip max-w-48 truncate" title={idea.url ?? ""}>Update {path}</span> : <span className="aw-chip">New page</span>}
        </span>
        {idea.why ? <span className="text-[12px] leading-snug text-body">{idea.why}</span> : null}
      </span>
      {canEdit && onAdd ? (
        <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm shrink-0" onClick={onAdd}>
          {addLabel}
        </button>
      ) : null}
    </li>
  );
}

/** The list of ideas with a button to find them. */
export function IdeaList({ state, canEdit, onAdd, addLabel, compact = false }: { state: ReturnType<typeof useAiIdeas>; canEdit: boolean; onAdd: (i: AiIdea) => void; addLabel?: string; compact?: boolean }) {
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-muted">{state.loaded ? `${state.list.length} keywords` : null}</span>
        {canEdit ? (
          <button type="button" className={`aw-btn aw-btn--sm ${state.loaded ? "aw-btn--secondary" : "aw-btn--accent"}`} onClick={state.find} disabled={state.busy}>
            <AiIcon />
            {state.busy ? "Finding..." : state.loaded ? "Refresh" : "Find ideas"}
          </button>
        ) : null}
      </div>
      {state.error ? <p className="aw-error">{state.error}</p> : null}
      <ul className={`flex flex-col gap-2 ${compact ? "" : ""}`}>
        {state.list.map((i) => (
          <IdeaCard key={i.keyword} idea={i} canEdit={canEdit} onAdd={() => onAdd(i)} addLabel={addLabel} />
        ))}
        {state.loaded && !state.list.length && !state.busy ? <li className="aw-small">No new keywords.</li> : null}
      </ul>
    </div>
  );
}

/** Read an idea dropped from a card. */
export function droppedIdea(e: React.DragEvent): AiIdea | null {
  try {
    const raw = e.dataTransfer.getData(IDEA_TYPE);
    return raw ? (JSON.parse(raw) as AiIdea) : null;
  } catch {
    return null;
  }
}
