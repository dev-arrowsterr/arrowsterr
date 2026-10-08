"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import type { Brief } from "@/lib/briefTypes";
import { getBrief, type CalendarItem } from "@/lib/db";
import type { RunAuth } from "@/lib/runner";
import { BrandLogo } from "../BrandLogo";
import { favicon, Seg } from "../ui";
import { Difficulty, fmtNum, post, StageTag } from "./shared";

type State = Awaited<ReturnType<typeof getBrief>>;

/** The brief as Markdown, to paste into Google Docs or a CMS. */
export function briefMarkdown(item: CalendarItem, b: Brief) {
  const d = b.brief;
  const a = b.analysis;
  const list = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");
  return `# Content brief: ${item.keyword}

**Job:** ${item.action === "update" ? `Improve ${item.current_url}` : "New page"}
**Main keyword:** ${item.keyword}${item.secondary.length ? `\n**Also target:** ${item.secondary.join(", ")}` : ""}
**Search intent:** ${a.intent}
**Format:** ${a.format} (${a.formatWhy})
**Length:** ${d.wordCount} words

## Title options
${list(d.titles)}

**Meta description:** ${d.metaDescription}
**URL:** ${d.slug}
**H1:** ${d.h1}

## Outline
${d.outline.map((o) => `### ${o.h2}\n${o.h3.map((h) => `- ${h}`).join("\n")}${o.notes ? `\n\n_${o.notes}_` : ""}`).join("\n\n")}

## Questions to answer
${list(d.questions)}

## Must cover
${list(a.mustCover)}

## Gaps to win on
${list(a.gaps)}

## Make it yours
${list(d.makeItYours)}

## Terms to use
${d.terms.join(", ")}

## Internal links
${d.internalLinks.map((l) => `- [${l.anchor}](${l.url})`).join("\n")}

## Sources to cite
${list(d.sources)}

## Getting cited by AI
${list(d.aiTips)}
`;
}

/** A side panel with the content brief for one calendar item, and the Google research behind it. */
export function BriefPanel({ sb, auth, item, canEdit, onClose, onStatus }: { sb: SupabaseClient; auth: RunAuth; item: CalendarItem; canEdit: boolean; onClose: () => void; onStatus: (s: CalendarItem["brief_status"]) => void }) {
  const [data, setData] = useState<State | null>(null);
  const [tab, setTab] = useState<"brief" | "analysis" | "results">("brief");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await getBrief(sb, item.id);
      setData(d);
      onStatus(d.brief_status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [sb, item.id, onStatus]);

  useEffect(() => {
    // Loading from Supabase when the panel opens is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const running = data?.brief_status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [running, load]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  async function generate() {
    setError("");
    try {
      await post(auth, "/api/research/brief", { itemId: item.id });
      setData((d) => ({ ...(d ?? { brief: null, brief_error: null, brief_at: null }), brief_status: "running" }));
      onStatus("running");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const b = data?.brief ?? null;
  const md = b ? briefMarkdown(item, b) : "";

  return (
    <>
      <div className="aw-drawer-back" onClick={onClose} aria-hidden="true" />
      <aside className="aw-drawer" role="dialog" aria-modal="true" aria-label={`Content brief for ${item.keyword}`}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rule px-6 py-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="aw-label">{item.action === "update" ? "Update an existing page" : "New page"}</span>
            <h2 className="aw-h3">{item.keyword}</h2>
            <span className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
              <StageTag stage={item.stage} />
              <span>{fmtNum(item.volume)} searches / mo</span>
              <Difficulty kd={item.difficulty} />
              {item.current_url ? (
                <a href={item.current_url} target="_blank" rel="noopener noreferrer" className="truncate">
                  {item.current_url.replace(/^https?:\/\//, "")}
                  {item.current_rank ? ` · #${item.current_rank}` : ""}
                </a>
              ) : null}
            </span>
            {item.secondary.length ? <span className="text-[13px] text-body">Also covers: {item.secondary.join(" · ")}</span> : null}
          </div>
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-5">
          {error ? <p className="aw-error mb-4">{error}</p> : null}
          {!data ? (
            <p className="aw-small">Loading...</p>
          ) : running ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center" role="status" aria-live="polite">
              <span className="aw-think__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M12 1.5c.6 4.9 2.9 8.6 10.5 10.5-7.6 1.9-9.9 5.6-10.5 10.5-.6-4.9-2.9-8.6-10.5-10.5C9.1 10.1 11.4 6.4 12 1.5z" />
                </svg>
              </span>
              <span className="aw-h4">Reading Google&apos;s top 10 and writing the brief...</span>
              <span className="aw-small">About 1 to 2 minutes. You can close this panel.</span>
            </div>
          ) : !b ? (
            <div className="flex flex-col gap-4 py-6">
              {data.brief_status === "failed" ? <p className="aw-error">The last try failed: {data.brief_error}</p> : null}
              <p className="text-[15px] text-body">
                Arrowsterr reads Google&apos;s top 10 for <b className="text-ink">{item.keyword}</b>, opens every page, and checks the AI Overview and People also ask. Then it
                writes a brief: the format that wins, what to cover, gaps to win on, an outline, questions, internal links and what only you can add.
              </p>
              <p className="aw-small">Costs about 1 cent in DataForSEO plus one AI answer from your daily limit.</p>
              {canEdit ? (
                <div>
                  <button type="button" className="aw-btn aw-btn--accent" onClick={generate}>
                    Write the brief
                  </button>
                </div>
              ) : (
                <p className="aw-small">Ask an editor to write the brief.</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Seg
                  label="Brief sections"
                  value={tab}
                  onChange={setTab}
                  options={[
                    { id: "brief", label: "Brief" },
                    { id: "analysis", label: "Google analysis" },
                    { id: "results", label: "Top 10" },
                  ]}
                />
                <span className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="aw-btn aw-btn--secondary aw-btn--sm"
                    onClick={() => {
                      navigator.clipboard.writeText(md).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      });
                    }}
                  >
                    {copied ? "Copied" : "Copy as Markdown"}
                  </button>
                  <button
                    type="button"
                    className="aw-btn aw-btn--secondary aw-btn--sm"
                    onClick={() => {
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
                      a.download = `brief-${item.keyword.replace(/\W+/g, "-")}.md`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                  >
                    Download .md
                  </button>
                  {canEdit ? (
                    <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={generate}>
                      Write again
                    </button>
                  ) : null}
                </span>
              </div>
              {tab === "brief" ? <BriefView b={b} /> : tab === "analysis" ? <AnalysisView b={b} /> : <ResultsView b={b} />}
              <span className="aw-label">
                Made {new Date(b.at).toLocaleString()} · DataForSEO ${b.cost.toFixed(3)}
              </span>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-rule-faint pt-4">
      <h3 className="aw-label">{title}</h3>
      {children}
    </section>
  );
}
const Bullets = ({ items }: { items: string[] }) => (
  <ul className="flex list-disc flex-col gap-1 pl-5 text-[14px] text-body">
    {items.map((x) => (
      <li key={x}>{x}</li>
    ))}
  </ul>
);

function BriefView({ b }: { b: Brief }) {
  const d = b.brief;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { lab: "Format", v: b.analysis.format },
          { lab: "Length", v: `${d.wordCount} words` },
          { lab: "URL", v: d.slug },
        ].map((x) => (
          <div key={x.lab} className="border border-rule p-3">
            <div className="aw-label mb-1">{x.lab}</div>
            <div className="text-[14px] text-ink">{x.v}</div>
          </div>
        ))}
      </div>
      <Section title="Title options">
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-[14px] text-ink">
          {d.titles.map((t) => (
            <li key={t}>
              {t} <span className="aw-num text-[11px] text-muted">{t.length}</span>
            </li>
          ))}
        </ol>
        <p className="text-[14px] text-body">
          <span className="aw-label mr-2">Meta</span>
          {d.metaDescription}
        </p>
        <p className="text-[14px] text-body">
          <span className="aw-label mr-2">H1</span>
          {d.h1}
        </p>
      </Section>
      <Section title="Outline">
        <ol className="flex flex-col gap-3">
          {d.outline.map((o, i) => (
            <li key={`${o.h2}${i}`} className="border-l-2 border-brand pl-3">
              <div className="text-[15px] font-medium text-ink">
                <span className="aw-label mr-2">H2</span>
                {o.h2}
              </div>
              {o.h3.length ? (
                <ul className="mt-1 flex flex-col gap-0.5 pl-4 text-[14px] text-body">
                  {o.h3.map((h) => (
                    <li key={h}>
                      <span className="aw-label mr-2">H3</span>
                      {h}
                    </li>
                  ))}
                </ul>
              ) : null}
              {o.notes ? <p className="mt-1 text-[13px] text-muted">{o.notes}</p> : null}
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Questions to answer">
        <Bullets items={d.questions} />
      </Section>
      <Section title="Make it yours">
        <Bullets items={d.makeItYours} />
      </Section>
      <Section title="Terms to use">
        <p className="flex flex-wrap gap-1.5">
          {d.terms.map((t) => (
            <span key={t} className="border border-rule px-2 py-0.5 text-[13px] text-body">
              {t}
            </span>
          ))}
        </p>
      </Section>
      <Section title="Internal links">
        {d.internalLinks.length ? (
          <ul className="flex flex-col gap-1 text-[14px]">
            {d.internalLinks.map((l) => (
              <li key={l.url}>
                <a href={l.url} target="_blank" rel="noopener noreferrer">
                  {l.anchor}
                </a>{" "}
                <span className="text-[12px] text-muted">{l.url.replace(/^https?:\/\//, "")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="aw-small">No matching pages found in the sitemap. Run Agentic research once to load it.</p>
        )}
      </Section>
      <Section title="Sources to cite">
        <Bullets items={d.sources} />
      </Section>
      <Section title="Getting cited by AI">
        <Bullets items={d.aiTips} />
      </Section>
    </div>
  );
}

function AnalysisView({ b }: { b: Brief }) {
  const a = b.analysis;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="border border-rule p-3">
          <div className="aw-label mb-1">Search intent</div>
          <div className="text-[14px] text-ink">{a.intent}</div>
        </div>
        <div className="border border-rule p-3">
          <div className="aw-label mb-1">Winning format</div>
          <div className="text-[14px] text-ink">{a.format}</div>
          <div className="text-[13px] text-muted">{a.formatWhy}</div>
        </div>
      </div>
      <Section title="Action items">
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-[14px] text-ink">
          {a.actions.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ol>
      </Section>
      <Section title="Every top page covers">
        <Bullets items={a.mustCover} />
      </Section>
      <Section title="Gaps no top page covers well">
        <Bullets items={a.gaps} />
      </Section>
      <Section title="AI Overview">
        <p className="text-[14px] text-body">{a.aiOverview}</p>
        {b.serp.aiOverview.cites.length ? (
          <p className="flex flex-wrap gap-2">
            {b.serp.aiOverview.cites.map((c) => (
              <a key={c.url} href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1.5 border border-rule px-2 py-0.5 text-[12px]">
                <BrandLogo src={favicon(c.domain)} name={c.domain} size={12} />
                {c.domain}
              </a>
            ))}
          </p>
        ) : null}
      </Section>
      <Section title="People also ask">
        {b.serp.questions.length ? <Bullets items={b.serp.questions} /> : <p className="aw-small">Google showed none.</p>}
      </Section>
      <Section title="Related searches">
        <p className="text-[14px] text-body">{b.serp.related.join(" · ") || "None"}</p>
      </Section>
    </div>
  );
}

function ResultsView({ b }: { b: Brief }) {
  const notes = new Map(b.analysis.pages.map((p) => [p.url, p]));
  return (
    <ol className="flex flex-col gap-3">
      {b.serp.pages.map((p) => {
        const n = notes.get(p.url);
        return (
          <li key={p.url} className="flex flex-col gap-1.5 border border-rule p-3">
            <span className="flex items-center gap-2">
              <span className="aw-num w-7 text-[13px] text-muted">#{p.rank}</span>
              <BrandLogo src={favicon(p.domain)} name={p.domain} size={16} />
              <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-[14px] font-medium">
                {p.title || p.url}
              </a>
            </span>
            <span className="flex flex-wrap gap-x-4 gap-y-1 pl-9 font-mono text-[11px] text-muted">
              {p.read ? (
                <>
                  <span>{fmtNum(p.words)} words</span>
                  <span>{p.headings.filter((h) => h.startsWith("H2")).length} H2s</span>
                  <span>{p.tables} tables</span>
                  <span>{p.images} images</span>
                  {p.videos ? <span>{p.videos} videos</span> : null}
                  {p.schema.length ? <span>Schema: {p.schema.join(", ")}</span> : null}
                  {p.updated ? <span>Updated {p.updated}</span> : null}
                </>
              ) : (
                <span>Could not read this page. Used Google&apos;s snippet.</span>
              )}
            </span>
            {n ? (
              <span className="flex flex-col gap-0.5 pl-9 text-[13px]">
                <span className="text-ink">{n.format}</span>
                <span className="text-body">
                  <span className="text-pos">+</span> {n.strength}
                </span>
                <span className="text-body">
                  <span className="text-neg">−</span> {n.weakness}
                </span>
              </span>
            ) : null}
            {p.headings.length ? (
              <details className="pl-9">
                <summary className="cursor-pointer text-[12px] text-muted">Headings ({p.headings.length})</summary>
                <ul className="mt-1 flex flex-col gap-0.5 text-[12px] text-body">
                  {p.headings.map((h, i) => (
                    <li key={`${h}${i}`} className={h.startsWith("H3") ? "pl-4" : ""}>
                      {h}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
