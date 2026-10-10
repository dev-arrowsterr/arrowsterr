"use client";

import { useState } from "react";
import type { Brief } from "@/lib/briefTypes";
import { favicon } from "../ui";

// ─────────────── icons ───────────────

const I = ({ d }: { d: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
export const BRIEF_ICONS = {
  target: <I d={<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r=".5" /></>} />,
  tag: <I d={<><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.2" /></>} />,
  outline: <I d={<path d="M8 6h12M8 12h12M11 18h9M4 6h.01M4 12h.01M7 18h.01" />} />,
  check: <I d={<><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="m8 12 3 3 5-6" /></>} />,
  question: <I d={<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" /></>} />,
  terms: <I d={<path d="M4 7h16M4 12h10M4 17h7" />} />,
  spark: <I d={<path d="M12 2l2.2 6 6 2.2-6 2.2L12 18.6l-2.2-6.2-6-2.2 6-2.2z" />} />,
  globe: <I d={<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>} />,
  ai: <I d={<><rect x="4" y="5" width="16" height="12" rx="3" /><path d="M9 21h6M9.5 10h.01M14.5 10h.01" /></>} />,
  link: <I d={<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />} />,
  book: <I d={<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5" />} />,
  bulb: <I d={<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />} />,
  user: <I d={<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>} />,
  copy: <I d={<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>} />,
};

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      title="Copy"
      aria-label="Copy"
      className="aw-iconbtn shrink-0"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1200);
      }}
    >
      {ok ? <span className="text-[11px] text-pos">✓</span> : BRIEF_ICONS.copy}
    </button>
  );
}

type Sec = { id: string; icon: React.ReactNode; title: string; count?: string; body: React.ReactNode; open?: boolean };

/** One part of the brief that opens and closes. */
function Part({ s, open, onToggle }: { s: Sec; open: boolean; onToggle: () => void }) {
  return (
    <section className={`aw-bpart ${open ? "is-open" : ""}`}>
      <button type="button" className="aw-bpart__head" onClick={onToggle} aria-expanded={open}>
        <span className="aw-bpart__icon">{s.icon}</span>
        <span className="flex-1 text-left">{s.title}</span>
        {s.count ? <span className="aw-bpart__count">{s.count}</span> : null}
        <svg className="aw-bpart__chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? <div className="aw-bpart__body">{s.body}</div> : null}
    </section>
  );
}

const Tick = ({ done }: { done?: boolean }) => (done === undefined ? <span className="aw-bdot" /> : <span className={`aw-btick ${done ? "is-done" : ""}`}>{done ? "✓" : ""}</span>);

