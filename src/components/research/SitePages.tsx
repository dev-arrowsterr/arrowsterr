"use client";

import { useEffect, useState } from "react";
import type { CalendarItem, Site } from "@/lib/db";
import type { PagePerf } from "@/lib/research";
import type { RunAuth } from "@/lib/runner";
import { useStash } from "@/lib/stash";
import { Sheet, type Col } from "../Sheet";
import { Card, Thinking } from "../ui";
import { flag, short } from "./KeywordOverview";
import { downloadCsv, post } from "./shared";

const strip = (u: string | null | undefined) => (u ?? "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

/** Every page of the brand's website on Google today, and whether it is on the Editorial Calendar. */
export function SitePages({ auth, site, items, canEdit }: { auth: RunAuth; site: Site; items: CalendarItem[]; canEdit: boolean }) {
  const [pages, setPages] = useStash<PagePerf[] | null>(`pages:${site.id}`, null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const country = site.profile.country ?? "United States";

  useEffect(() => {
    if (pages || !canEdit) return;
    let live = true;
    // Loading the pages once per visit is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(true);
    post<{ pages: PagePerf[] }>(auth, "/api/research/pages", { siteId: site.id })
      .then((r) => live && setPages(r.pages))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [auth, site.id, canEdit, pages, setPages]);

  const onCal = new Map<string, CalendarItem>();
  for (const i of items) for (const u of [i.url, i.current_url]) if (u) onCal.set(strip(u), i);
  type Row = PagePerf & { cal: CalendarItem | null };
  const rows: Row[] = (pages ?? []).map((p) => ({ ...p, cal: onCal.get(strip(p.url)) ?? null }));

  const cols: Col<Row>[] = [
    {
      id: "url",
      label: "Page",
      type: "text",
      width: 300,
      value: (r) => r.url,
      cell: (r) => (
        <a href={r.url} target="_blank" rel="noopener noreferrer" className="block max-w-80 truncate" title={r.url}>
          {r.url.replace(/^https?:\/\/(www\.)?[^/]+/, "") || "/"}
        </a>
      ),
    },
    { id: "traffic", label: "Est. visits / mo", type: "number", value: (r) => r.traffic, cell: (r) => short(r.traffic) },
    { id: "keywords", label: "Keywords", type: "number", value: (r) => r.keywords, cell: (r) => short(r.keywords) },
    { id: "top10", label: "In top 10", type: "number", value: (r) => r.top10 },
    { id: "top", label: "Top keyword", type: "text", width: 240, value: (r) => r.topKeyword, cell: (r) => r.topKeyword ?? <span className="text-muted">–</span> },
    { id: "pos", label: "Position", type: "number", value: (r) => r.topRank, cell: (r) => (r.topRank ? <span className="aw-rank">#{r.topRank}</span> : <span className="text-muted">–</span>) },
    { id: "vol", label: "Its volume", type: "number", value: (r) => r.topVolume, cell: (r) => short(r.topVolume) },
    {
      id: "cal",
      label: "On calendar",
      type: "list",
      options: ["Yes", "No"],
      value: (r) => (r.cal ? "Yes" : "No"),
      cell: (r) => (r.cal ? <span className="aw-status aw-status--ranked">{r.cal.action === "update" ? "Update planned" : "Yes"}</span> : <span className="text-muted">No</span>),
    },
  ];

  const total = rows.reduce((n, r) => n + r.traffic, 0);
  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="aw-error">{error}</p> : null}
      {busy ? <Thinking text={`Loading every page of ${site.domain} on Google...`} /> : null}
      {pages ? (
        <>
          <div className="aw-stats aw-stats--tight" style={{ ["--cols" as string]: 4 }}>
            {[
              { lab: "Pages on Google", v: short(rows.length) },
              { lab: "Est. visits / mo", v: short(total) },
              { lab: "Pages in top 10", v: short(rows.filter((r) => r.top10 > 0).length) },
              { lab: "On the calendar", v: short(rows.filter((r) => r.cal).length) },
            ].map((s) => (
              <div key={s.lab} className="aw-stat">
                <div className="aw-stat__lab">{s.lab}</div>
                <span className="aw-stat__num">{s.v}</span>
              </div>
            ))}
          </div>
          <Card
            title={`${site.domain} on Google · ${flag(country)} ${country}`}
            action={
              <button
                type="button"
                className="aw-btn aw-btn--secondary aw-btn--sm"
                onClick={() =>
                  downloadCsv(
                    `pages-${site.domain}.csv`,
                    ["page", "visits / mo", "keywords", "in top 10", "top keyword", "position", "volume", "on calendar"],
                    rows.map((r) => [r.url, r.traffic, r.keywords, r.top10, r.topKeyword, r.topRank, r.topVolume, r.cal ? "yes" : "no"]),
                  )
                }
              >
                Export CSV
              </button>
            }
          >
            <Sheet<Row> id={`pages:${site.id}`} label="Site pages" rows={rows} cols={cols} rowKey={(r) => r.url} sort={{ key: "traffic", desc: true }} height="60vh" />
          </Card>
        </>
      ) : null}
    </div>
  );
}
