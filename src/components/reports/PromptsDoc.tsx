"use client";

// The Prompts page as a read-only report, for share links and PDF. Click a prompt for its deep dive.
import { useEffect, useState } from "react";
import type { PromptDetailSnap, PromptsSnapshot } from "@/lib/reportTypes";
import { BrandLogo } from "../BrandLogo";
import { ENGINE_LOGOS, EngineName } from "../Engines";
import { Markdown } from "../Markdown";

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${Math.round(n)}%`);
const SHORT: Record<string, string> = { "AI Overview": "AIO" };

const favicon = (d: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`;
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

export function PromptsDoc({ r }: { r: PromptsSnapshot }) {
  const s = r.scores;
  const [open, setOpen] = useState<{ prompt: string; topic: string; detail: PromptDetailSnap[] } | null>(null);
  return (
    <article className="mx-auto flex max-w-6xl flex-col gap-6 bg-white p-8 print:max-w-none print:p-0">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-rule pb-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a remote logo on a static report */}
          {r.brand.logo ? <img src={r.brand.logo} alt="" width={36} height={36} className="h-9 w-9 object-contain" /> : null}
          <div className="flex flex-col">
            <h1 className="text-[24px] font-medium text-ink">{r.brand.name}: AI visibility by prompt</h1>
            <span className="aw-small">
              {r.brand.domain} · last {r.days} days · as of {new Date(r.at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </span>
          </div>
        </div>
      </header>

      {s ? (
        <div className="grid gap-px border border-rule bg-rule sm:grid-cols-3">
          {[
            { lab: "Visibility", v: `${Math.round(s.visibility)}`, help: "Share of AI answers that name you" },
            { lab: "Sentiment", v: s.sentiment === null ? "–" : `${Math.round(s.sentiment)}`, help: "How well AI talks about you" },
            { lab: "Position", v: s.position === null ? "–" : `#${s.position.toFixed(1)}`, help: s.rank ? `Rank ${s.rank} of ${s.of} brands by visibility` : "Average spot in the list" },
          ].map((m) => (
            <div key={m.lab} className="flex flex-col gap-2 bg-white p-5">
              <span className="aw-label">{m.lab}</span>
              <span className="aw-num text-[32px] leading-none text-ink">{m.v}</span>
              <span className="aw-small">{m.help}</span>
            </div>
          ))}
        </div>
      ) : null}

      <table className="aw-table aw-table--compact aw-table--tight">
        <thead>
          <tr>
            <th>Topic and prompt</th>
            <th>Visibility</th>
            {r.engines.map((e) => (
              <th key={e}>{SHORT[e] ?? e}</th>
            ))}
          </tr>
        </thead>
        {r.topics.map((t) => (
          <tbody key={t.name} className="break-inside-avoid">
            <tr className="bg-surface-2">
              <td className="font-medium text-ink">{t.name}</td>
              <td className="aw-num text-ink">{pct(t.visibility)}</td>
              {r.engines.map((e) => (
                <td key={e} className="aw-num">
                  {pct(t.byEngine[e])}
                </td>
              ))}
            </tr>
            {t.prompts.map((p) => (
              <tr
                key={p.prompt}
                className={p.detail?.length ? "cursor-pointer hover:bg-brand-pale" : ""}
                onClick={() => p.detail?.length && setOpen({ prompt: p.prompt, topic: t.name, detail: p.detail })}
              >
                <td className="pl-6! text-ink">
                  {p.prompt}
                  {p.detail?.length ? <span className="ml-2 text-muted print:hidden">›</span> : null}
                </td>
                <td className="aw-num">{pct(p.visibility)}</td>
                {r.engines.map((e) => (
                  <td key={e} className="aw-num">
                    {p.ranks[e] ? <span className="aw-status aw-status--ranked px-1.5! py-0.5! text-[12px]!">#{p.ranks[e]}</span> : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <p className="aw-small">
        #N is the brand&apos;s spot in the list of brands the AI answer named. Blank means it did not name the brand. Click a prompt to see each AI&apos;s full answer. Made with Arrowsterr.
      </p>
      {open ? <PromptDive brand={r.brand.name} {...open} onClose={() => setOpen(null)} /> : null}
    </article>
  );
}

/** One prompt in depth: each model's rank, the brands it named, the sites it linked and its full answer. */
function PromptDive({ brand, prompt, topic, detail, onClose }: { brand: string; prompt: string; topic: string; detail: PromptDetailSnap[]; onClose: () => void }) {
  const [tab, setTab] = useState(detail[0].engine);
  const cur = detail.find((d) => d.engine === tab) ?? detail[0];
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(16,20,30,0.45)] print:hidden" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={prompt} onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-[1100px] flex-col gap-6 overflow-y-auto bg-white px-6 py-6 md:px-10">
        <div className="flex items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="aw-micro">Prompt · {topic}</span>
            <h2 className="text-[24px] leading-snug font-medium text-ink">{prompt}</h2>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="px-2 py-1 text-[26px] leading-none text-body hover:text-ink">
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-3 xl:grid-cols-[repeat(var(--n),minmax(0,1fr))]" style={{ ["--n" as string]: detail.length }} role="tablist" aria-label="Model">
          {detail.map((e) => (
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
              <span className="aw-small">{e.rank === null ? `${brand} not named` : e.sentiment !== null ? `Sentiment ${Math.round(e.sentiment)}` : "\u00a0"}</span>
            </button>
          ))}
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <section className="aw-frame self-start">
            <div className="border-b border-rule-faint px-4 py-3">
              <span className="aw-label">Brands named</span>
            </div>
            <table className="aw-table aw-table--compact aw-table--tight">
              <tbody>
                {cur.brands.map((b) => (
                  <tr key={b.name} className={b.isYou ? "is-you" : ""}>
                    <td className="aw-num w-10 text-muted">#{b.position}</td>
                    <td>
                      <span className="flex items-center gap-2 text-ink">
                        <BrandLogo src={favicon(b.domain || `${b.name.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`)} name={b.name} size={16} />
                        {b.name}
                        {b.isYou ? <span className="aw-badge">You</span> : null}
                      </span>
                    </td>
                  </tr>
                ))}
                {!cur.brands.length ? (
                  <tr>
                    <td className="aw-small">No brands named.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>

          <section className="aw-frame self-start">
            <div className="border-b border-rule-faint px-4 py-3">
              <span className="aw-label">Linked sites</span>
            </div>
            <ol className="divide-y divide-rule-faint">
              {cur.sources.map((x, i) => (
                <li key={x.url} className={`flex gap-3 px-4 py-2.5 ${x.isYou ? "bg-brand-pale" : ""}`}>
                  <span className="aw-num w-7 shrink-0 text-[13px] text-muted">#{i + 1}</span>
                  <span className="flex min-w-0 flex-col">
                    <a href={x.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-[14px]">
                      {x.title || shortUrl(x.url)}
                    </a>
                    <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
                      <BrandLogo src={favicon(x.domain)} name={x.domain} size={12} />
                      <span className="truncate">{shortUrl(x.url)}</span>
                    </span>
                  </span>
                </li>
              ))}
              {!cur.sources.length ? <li className="aw-small px-4 py-4">No sites linked.</li> : null}
            </ol>
          </section>
        </div>

        <section className="aw-frame">
          <div className="flex items-center justify-between gap-3 border-b border-rule-faint px-4 py-3">
            <span className="flex items-center gap-2">
              <BrandLogo src={ENGINE_LOGOS[cur.engine] ?? ""} name={cur.engine} size={14} />
              <span className="aw-label">Full answer</span>
            </span>
            {cur.at ? <span className="aw-small">{new Date(cur.at).toLocaleString()}</span> : null}
          </div>
          <div className="px-5 py-4">{cur.text ? <Markdown text={cur.text} /> : <span className="aw-small">No full answer saved.</span>}</div>
        </section>
      </div>
    </div>
  );
}
