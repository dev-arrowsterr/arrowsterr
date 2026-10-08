"use client";

import { isAnswered, type Run } from "@/lib/chats";
import type { Brand } from "@/lib/db";
import { googleSummary } from "@/lib/stats";
import { BrandLogo } from "./BrandLogo";

const favicon = (domain: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
const pct = (n: number | null) => (n === null ? "–" : `${Math.round(n)}%`);
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="aw-card-stat flex flex-col gap-1">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="aw-num text-[26px] font-medium text-ink">{value}</span>
      <span className="text-[12px] text-muted">{note}</span>
    </div>
  );
}

// Every status is a word, so color is never the only signal.
function Yes({ on, yes, no }: { on: boolean | null; yes: string; no: string }) {
  if (on === null) return <span className="aw-status aw-status--pending">Not checked</span>;
  return <span className={`aw-status ${on ? "aw-status--ranked" : "aw-status--missed"}`}>{on ? yes : no}</span>;
}

/** Google AI Overview, AI Mode and regular rankings for each tracked prompt, from the latest run with Google data. */
export function GooglePage({ brand, runs }: { brand: Brand; runs: Run[] }) {
  const run = [...runs].reverse().find((r) => r.chats.some((c) => (c.engine === "AI Overview" || c.engine === "AI Mode") && isAnswered(c)));
  if (!run) {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <h1 className="aw-h2 mb-0!">Google</h1>
        <div className="aw-callout text-[16px]!">
          No Google results yet. Add DFS_LOGIN and DFS_PASSWORD on Render, then run your prompts from the Dashboard or wait for the daily run.
        </div>
      </div>
    );
  }
  const g = googleSummary(run, { name: brand.name, domain: brand.domain });
  const hasMode = g.modeMentionRate !== null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="aw-h2 mb-0!">Google</h1>
        <span className="aw-small">
          {g.prompts} searches · updated {when(run.at)}
        </span>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="aw-h4">AI Overview</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label="AI Overview shown" value={pct(g.aioShownRate)} note="of your searches show an AI Overview" />
          <Tile label="You are named" value={pct(g.aioMentionRate)} note="of those AI Overviews name your brand" />
          <Tile label="Your site is cited" value={pct(g.aioCitedRate)} note="of those AI Overviews link to your site" />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="aw-h4">AI Mode and rankings</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Named in AI Mode" value={pct(g.modeMentionRate)} note={hasMode ? "of AI Mode answers" : "AI Mode not checked yet"} />
          <Tile label="Cited in AI Mode" value={pct(g.modeCitedRate)} note={hasMode ? "of AI Mode answers link to you" : "AI Mode not checked yet"} />
          <Tile label="Google top 10" value={pct(g.top10Rate)} note="of searches rank your site in the top 10" />
          <Tile label="Average rank" value={g.avgRank === null ? "–" : `#${g.avgRank.toFixed(1)}`} note="where you are in the top 20" />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="aw-h4">Each search</h2>
        <div className="aw-table-wrap table-scroll">
          <table className="aw-table aw-table--compact">
            <thead>
              <tr>
                <th>Search</th>
                <th>AI Overview</th>
                <th>In AI Overview</th>
                <th>In AI Mode</th>
                <th>Google rank</th>
                <th>AI Overview cites</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.prompt}>
                  <td className="min-w-56">{r.prompt}</td>
                  <td>
                    <Yes on={r.aioShown} yes="Shown" no="Not shown" />
                  </td>
                  <td>
                    {r.aioShown ? (
                      <Yes on={r.aioMentioned || r.aioCited} yes={r.aioCited ? (r.aioMentioned ? "Named + cited" : "Cited") : "Named"} no="Missing" />
                    ) : (
                      <span className="text-muted">–</span>
                    )}
                  </td>
                  <td>
                    <Yes on={r.modeMentioned === null ? null : r.modeMentioned || r.modeCited} yes={r.modeCited ? (r.modeMentioned ? "Named + cited" : "Cited") : "Named"} no="Missing" />
                  </td>
                  <td className="aw-num whitespace-nowrap">{r.rank === null ? <span className="text-muted">Not in top 20</span> : `#${r.rank}`}</td>
                  <td>
                    <span className="flex items-center gap-1">
                      {r.topSources.map((d) => (
                        <span key={d} title={d}>
                          <BrandLogo src={favicon(d)} name={d} size={18} />
                        </span>
                      ))}
                      {!r.topSources.length ? <span className="text-muted">–</span> : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {g.topDomains.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="aw-h4">Sites AI Overviews cite most</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {g.topDomains.map((d) => {
              const own = d.domain === brand.domain || d.domain.endsWith(`.${brand.domain}`);
              return (
                <li key={d.domain} className="flex items-center justify-between gap-3 border border-rule bg-white px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <BrandLogo src={favicon(d.domain)} name={d.domain} size={20} />
                    <span className="truncate text-[15px] text-ink">{d.domain}</span>
                    {own ? <span className="aw-badge">You</span> : null}
                  </span>
                  <span className="aw-num shrink-0 text-[14px] text-muted">
                    {d.count} of {g.prompts}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
