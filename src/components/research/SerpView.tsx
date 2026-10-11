"use client";

import type { Serp } from "@/lib/briefTypes";
import { BrandLogo } from "../BrandLogo";
import { favicon } from "../ui";
import { SerpTags } from "./shared";

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Google's top 10 for one keyword: what the winning pages look like, what Google shows, and what people ask. */
export function SerpView({ serp, at, country }: { serp: Serp; at: string | null; country: string }) {
  const read = serp.pages.filter((p) => p.read);
  const words = avg(read.map((p) => p.words).filter((w) => w > 0));
  const h2s = avg(read.map((p) => p.headings.filter((h) => h.startsWith("H2")).length));
  const withTables = read.filter((p) => p.tables > 0).length;
  const schema = [...read.flatMap((p) => p.schema).reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return (
    <div className="flex flex-col gap-4">
      <div className="aw-stats aw-stats--tight" style={{ ["--cols" as string]: 4 }}>
        {[
          ["Avg. words", words === null ? "–" : words.toLocaleString("en-US")],
          ["Avg. H2 sections", h2s === null ? "–" : String(h2s)],
          ["Pages with tables", `${withTables} of ${read.length}`],
          ["AI Overview", serp.aiOverview.shown ? "Shown" : "Not shown"],
        ].map(([lab, v]) => (
          <div key={lab} className="aw-stat">
            <div className="aw-stat__lab">{lab}</div>
            <span className="aw-stat__num">{v}</span>
          </div>
        ))}
      </div>

      <section className="aw-frame">
        <div className="aw-frame__head flex-wrap justify-between gap-2">
          <h3 className="aw-h4">Google&apos;s top {serp.pages.length} · {country}</h3>
          <span className="flex items-center gap-3">
            <SerpTags serp={serp.features} />
            {at ? <span className="aw-small">Checked {new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span> : null}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="aw-table aw-table--compact">
            <thead>
              <tr>
                <th className="w-10">#</th>
                <th>Page</th>
                <th className="w-20">Words</th>
                <th className="w-16">H2s</th>
                <th className="w-16">Tables</th>
                <th className="w-16">Images</th>
                <th className="w-16">Video</th>
                <th className="w-40">Schema</th>
                <th className="w-24">Updated</th>
              </tr>
            </thead>
            <tbody>
              {serp.pages.map((p) => (
                <tr key={p.url}>
                  <td className="aw-num text-muted">{p.rank}</td>
                  <td className="max-w-0">
                    <span className="flex min-w-0 flex-col">
                      <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-[14px]" title={p.title}>
                        {p.title || p.domain}
                      </a>
                      <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
                        <BrandLogo src={favicon(p.domain)} name={p.domain} size={12} />
                        <span className="truncate">{p.domain}</span>
                        {!p.read ? <span className="aw-chip">Could not read</span> : null}
                      </span>
                    </span>
                  </td>
                  <td className="aw-num">{p.read ? p.words.toLocaleString("en-US") : "–"}</td>
                  <td className="aw-num">{p.read ? p.headings.filter((h) => h.startsWith("H2")).length : "–"}</td>
                  <td className="aw-num">{p.read ? p.tables : "–"}</td>
                  <td className="aw-num">{p.read ? p.images : "–"}</td>
                  <td className="aw-num">{p.read ? p.videos : "–"}</td>
                  <td className="truncate text-[12px] text-body">{p.schema.slice(0, 3).join(", ") || "–"}</td>
                  <td className="aw-num text-muted">{p.updated ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="aw-frame">
          <div className="aw-frame__head">
            <h3 className="aw-h4">People also ask</h3>
          </div>
          <ul className="flex flex-col gap-1.5 p-4 text-[14px] text-ink">
            {serp.questions.length ? serp.questions.map((q) => <li key={q}>{q}</li>) : <li className="aw-small">None on this page.</li>}
          </ul>
        </section>
        <section className="aw-frame">
          <div className="aw-frame__head">
            <h3 className="aw-h4">Related searches</h3>
          </div>
          <ul className="flex flex-col gap-1.5 p-4 text-[14px] text-ink">
            {serp.related.length ? serp.related.map((q) => <li key={q}>{q}</li>) : <li className="aw-small">None on this page.</li>}
          </ul>
        </section>
        <section className="aw-frame">
          <div className="aw-frame__head">
            <h3 className="aw-h4">Common schema</h3>
          </div>
          <ul className="flex flex-col gap-1.5 p-4 text-[14px] text-ink">
            {schema.length ? (
              schema.map(([t, n]) => (
                <li key={t} className="flex justify-between gap-3">
                  {t}
                  <span className="aw-num text-muted">
                    {n} of {read.length}
                  </span>
                </li>
              ))
            ) : (
              <li className="aw-small">No schema found.</li>
            )}
          </ul>
        </section>
      </div>

      {serp.aiOverview.shown ? (
        <section className="aw-frame">
          <div className="aw-frame__head">
            <h3 className="aw-h4">Google&apos;s AI Overview</h3>
          </div>
          <div className="flex flex-col gap-3 p-4">
            <p className="text-[14px] whitespace-pre-line text-body">{serp.aiOverview.text.slice(0, 1200) || "Shown, with no text saved."}</p>
            {serp.aiOverview.cites.length ? (
              <div className="flex flex-wrap gap-1.5">
                {serp.aiOverview.cites.map((c) => (
                  <a key={c.url} href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="aw-chip text-[12px]!">
                    {c.domain}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
