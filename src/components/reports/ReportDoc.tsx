"use client";

import type { ReportSnapshot } from "@/lib/reportTypes";

const num = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("en-US"));
const pctOf = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${Math.round(n)}%`);

function Change({ now, before, unit = "", lowerIsBetter = false }: { now: number | null; before: number | null; unit?: string; lowerIsBetter?: boolean }) {
  if (now === null || before === null) return null;
  const d = Math.round((now - before) * 10) / 10;
  if (!d) return <span className="text-[12px] text-muted">no change</span>;
  const good = lowerIsBetter ? d < 0 : d > 0;
  return (
    <span className={`text-[12px] font-medium ${good ? "text-pos" : "text-neg"}`}>
      {d > 0 ? "↗ +" : "↘ "}
      {d}
      {unit}
    </span>
  );
}

function Tile({ label, value, change }: { label: string; value: React.ReactNode; change?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border border-rule bg-white p-4">
      <span className="aw-label">{label}</span>
      <span className="aw-num text-[28px] leading-none text-ink">{value}</span>
      {change ?? null}
    </div>
  );
}

function H({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 border-b-2 pb-2 text-[20px] font-semibold text-ink" style={{ borderColor: color }}>
      {children}
    </h2>
  );
}

/** A clean, printable client report. The same component renders the preview, the PDF and the shared link. */
export function ReportDoc({ r }: { r: ReportSnapshot }) {
  const color = /^#[0-9a-f]{3,8}$/i.test(r.style.color) ? r.style.color : "#0943B0";
  const has = (s: ReportSnapshot["sections"][number]) => r.sections.includes(s);
  return (
    <article className="aw-report mx-auto flex max-w-[900px] flex-col gap-8 bg-white p-8 sm:p-10">
      <header className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-3">
            {r.style.logo ? (
              // Logos come from any address the agency uses. A plain img keeps the report simple to print.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.style.logo} alt="" className="h-9 max-w-40 object-contain" />
            ) : null}
            {r.style.agency ? <span className="text-[15px] font-medium text-ink">{r.style.agency}</span> : null}
          </span>
          <span className="aw-label">Performance report</span>
        </div>
        <div className="flex flex-col gap-1 border-l-4 pl-4" style={{ borderColor: color }}>
          <h1 className="text-[34px] font-semibold leading-tight text-ink">{r.brand.name}</h1>
          <span className="text-[14px] text-body">
            {r.brand.domain} · last {r.days} days, compared with the {r.days} days before · {new Date(r.at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </span>
        </div>
      </header>

      {r.summary ? (
        <section className="flex flex-col gap-3 p-5" style={{ background: `${color}0f` }}>
          <p className="text-[18px] font-medium text-ink">{r.summary.headline}</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[14px] text-body">
            {r.summary.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {r.summary.next.length ? (
            <div>
              <span className="aw-label">Next steps</span>
              <ol className="mt-1 flex list-decimal flex-col gap-1 pl-5 text-[14px] text-ink">
                {r.summary.next.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </section>
      ) : null}

      {r.wins.length || r.drops.length ? (
        <section className="grid gap-4 sm:grid-cols-2">
          {[
            { title: "Top wins", list: r.wins },
            { title: "Watch list", list: r.drops },
          ].map((box) => (
            <div key={box.title} className="border border-rule">
              <div className="border-b border-rule bg-surface-2 px-4 py-2 text-[14px] font-medium text-ink">{box.title}</div>
              <ul className="divide-y divide-rule-faint">
                {box.list.map((c) => (
                  <li key={c.text} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                    <span className="text-ink">{c.text}</span>
                    <span className={`aw-num ${c.change > 0 ? "text-pos" : "text-neg"}`}>
                      {c.change > 0 ? "+" : ""}
                      {c.change}
                      {c.unit}
                    </span>
                  </li>
                ))}
                {!box.list.length ? <li className="px-4 py-2.5 text-[13px] text-muted">Nothing to report.</li> : null}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      {has("ai") && r.ai ? (
        <section>
          <H color={color}>AI visibility</H>
          <p className="mb-3 text-[13px] text-body">How often ChatGPT, Gemini, Google AI and others name {r.brand.name} when people ask for recommendations. Based on {num(r.ai.answers)} AI answers.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Visibility" value={pctOf(r.ai.visibility)} change={<Change now={r.ai.visibility} before={r.ai.visibilityBefore} unit=" pts" />} />
            <Tile label="Sentiment" value={r.ai.sentiment === null ? "–" : Math.round(r.ai.sentiment)} />
            <Tile label="Avg. position" value={r.ai.position === null ? "–" : `#${r.ai.position.toFixed(1)}`} />
            <Tile label="Rank" value={r.ai.rank ? `#${r.ai.rank}` : "–"} change={<span className="text-[12px] text-muted">of {r.ai.brands} brands</span>} />
          </div>
          {r.ai.byModel.length ? (
            <table className="mt-3 w-full text-[13px]">
              <thead>
                <tr className="border-b border-rule text-left">
                  <th className="py-2 font-medium text-muted">AI model</th>
                  <th className="py-2 text-right font-medium text-muted">Visibility</th>
                  <th className="py-2 text-right font-medium text-muted">Change</th>
                </tr>
              </thead>
              <tbody>
                {r.ai.byModel.map((m) => (
                  <tr key={m.engine} className="border-b border-rule-faint">
                    <td className="py-2 text-ink">{m.engine}</td>
                    <td className="aw-num py-2 text-right">{pctOf(m.now)}</td>
                    <td className="py-2 text-right">
                      <Change now={m.now} before={m.before} unit=" pts" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}

      {has("competitors") && r.competitors?.length ? (
        <section>
          <H color={color}>Competitors in AI answers</H>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="w-8 py-2 font-medium text-muted">#</th>
                <th className="py-2 font-medium text-muted">Brand</th>
                <th className="py-2 text-right font-medium text-muted">Visibility</th>
                <th className="py-2 text-right font-medium text-muted">Sentiment</th>
                <th className="py-2 text-right font-medium text-muted">Position</th>
              </tr>
            </thead>
            <tbody>
              {r.competitors.map((c, i) => (
                <tr key={c.name} className="border-b border-rule-faint" style={c.isYou ? { background: `${color}12` } : undefined}>
                  <td className="aw-num py-2 text-muted">{i + 1}</td>
                  <td className="py-2 text-ink">
                    {c.name}
                    {c.isYou ? <span className="ml-2 text-[11px] font-medium" style={{ color }}>YOU</span> : null}
                  </td>
                  <td className="aw-num py-2 text-right">{pctOf(c.visibility)}</td>
                  <td className="aw-num py-2 text-right">{c.sentiment === null ? "–" : Math.round(c.sentiment)}</td>
                  <td className="aw-num py-2 text-right">{c.position === null ? "–" : `#${c.position.toFixed(1)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {has("traffic") && r.traffic ? (
        <section>
          <H color={color}>Website traffic</H>
          <div className="grid grid-cols-2 gap-3">
            <Tile label="Visits" value={num(r.traffic.visits)} change={<Change now={r.traffic.visits} before={r.traffic.visitsBefore} />} />
            <Tile label="Visits from AI assistants" value={num(r.traffic.ai)} change={<Change now={r.traffic.ai} before={r.traffic.aiBefore} />} />
          </div>
          {r.traffic.byEngine.some((e) => e.visits || e.prev) ? (
            <ul className="mt-3 flex flex-col gap-2">
              {r.traffic.byEngine
                .filter((e) => e.visits || e.prev)
                .map((e) => (
                  <li key={e.engine} className="grid grid-cols-[120px_1fr_60px] items-center gap-3 text-[13px]">
                    <span className="text-ink">{e.engine}</span>
                    <span className="h-2 bg-rule-faint">
                      <span className="block h-full" style={{ width: `${r.traffic!.ai ? (e.visits / r.traffic!.ai) * 100 : 0}%`, background: color }} />
                    </span>
                    <span className="aw-num text-right text-ink">{num(e.visits)}</span>
                  </li>
                ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {has("visitors") && r.visitors ? (
        <section>
          <H color={color}>Visitors and leads</H>
          <div className="grid grid-cols-3 gap-3">
            <Tile label="Visitors" value={num(r.visitors.total)} />
            <Tile label="Hot buyers" value={num(r.visitors.hot)} />
            <Tile label="Took a key action" value={num(r.visitors.actions)} />
          </div>
          {r.visitors.top.length ? (
            <table className="mt-3 w-full text-[13px]">
              <thead>
                <tr className="border-b border-rule text-left">
                  <th className="py-2 font-medium text-muted">Top visitors</th>
                  <th className="py-2 font-medium text-muted">Came from</th>
                  <th className="py-2 text-right font-medium text-muted">Buyer score</th>
                </tr>
              </thead>
              <tbody>
                {r.visitors.top.map((v) => (
                  <tr key={v.name} className="border-b border-rule-faint">
                    <td className="py-2 text-ink">
                      {v.emoji} {v.name}
                    </td>
                    <td className="py-2 text-body">{v.source}</td>
                    <td className="aw-num py-2 text-right">
                      {v.score} · {v.label}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}

      {has("content") && r.content ? (
        <section>
          <H color={color}>Content</H>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Published" value={r.content.published} />
            <Tile label="Writing" value={r.content.writing} />
            <Tile label="Briefs ready" value={r.content.briefs} />
            <Tile label="Planned" value={r.content.planned} />
          </div>
          {r.content.pages.length ? (
            <table className="mt-3 w-full text-[13px]">
              <thead>
                <tr className="border-b border-rule text-left">
                  <th className="py-2 font-medium text-muted">Published page</th>
                  <th className="py-2 text-right font-medium text-muted">Cited by AI</th>
                  <th className="py-2 text-right font-medium text-muted">Visits</th>
                  <th className="py-2 text-right font-medium text-muted">From AI</th>
                </tr>
              </thead>
              <tbody>
                {r.content.pages.slice(0, 15).map((p) => (
                  <tr key={p.id} className="border-b border-rule-faint">
                    <td className="py-2">
                      <span className="block text-ink">{p.keyword}</span>
                      <span className="text-[11px] text-muted">{p.path}</span>
                    </td>
                    <td className="aw-num py-2 text-right">{p.cited === null ? "–" : p.cited ? pctOf(p.cited) : "Not yet"}</td>
                    <td className="aw-num py-2 text-right">{num(p.visits)}</td>
                    <td className="aw-num py-2 text-right">{num(p.aiVisits)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}

      <footer className="border-t border-rule pt-4 text-[11px] text-muted">
        {r.style.agency ? `Prepared by ${r.style.agency}. ` : ""}Data from AI answer checks and website tracking for {r.brand.domain}.
      </footer>
    </article>
  );
}
