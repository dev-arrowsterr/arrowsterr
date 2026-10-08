"use client";

import { useState } from "react";
import { answered, brandStats, competitorDomains, domainRows, SOURCE_TYPES, typeShares, urlRows, type SourceType } from "@/lib/metrics";
import type { View } from "@/lib/view";
import { BrandLogo } from "./BrandLogo";
import { Donut, Legend } from "./Donut";
import { TYPE_COLORS, TypeTag } from "./OverviewPage";
import { Card, Empty, favicon, pct } from "./ui";

/** Every site (or page) the AI answers cite, with its type and how often it shows up. */
export function SourcesPage({ view, mode }: { view: View; mode: "domains" | "urls" }) {
  const { brand, current, filter, days } = view;
  const [type, setType] = useState<SourceType | "All">("All");
  const chats = answered(current, filter);
  if (!chats.length) return <Empty>No results in the last {days} days. Click Run now, or wait for the daily run.</Empty>;
  const comp = competitorDomains(brandStats(chats, { name: brand.name, domain: brand.domain }));
  const domains = domainRows(chats, brand.domain, comp);
  const urls = urlRows(chats, brand.domain, comp);
  const shares = typeShares(domains);
  const counts = new Map(SOURCE_TYPES.map((t) => [t, (mode === "domains" ? domains : urls).filter((r) => r.type === t).length]));

  const chips = (
    <div className="flex flex-wrap gap-2">
      {(["All", ...SOURCE_TYPES] as const).map((t) =>
        t === "All" || counts.get(t) ? (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            aria-pressed={type === t}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium ${type === t ? "border-brand bg-brand-bg text-brand" : "border-rule bg-white text-body hover:border-brand-mist"}`}
          >
            {t !== "All" ? <i className="inline-block h-2 w-2 rounded-full" style={{ background: TYPE_COLORS[t] }} /> : null}
            {t}
            <span className="text-muted">{t === "All" ? (mode === "domains" ? domains.length : urls.length) : counts.get(t)}</span>
          </button>
        ) : null,
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <h1 className="aw-h2">{mode === "domains" ? "Domains" : "URLs"}</h1>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          {chips}
          <div className="aw-table-wrap">
            {mode === "domains" ? (
              <table className="aw-table aw-table--compact">
                <thead>
                  <tr>
                    <th className="w-8">#</th>
                    <th>Domain</th>
                    <th>Type</th>
                    <th>Used</th>
                    <th>Answers</th>
                    <th>Avg. citations</th>
                  </tr>
                </thead>
                <tbody>
                  {domains
                    .filter((d) => type === "All" || d.type === type)
                    .map((d, i) => (
                      <tr key={d.domain} className={d.type === "You" ? "is-you" : ""}>
                        <td className="aw-num text-muted">{i + 1}</td>
                        <td>
                          <a href={`https://${d.domain}`} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-2">
                            <BrandLogo src={favicon(d.domain)} name={d.domain} size={18} />
                            {d.domain}
                          </a>
                        </td>
                        <td>
                          <TypeTag type={d.type} />
                        </td>
                        <td className="aw-num">{pct(d.used)}</td>
                        <td className="aw-num">{d.chats}</td>
                        <td className="aw-num">{d.avgCitations.toFixed(1)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : (
              <table className="aw-table aw-table--compact">
                <thead>
                  <tr>
                    <th className="w-8">#</th>
                    <th>URL</th>
                    <th>Type</th>
                    <th>Used</th>
                    <th>Prompts</th>
                  </tr>
                </thead>
                <tbody>
                  {urls
                    .filter((u) => type === "All" || u.type === type)
                    .slice(0, 300)
                    .map((u, i) => (
                      <tr key={u.url} className={u.type === "You" ? "is-you" : ""}>
                        <td className="aw-num text-muted">{i + 1}</td>
                        <td className="max-w-xl">
                          <a href={u.url} target="_blank" rel="noopener noreferrer nofollow" className="flex min-w-0 items-center gap-2">
                            <BrandLogo src={favicon(u.domain)} name={u.domain} size={18} />
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate">{u.title || u.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                              <span className="truncate text-[12px] text-muted">{u.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                            </span>
                          </a>
                        </td>
                        <td>
                          <TypeTag type={u.type} />
                        </td>
                        <td className="aw-num">{pct(u.used)}</td>
                        <td className="aw-num" title={u.prompts.join("\n")}>
                          {u.prompts.length}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <Card title="Domains by type" className="self-start">
          <div className="flex flex-col items-center gap-5 p-5">
            <Donut
              label="Share of citations by site type"
              slices={shares.map((s) => ({ label: s.type, value: s.share, color: TYPE_COLORS[s.type] }))}
              center={
                <>
                  <span className="aw-num text-[24px] font-semibold text-ink">{pct(shares.find((s) => s.type === "You")?.share ?? 0)}</span>
                  <span className="text-[11px] text-muted">your site</span>
                </>
              }
            />
            <Legend slices={shares.filter((s) => s.share > 0).map((s) => ({ label: s.type, value: s.share, color: TYPE_COLORS[s.type] }))} />
          </div>
          <p className="aw-micro px-5 pb-4">
            UGC: forums and social. Reviews: review sites. Editorial: news, blogs and guides. Reference: Wikipedia and public sources. Corporate: other company sites.
          </p>
        </Card>
      </div>
    </div>
  );
}
