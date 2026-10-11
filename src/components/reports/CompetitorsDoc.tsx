"use client";

// The Competitive analysis table and quadrant as a read-only report, for share links and PDF.
import { useState } from "react";
import type { CompetitorsSnapshot } from "@/lib/reportTypes";
import { BrandLogo } from "../BrandLogo";
import { Quadrant, type Dot } from "../CompetitorsPage";

const pct = (n: number) => `${Math.round(n)}%`;
const favicon = (d: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`;
const guess = (n: string) => `${n.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`;

export function CompetitorsDoc({ r }: { r: CompetitorsSnapshot }) {
  const [hover, setHover] = useState<string | null>(null);
  const [sort, setSort] = useState<"visibility" | "position">("visibility");
  const dots: Dot[] = r.rows
    .filter((x): x is typeof x & { position: number } => x.position !== null)
    .slice(0, 15)
    .map((x) => ({ name: x.name, domain: x.domain, isYou: x.isYou, visibility: x.visibility, position: x.position }));
  const best = [...r.rows].filter((x) => x.position !== null).sort((a, b) => b.visibility - a.visibility || a.position! - b.position!)[0]?.name ?? null;
  const rows = [...r.rows].sort((a, b) => (sort === "visibility" ? b.visibility - a.visibility : (a.position ?? 99) - (b.position ?? 99)));
  const logoOf = (x: CompetitorsSnapshot["rows"][number]) => (x.isYou && r.brand.logo ? r.brand.logo : favicon(x.domain || guess(x.name)));

  return (
    <article className="mx-auto flex max-w-6xl flex-col gap-6 bg-white p-8 print:max-w-none print:p-0">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-rule pb-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a remote logo on a static report */}
          {r.brand.logo ? <img src={r.brand.logo} alt="" width={36} height={36} className="h-9 w-9 object-contain" /> : null}
          <div className="flex flex-col">
            <h1 className="text-[24px] font-medium text-ink">{r.brand.name}: competitive analysis in AI answers</h1>
            <span className="aw-small">
              {r.brand.domain} · last {r.days} days · as of {new Date(r.at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </span>
          </div>
        </div>
      </header>

      <section className="aw-frame break-inside-avoid">
        <div className="h-[560px]">
          <Quadrant dots={dots} logo={r.brand.logo} hover={hover} onHover={setHover} crown={best} />
        </div>
      </section>

      <table className="aw-table">
        <thead>
          <tr>
            <th className="w-10">#</th>
            <th>Brand</th>
            <th className="w-36">
              <button type="button" onClick={() => setSort("visibility")} className={sort === "visibility" ? "text-ink" : ""}>
                Visibility {sort === "visibility" ? "↓" : ""}
              </button>
            </th>
            <th className="w-36">
              <button type="button" onClick={() => setSort("position")} className={sort === "position" ? "text-ink" : ""}>
                Position {sort === "position" ? "↑" : ""}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x, i) => (
            <tr key={x.name} className={x.isYou ? "is-you" : ""} onMouseEnter={() => setHover(x.name)} onMouseLeave={() => setHover(null)}>
              <td className="aw-num text-muted">{i + 1}</td>
              <td>
                <span className="flex items-center gap-2 font-medium text-ink">
                  {best === x.name ? <span aria-label="Best brand">👑</span> : null}
                  <BrandLogo src={logoOf(x)} name={x.name} size={20} />
                  {x.name}
                  {x.isYou ? <span className="aw-badge">You</span> : null}
                </span>
              </td>
              <td className="aw-num">{pct(x.visibility)}</td>
              <td className="aw-num">{x.position === null ? "–" : `#${x.position.toFixed(1)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="aw-small">Visibility is the share of AI answers that name the brand. Position is its average spot in the list of brands an answer names. Made with Arrowsterr.</p>
    </article>
  );
}