/** The content brief as cards that open and close, with what the draft already covers ticked off. */
export function BriefView({ brief, keyword, done, compact = false }: { brief: Brief; keyword: string; done?: (label: string) => boolean; compact?: boolean }) {
  const a = brief.analysis;
  const b = brief.brief;
  const t = brief.template;
  const notes = new Map(a.pages.map((p) => [p.url, p]));
  const list = (items: string[], tick = true) => (
    <ul className="flex flex-col gap-2">
      {items.map((x) => (
        <li key={x} className="flex items-start gap-2.5">
          <Tick done={tick && done ? done(x) : undefined} />
          <span className={tick && done?.(x) ? "text-muted line-through" : "text-ink"}>{x}</span>
        </li>
      ))}
    </ul>
  );
  const pct = (items: string[]) => (done && items.length ? `${items.filter(done).length}/${items.length}` : String(items.length));

  const parts: Sec[] = [
    {
      id: "intent",
      icon: BRIEF_ICONS.target,
      title: "Search intent and format",
      open: true,
      body: (
        <div className="flex flex-col gap-3">
          <p className="text-ink">{a.intent}</p>
          <div className={`grid gap-2 ${compact ? "grid-cols-1" : "sm:grid-cols-2"}`}>
            <div className="aw-bfact">
              <span className="aw-label">Format</span>
              <span className="text-ink">{a.format}</span>
              <span className="text-[12px] text-muted">{a.formatWhy}</span>
            </div>
            <div className="aw-bfact">
              <span className="aw-label">Length</span>
              <span className="text-ink">{b.wordCount} words</span>
              <span className="text-[12px] text-muted">Top pages: {a.wordRange}</span>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "meta",
      icon: BRIEF_ICONS.tag,
      title: "Title and meta",
      body: (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="aw-label">Title ideas</span>
            {b.titles.map((x) => (
              <span key={x} className="flex items-center justify-between gap-2 rounded-[8px] bg-surface-2 px-3 py-2 text-ink">
                {x}
                <Copy text={x} />
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="aw-label">Meta description · {b.metaDescription.length} characters</span>
            <span className="flex items-start justify-between gap-2 rounded-[8px] bg-surface-2 px-3 py-2 text-ink">
              {b.metaDescription}
              <Copy text={b.metaDescription} />
            </span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
            <span>
              <span className="text-muted">H1 </span>
              <span className="text-ink">{b.h1}</span>
            </span>
            <span>
              <span className="text-muted">Slug </span>
              <span className="font-mono text-ink">/{b.slug}</span>
            </span>
          </div>
        </div>
      ),
    },
    {
      id: "outline",
      icon: BRIEF_ICONS.outline,
      title: "Outline",
      count: String(b.outline.length),
      open: true,
      body: <Outline outline={b.outline} guide={t?.outline} />,
    },
    { id: "cover", icon: BRIEF_ICONS.check, title: "Must cover", count: pct(a.mustCover), body: list(a.mustCover) },
    { id: "questions", icon: BRIEF_ICONS.question, title: "Questions to answer", count: pct(b.questions), body: list(b.questions) },
    {
      id: "terms",
      icon: BRIEF_ICONS.terms,
      title: "Terms to use",
      count: pct(b.terms),
      body: (
        <div className="flex flex-wrap gap-1.5">
          {b.terms.map((x) => (
            <span key={x} className={`aw-bterm ${done?.(x) ? "is-done" : ""}`}>
              {done?.(x) ? "✓ " : ""}
              {x}
            </span>
          ))}
        </div>
      ),
    },
    {
      id: "win",
      icon: BRIEF_ICONS.spark,
      title: "How to beat the top 10",
      count: String(a.gaps.length + b.makeItYours.length),
      body: (
        <div className="flex flex-col gap-3">
          {a.gaps.length ? (
            <div className="flex flex-col gap-1.5">
              <span className="aw-label">Gaps they leave open</span>
              {list(a.gaps, false)}
            </div>
          ) : null}
          {b.makeItYours.length ? (
            <div className="flex flex-col gap-1.5">
              <span className="aw-label">Make it yours</span>
              {list(b.makeItYours, false)}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: "serp",
      icon: BRIEF_ICONS.globe,
      title: `Google's top ${brief.serp.pages.length}`,
      count: String(brief.serp.pages.length),
      body: (
        <ol className="flex flex-col divide-y divide-rule-faint">
          {brief.serp.pages.map((p) => {
            const n = notes.get(p.url);
            return (
              <li key={p.url} className="flex flex-col gap-1 py-2.5">
                <span className="flex items-center gap-2">
                  <span className="aw-num w-5 text-[12px] text-muted">{p.rank}</span>
                  <img src={favicon(p.domain)} alt="" width={14} height={14} className="rounded-[3px]" />
                  <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 flex-1 truncate text-[13px]" title={p.title}>
                    {p.title || p.domain}
                  </a>
                  {p.words ? <span className="aw-num shrink-0 text-[12px] text-muted">{p.words.toLocaleString()} words</span> : null}
                </span>
                {n ? (
                  <span className="ml-7 flex flex-col gap-0.5 text-[12px]">
                    <span className="text-pos">+ {n.strength}</span>
                    <span className="text-neg">− {n.weakness}</span>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      ),
    },
  ];
  if (brief.serp.aiOverview.shown)
    parts.push({
      id: "aio",
      icon: BRIEF_ICONS.ai,
      title: "Google's AI Overview",
      body: (
        <div className="flex flex-col gap-3">
          <p className="text-ink">{a.aiOverview}</p>
          {brief.serp.aiOverview.cites.length ? (
            <div className="flex flex-wrap gap-1.5">
              {brief.serp.aiOverview.cites.map((c) => (
                <a key={c.url} href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="aw-chip text-[12px]!">
                  <img src={favicon(c.domain)} alt="" width={12} height={12} />
                  {c.domain}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ),
    });
  if (t)
    parts.push({
      id: "audience",
      icon: BRIEF_ICONS.user,
      title: "Reader and goals",
      body: (
        <div className="flex flex-col gap-3">
          <div className={`grid gap-2 ${compact ? "grid-cols-1" : "sm:grid-cols-2"}`}>
            {[
              ["Who", t.positioning.who],
              ["Where to", t.positioning.whereTo],
              ["How", t.positioning.howTo],
              ["Why", t.positioning.whySo],
            ].map(([k, v]) => (
              <div key={k} className="aw-bfact">
                <span className="aw-label">{k}</span>
                <span className="text-ink">{v}</span>
              </div>
            ))}
          </div>
          {t.goals.length ? (
            <div className="flex flex-col gap-1.5">
              <span className="aw-label">Goals</span>
              {list(t.goals, false)}
            </div>
          ) : null}
          {t.lema.action ? (
            <span className="text-[13px]">
              <span className="text-muted">Next step for the reader </span>
              <span className="text-ink">{t.lema.action}</span>
            </span>
          ) : null}
        </div>
      ),
    });
  if (b.internalLinks.length)
    parts.push({
      id: "links",
      icon: BRIEF_ICONS.link,
      title: "Internal links",
      count: done ? `${b.internalLinks.filter((l) => done(`Link "${l.anchor}"`)).length}/${b.internalLinks.length}` : String(b.internalLinks.length),
      body: (
        <ul className="flex flex-col gap-2">
          {b.internalLinks.map((l) => (
            <li key={l.url} className="flex items-start gap-2.5">
              <Tick done={done ? done(`Link "${l.anchor}"`) : undefined} />
              <span className="flex min-w-0 flex-col">
                <span className="text-ink">&ldquo;{l.anchor}&rdquo;</span>
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="truncate text-[12px]">
                  {l.url.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
              </span>
            </li>
          ))}
        </ul>
      ),
    });
  if (b.sources.length)
    parts.push({
      id: "sources",
      icon: BRIEF_ICONS.book,
      title: "Sources to cite",
      count: String(b.sources.length),
      body: (
        <ul className="flex flex-col gap-1.5">
          {b.sources.map((s) => (
            <li key={s} className="truncate text-[13px]">
              {/^https?:\/\//.test(s) ? (
                <a href={s} target="_blank" rel="noopener noreferrer nofollow">
                  {s.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
              ) : (
                s
              )}
            </li>
          ))}
        </ul>
      ),
    });
  if (b.aiTips.length) parts.push({ id: "tips", icon: BRIEF_ICONS.bulb, title: "Get cited by AI", count: String(b.aiTips.length), body: list(b.aiTips, false) });

  const [open, setOpen] = useState<Set<string>>(() => new Set(parts.filter((p) => p.open).map((p) => p.id)));
  const all = open.size === parts.length;
  return (
    <div className={`flex flex-col gap-3 ${compact ? "aw-brief--compact" : ""}`}>
      {!compact ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="aw-chip aw-chip--brand">{keyword}</span>
          <span className="aw-chip">{a.format}</span>
          <span className="aw-chip">{b.wordCount} words</span>
          {brief.serp.aiOverview.shown ? <span className="aw-chip">AI Overview on Google</span> : null}
        </div>
      ) : null}
      <div className="flex justify-end">
        <button type="button" className="aw-text-link text-[12px]" onClick={() => setOpen(all ? new Set() : new Set(parts.map((p) => p.id)))}>
          {all ? "Close all" : "Open all"}
        </button>
      </div>
      {parts.map((s) => (
        <Part
          key={s.id}
          s={s}
          open={open.has(s.id)}
          onToggle={() =>
            setOpen((o) => {
              const n = new Set(o);
              if (n.has(s.id)) n.delete(s.id);
              else n.add(s.id);
              return n;
            })
          }
        />
      ))}
    </div>
  );
}

/** The outline: each H2 opens to show its H3s and what to say. */
function Outline({ outline, guide }: { outline: Brief["brief"]["outline"]; guide?: { section: string; guide: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <ol className="flex flex-col gap-1.5">
      {outline.map((o, i) => {
        const g = guide?.find((x) => x.section.toLowerCase() === o.h2.toLowerCase())?.guide;
        const on = open === i;
        return (
          <li key={i} className={`aw-boutline ${on ? "is-open" : ""}`}>
            <button type="button" className="flex w-full items-center gap-2.5 px-3 py-2 text-left" onClick={() => setOpen(on ? null : i)} aria-expanded={on}>
              <span className="aw-boutline__n">H2</span>
              <span className="flex-1 font-medium text-ink">{o.h2}</span>
              {o.h3.length ? <span className="text-[11px] text-muted">{o.h3.length} H3</span> : null}
            </button>
            {on ? (
              <div className="flex flex-col gap-2 px-3 pb-3 pl-12">
                {o.h3.map((h) => (
                  <span key={h} className="flex items-center gap-2 text-[13px] text-ink">
                    <span className="aw-boutline__n aw-boutline__n--sm">H3</span>
                    {h}
                  </span>
                ))}
                {o.notes || g ? <p className="rounded-[8px] bg-surface-2 px-3 py-2 text-[13px] text-body">{g ?? o.notes}</p> : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
