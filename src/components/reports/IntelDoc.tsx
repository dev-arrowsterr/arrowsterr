"use client";

// Content Intelligence as a read-only report, for share links and PDF.
import { TAG_COLOR, TAG_HELP, type Tag } from "@/lib/intel";
import type { IntelSnapshot } from "@/lib/reportTypes";

const num = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);

export function IntelDoc({ r }: { r: IntelSnapshot }) {
  const max = Math.max(1, ...r.byTag.map((t) => t.pages));
  const top = r.rows.slice(0, 15);
  const next = r.rows.filter((x) => x.tag === "Striking distance" && x.keyword).slice(0, 5);
  const k = r.keywords;
  return (
    <article className="mx-auto flex max-w-6xl flex-col gap-6 bg-white p-8 print:max-w-none print:p-0">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-rule pb-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a remote logo on a static report */}
          {r.brand.logo ? <img src={r.brand.logo} alt="" width={36} height={36} className="h-9 w-9 object-contain" /> : null}
          <div className="flex flex-col">
            <h1 className="text-[24px] font-medium text-ink">{r.brand.name}: content intelligence</h1>
            <span className="aw-small">
              {r.brand.domain} · {r.linked ? `last ${r.days} days` : "estimated monthly visits"} · as of{" "}
              {new Date(r.at).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        </div>
        {r.sample ? <span className="aw-status aw-status--warn">Sample report</span> : null}
      </header>

      {r.sample ? <p className="aw-callout text-[14px]">This is a sample with example numbers. Open Content Intelligence once to load {r.brand.domain}, and this report fills with real pages.</p> : null}

      <div className="grid gap-px border border-rule bg-rule sm:grid-cols-4">
        {[
          {
            lab: "Pages",
            v: num(r.totals.pages),
            help: "Pages Google or your analytics know about",
          },
          {
            lab: r.linked ? "Views" : "Est. visits / mo",
            v: num(r.totals.visits),
            help: r.linked ? `Last ${r.days} days` : "From Google rankings",
          },
          {
            lab: "Striking distance",
            v: num(r.byTag.find((t) => t.tag === "Striking distance")?.pages ?? 0),
            help: "Pages one update away from page one",
          },
          {
            lab: "Cited by AI",
            v: r.totals.cited === null ? "–" : num(r.totals.cited),
            help: "Pages AI answers link to",
          },
        ].map((m) => (
          <div key={m.lab} className="flex flex-col gap-2 bg-white p-5">
            <span className="aw-label">{m.lab}</span>
            <span className="aw-num text-[32px] leading-none text-ink">{m.v}</span>
            <span className="aw-small">{m.help}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="aw-frame break-inside-avoid p-5">
          <span className="aw-label">Pages by performance</span>
          <ul className="mt-4 flex flex-col gap-2.5">
            {r.byTag.map((t) => (
              <li key={t.tag} className="grid grid-cols-[150px_1fr] items-center gap-3 text-[13px]" title={TAG_HELP[t.tag as Tag]}>
                <span className="text-ink">{t.tag}</span>
                <span className="flex items-center gap-2">
                  <span
                    className="h-3 rounded-r-[4px]"
                    style={{
                      width: t.pages ? `${Math.max(1.5, (t.pages / max) * 100)}%` : 0,
                      background: TAG_COLOR[t.tag as Tag],
                    }}
                  />
                  <span className="aw-num text-[12px] text-ink">{t.pages}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="aw-frame break-inside-avoid p-5">
          <span className="aw-label">Where your keywords rank on Google</span>
          {k.all ? (
            <>
              <div className="mt-4 flex h-4 w-full gap-[2px] overflow-hidden rounded-[4px]">
                {[
                  [k.top3, "#0943B0"],
                  [k.top10 - k.top3, "#7E9BDD"],
                  [k.all - k.top10, "#DDE4F5"],
                ].map(([v, c]) => (Number(v) > 0 ? <span key={String(c)} style={{ flex: Number(v), background: String(c) }} /> : null))}
              </div>
              <ul className="mt-3 flex flex-col gap-1.5 text-[13px] text-ink">
                {[
                  ["Top 3", k.top3, "#0943B0"],
                  ["#4 to #10", k.top10 - k.top3, "#7E9BDD"],
                  ["Below #10", k.all - k.top10, "#DDE4F5"],
                ].map(([l, v, c]) => (
                  <li key={String(l)} className="flex items-center gap-2">
                    <i className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: String(c) }} />
                    {l}
                    <span className="aw-num ml-auto">{num(Number(v))}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="aw-small mt-4">No keywords on Google yet.</p>
          )}
        </section>
      </div>

      {next.length ? (
        <section className="aw-frame break-inside-avoid p-5">
          <span className="aw-label">Update these next</span>
          <ol className="mt-3 flex flex-col divide-y divide-rule-faint">
            {next.map((x) => (
              <li key={x.path} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 text-[14px]">
                <a href={x.url} target="_blank" rel="noopener noreferrer" className="font-medium">
                  {x.path}
                </a>
                <span className="text-body">
                  ranks #{x.rank} for &quot;{x.keyword}&quot; ({num(x.volume)} searches a month). A content update can lift it into the top 3.
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <table className="aw-table aw-table--compact">
        <thead>
          <tr>
            <th>Page</th>
            <th>Performance</th>
            <th>{r.linked ? "Views" : "Est. visits"}</th>
            {r.linked ? <th>From AI</th> : null}
            <th>Cited by AI</th>
            <th>Best keyword</th>
            <th>Position</th>
          </tr>
        </thead>
        <tbody>
          {top.map((x) => (
            <tr key={x.path}>
              <td className="max-w-72 truncate text-ink" title={x.url}>
                {x.path}
              </td>
              <td>
                <span className="inline-flex items-center gap-1.5 text-[13px]">
                  <i className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: TAG_COLOR[x.tag as Tag] }} />
                  {x.tag}
                </span>
              </td>
              <td className="aw-num">{num(x.visits)}</td>
              {r.linked ? <td className="aw-num">{num(x.ai)}</td> : null}
              <td className="aw-num">{x.cited === null ? "–" : x.cited ? `${Math.round(x.cited)}%` : "–"}</td>
              <td className="max-w-56 truncate">{x.keyword ?? "–"}</td>
              <td className="aw-num">{x.rank ? `#${x.rank}` : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="aw-small">
        Top {top.length} of {r.totals.pages} pages by visits. Google numbers come from SEO data. Cited by AI is the share of AI answers that link to the page. Made with Arrowsterr.
      </p>
    </article>
  );
}
