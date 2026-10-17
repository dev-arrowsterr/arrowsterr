"use client";

import { useState } from "react";
import { MODULE_LABEL, type WriterBrief } from "@/lib/writerBrief";
import { BRIEF_ICONS } from "../research/BriefView";
import { favicon } from "../ui";

// The Agentic Writer's brief, read-only: the plan for the draft, the modules to build, and the research behind it.

type Sec = { id: string; icon: React.ReactNode; title: string; count?: string; body: React.ReactNode };

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

const Label = ({ children }: { children: React.ReactNode }) => <span className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">{children}</span>;
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1">
    <Label>{label}</Label>
    <div className="text-[14px] leading-relaxed text-body">{children}</div>
  </div>
);
const Bullets = ({ items }: { items: string[] }) => (
  <ul className="flex list-disc flex-col gap-1 pl-5 text-[14px] text-body">
    {items.map((x, i) => (
      <li key={`${i}-${x}`}>{x}</li>
    ))}
  </ul>
);

export function WriterBriefView({ brief }: { brief: WriterBrief }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(["plan", "outline", "modules"]));
  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const src = new Map(brief.research.sources.map((s) => [s.n, s]));
  const cite = (ns: number[]) =>
    ns.length ? (
      <span className="flex flex-wrap gap-1">
        {ns.map((n) => (
          <a key={n} href={src.get(n)?.url} target="_blank" rel="noreferrer" className="aw-tag" title={src.get(n)?.title}>
            [{n}] {src.get(n)?.domain}
          </a>
        ))}
      </span>
    ) : null;

  const secs: Sec[] = [
    {
      id: "plan",
      icon: BRIEF_ICONS.target,
      title: "Plan",
      body: (
        <div className="flex flex-col gap-4">
          <Field label="Titles">
            <ol className="flex list-decimal flex-col gap-1 pl-5">
              {brief.titles.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="H1">{brief.h1}</Field>
            <Field label="Word target">
              <span className="aw-num">{brief.wordTarget.toLocaleString("en-US")}</span>
            </Field>
            <Field label="Meta description">{brief.metaDescription}</Field>
            <Field label="Slug">/{brief.slug}</Field>
            <Field label="Search intent">{brief.searchIntent}</Field>
            <Field label="Reader">{brief.reader}</Field>
          </div>
          <Field label="Angle">{brief.angle}</Field>
        </div>
      ),
    },
    {
      id: "outline",
      icon: BRIEF_ICONS.outline,
      title: "Outline",
      count: String(brief.outline.length),
      body: (
        <ol className="flex flex-col gap-4">
          {brief.outline.map((p, i) => (
            <li key={`${i}-${p.h2}`} className="flex flex-col gap-2 border-l-2 border-rule pl-3">
              <span className="text-[15px] font-medium text-ink">{p.h2}</span>
              <Bullets items={p.points} />
              {p.h3.map((h) => (
                <div key={h.title} className="flex flex-col gap-1 pl-3">
                  <span className="text-[14px] font-medium text-ink">{h.title}</span>
                  <Bullets items={h.points} />
                </div>
              ))}
              {cite(p.sources)}
              {brief.modules
                .filter((m) => m.placement === p.h2)
                .map((m) => (
                  <span key={m.title} className="text-[13px] text-muted">
                    Module after this section: {m.title}
                  </span>
                ))}
            </li>
          ))}
        </ol>
      ),
    },
    {
      id: "modules",
      icon: BRIEF_ICONS.spark,
      title: "Interactive modules",
      count: String(brief.modules.length),
      body: (
        <div className="flex flex-col gap-3">
          {brief.modules.map((m) => (
            <div key={m.title} className="flex flex-col gap-3 border border-rule p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="aw-status aw-status--pending">{MODULE_LABEL[m.type]}</span>
                <span className="text-[15px] font-medium text-ink">{m.title}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Purpose">{m.purpose}</Field>
                <Field label="Placement">After “{m.placement}”</Field>
                {m.inputs.length ? (
                  <Field label="Inputs">
                    <Bullets items={m.inputs} />
                  </Field>
                ) : null}
                {m.outputs.length ? (
                  <Field label="Outputs">
                    <Bullets items={m.outputs} />
                  </Field>
                ) : null}
              </div>
              {m.data ? <Field label="Data">{m.data}</Field> : null}
              <Field label="Why it helps">{m.why}</Field>
            </div>
          ))}
        </div>
      ),
    },
    {
      id: "cover",
      icon: BRIEF_ICONS.terms,
      title: "Entities and gaps",
      count: String(brief.entities.length + brief.gaps.length),
      body: (
        <div className="flex flex-col gap-4">
          {brief.entities.length ? (
            <Field label="Entities and terms">
              <span className="flex flex-wrap gap-1.5">
                {brief.entities.map((e) => (
                  <span key={e} className="aw-tag">
                    {e}
                  </span>
                ))}
              </span>
            </Field>
          ) : null}
          {brief.gaps.length ? (
            <Field label="What the top pages miss">
              <Bullets items={brief.gaps} />
            </Field>
          ) : null}
        </div>
      ),
    },
    {
      id: "faqs",
      icon: BRIEF_ICONS.question,
      title: "FAQs",
      count: String(brief.faqs.length),
      body: (
        <dl className="flex flex-col gap-3">
          {brief.faqs.map((f) => (
            <div key={f.question}>
              <dt className="text-[14px] font-medium text-ink">{f.question}</dt>
              <dd className="text-[14px] text-body">{f.answer}</dd>
            </div>
          ))}
        </dl>
      ),
    },
    {
      id: "links",
      icon: BRIEF_ICONS.link,
      title: "Internal links and CTA",
      count: String(brief.internalLinks.length),
      body: (
        <div className="flex flex-col gap-4">
          {brief.internalLinks.length ? (
            <ul className="flex flex-col gap-2 text-[14px]">
              {brief.internalLinks.map((l) => (
                <li key={l.url + l.anchor} className="flex flex-col">
                  <a href={l.url} target="_blank" rel="noreferrer" className="aw-text-link">
                    {l.anchor}
                  </a>
                  <span className="text-[12px] text-muted">
                    {l.url} · under “{l.where}”
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {brief.cta.text ? <Field label={`CTA${brief.cta.where ? ` · ${brief.cta.where}` : ""}`}>{brief.cta.text}</Field> : null}
        </div>
      ),
    },
    {
      id: "research",
      icon: BRIEF_ICONS.globe,
      title: "Research",
      count: String(brief.research.sources.length),
      body: (
        <div className="flex flex-col gap-4">
          {brief.research.topPages ? <Field label="Google's top pages">{brief.research.topPages}</Field> : null}
          {brief.research.aiAnswers ? <Field label={`AI answers${brief.research.engines.length ? ` · ${brief.research.engines.join(", ")}` : ""}`}>{brief.research.aiAnswers}</Field> : null}
          {brief.research.questions.length ? (
            <Field label="People Also Ask">
              <Bullets items={brief.research.questions} />
            </Field>
          ) : null}
          <Field label="Sources">
            <ol className="flex flex-col gap-2">
              {brief.research.sources.map((s) => (
                <li key={s.n} className="flex min-w-0 items-start gap-2">
                  <span className="aw-num w-6 shrink-0 text-right text-[12px] text-muted">{s.n}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={favicon(s.domain)} alt="" width={16} height={16} className="mt-0.5 shrink-0" />
                  <span className="flex min-w-0 flex-col">
                    <a href={s.url} target="_blank" rel="noreferrer" className="aw-text-link truncate text-[14px]">
                      {s.title}
                    </a>
                    <span className="text-[12px] text-muted">
                      {s.domain} · {s.kind === "serp" ? `Google #${s.position ?? "–"}` : "Cited by AI"} · {s.words.toLocaleString("en-US")} words
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </Field>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      {secs.map((s) => (
        <Part key={s.id} s={s} open={open.has(s.id)} onToggle={() => toggle(s.id)} />
      ))}
    </div>
  );
}
