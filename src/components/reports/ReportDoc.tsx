"use client";

import { preinit } from "react-dom";
import type { ReportSnapshot } from "@/lib/reportTypes";
import { fontStack, fontsUrl, themeOf, type ReportTheme } from "@/lib/reportTheme";

const num = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("en-US"));
const pctOf = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${Math.round(n)}%`);

/** Every rule the report needs. Kept as one string so a downloaded HTML file looks the same as the preview. */
export function reportCss(t: ReportTheme) {
  const card =
    t.cards === "elevated"
      ? "background:var(--surface);box-shadow:0 1px 2px rgba(15,20,31,.05),0 8px 24px rgba(15,20,31,.06);"
      : t.cards === "outline"
        ? "background:var(--surface);border:1px solid var(--line);"
        : t.cards === "tinted"
          ? "background:color-mix(in srgb,var(--accent) 7%,var(--surface));"
          : "background:var(--surface);";
  return `
.rp{--accent:${t.accent};--accent2:${t.accent2};--ink:${t.ink};--text:${t.text};--muted:${t.muted};--paper:${t.paper};--surface:${t.surface};--line:${t.line};--hero:${t.heroBg};--hero-text:${t.heroText};--r:${t.radius}px;
  font-family:${fontStack(t.body)};color:var(--text);background:var(--paper);max-width:1040px;margin:0 auto;padding:28px;display:flex;flex-direction:column;gap:22px;font-size:15px;line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-variant-numeric:tabular-nums}
.rp *{box-sizing:border-box;margin:0;padding:0}
.rp h1,.rp h2,.rp h3{font-family:${fontStack(t.heading)};color:var(--ink);font-weight:${t.heading === "DM Serif Display" || t.heading === "Instrument Serif" ? 400 : 600};letter-spacing:-.02em;line-height:1.1}
.rp .lab{font-family:${fontStack(t.label)};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.rp .num{font-family:${fontStack(t.heading)};font-weight:${t.heading === "DM Serif Display" || t.heading === "Instrument Serif" ? 400 : 600};color:var(--ink);letter-spacing:-.03em;line-height:1}
.rp .card{${card}border-radius:var(--r);padding:24px;break-inside:avoid}
.rp .sec{display:flex;flex-direction:column;gap:16px;break-inside:avoid}
.rp .sec-h{display:flex;align-items:baseline;gap:14px}
.rp .sec-h h2{font-size:26px}
.rp .sec-h .idx{font-family:${fontStack(t.label)};font-size:12px;color:var(--accent);letter-spacing:.1em}
.rp .grid{display:grid;gap:16px}
.rp .g2{grid-template-columns:repeat(2,minmax(0,1fr))}.rp .g3{grid-template-columns:repeat(3,minmax(0,1fr))}.rp .g4{grid-template-columns:repeat(4,minmax(0,1fr))}
.rp .up{color:#0E9F6E}.rp .down{color:#E0362B}.rp .flat{color:var(--muted)}
.rp .chg{font-size:13px;font-weight:600}
.rp .bar{height:10px;border-radius:999px;background:color-mix(in srgb,var(--muted) 18%,transparent);position:relative;overflow:hidden}
.rp .bar i{position:absolute;inset:0 auto 0 0;border-radius:999px;background:linear-gradient(90deg,var(--accent),var(--accent2))}
.rp .bar b{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--ink);opacity:.35}
.rp table{width:100%;border-collapse:collapse;font-size:14px}
.rp th{font-family:${fontStack(t.label)};font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:500;text-align:left;padding:0 0 10px;border-bottom:1px solid var(--line)}
.rp td{padding:12px 0;border-bottom:1px solid color-mix(in srgb,var(--line) 70%,transparent);color:var(--text);vertical-align:middle}
.rp td.r,.rp th.r{text-align:right}
.rp tr.you td{color:var(--ink);font-weight:600}
.rp .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:600;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)}
.rp .hero{border-radius:var(--r);overflow:hidden;position:relative;color:var(--hero-text);break-inside:avoid}
.rp .hero h1{color:inherit;font-size:54px}
.rp .hero .lab{color:inherit;opacity:.7}
.rp .hero-dark{background:var(--hero);padding:44px}
.rp .hero-dark:after{content:"";position:absolute;right:-120px;top:-120px;width:420px;height:420px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--accent2) 55%,transparent),transparent 70%);opacity:.55}
.rp .hero-gradient{background:linear-gradient(135deg,var(--accent),var(--accent2));padding:44px;color:#fff}
.rp .hero-gradient:after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 85% 20%,rgba(255,255,255,.28),transparent 45%)}
.rp .hero-light{background:var(--hero);padding:44px;border:1px solid var(--line)}
.rp .hero-light h1{color:var(--ink)}
.rp .hero-split{display:grid;grid-template-columns:1.3fr 1fr;background:var(--surface);border:1px solid var(--line);color:var(--ink)}
.rp .hero-split>.l{padding:44px}.rp .hero-split>.r{background:var(--hero);color:var(--hero-text);padding:44px;display:flex;flex-direction:column;justify-content:space-between;gap:24px}
.rp .hero-split h1{color:var(--ink)}
.rp .hero .in{position:relative;z-index:1;display:flex;flex-direction:column;gap:22px}
.rp .brandrow{display:flex;align-items:center;justify-content:space-between;gap:16px}
.rp .logo{height:34px;max-width:170px;object-fit:contain}
.rp .rp-ring text{font-family:${fontStack(t.heading)}}
.rp .quote{font-family:${fontStack(t.heading)};font-size:24px;line-height:1.3;color:var(--ink);letter-spacing:-.01em}
.rp ol.steps{list-style:none;display:flex;flex-direction:column;gap:12px;counter-reset:s}
.rp ol.steps li{counter-increment:s;display:flex;gap:14px;align-items:flex-start}
.rp ol.steps li:before{content:counter(s);flex:none;width:28px;height:28px;border-radius:999px;background:var(--accent);color:#fff;font-weight:600;font-size:13px;display:flex;align-items:center;justify-content:center}
.rp ul.dots{list-style:none;display:flex;flex-direction:column;gap:10px}
.rp ul.dots li{padding-left:18px;position:relative}
.rp ul.dots li:before{content:"";position:absolute;left:0;top:.6em;width:7px;height:7px;border-radius:999px;background:var(--accent)}
.rp .foot{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:8px 4px 0;font-size:12px;color:var(--muted)}
@media (max-width:760px){.rp{padding:12px}.rp .g3,.rp .g4{grid-template-columns:repeat(2,minmax(0,1fr))}.rp .hero h1{font-size:36px}.rp .hero-split{grid-template-columns:1fr}.rp .hero-dark,.rp .hero-gradient,.rp .hero-light,.rp .hero-split>.l,.rp .hero-split>.r{padding:28px}}
@media print{.rp{max-width:none;padding:0;gap:16px}.rp .sec,.rp .card{break-inside:avoid}}
`;
}

function Change({ now, before, unit = "", lowerIsBetter = false }: { now: number | null; before: number | null; unit?: string; lowerIsBetter?: boolean }) {
  if (now === null || before === null) return null;
  const d = Math.round((now - before) * 10) / 10;
  if (!d) return <span className="chg flat">→ steady</span>;
  const good = lowerIsBetter ? d < 0 : d > 0;
  return (
    <span className={`chg ${good ? "up" : "down"}`}>
      {d > 0 ? "▲ +" : "▼ "}
      {Math.abs(d)}
      {unit}
    </span>
  );
}

/** A score as a ring, like a gauge. */
function Ring({ value, size = 132, track = "color-mix(in srgb, currentColor 14%, transparent)", label }: { value: number | null; size?: number; track?: string; label?: string }) {
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  const r = 52;
  const c = 2 * Math.PI * r;
  const id = `g${Math.round(v * 10)}${size}`;
  return (
    <svg className="rp-ring" viewBox="0 0 140 140" width={size} height={size} role="img" aria-label={`${label ?? "Score"} ${Math.round(v)}`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent2)" />
        </linearGradient>
      </defs>
      <circle cx={70} cy={70} r={r} fill="none" stroke={track} strokeWidth={14} />
      <circle cx={70} cy={70} r={r} fill="none" stroke={`url(#${id})`} strokeWidth={14} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 70 70)" />
      <text x={70} y={70} textAnchor="middle" dominantBaseline="central" fontSize={34} fontWeight={600} fill="currentColor">
        {value === null ? "–" : Math.round(v)}
      </text>
    </svg>
  );
}

function Kpi({ label, value, sub, change }: { label: string; value: React.ReactNode; sub?: React.ReactNode; change?: React.ReactNode }) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span className="lab">{label}</span>
      <span className="num" style={{ fontSize: 40 }}>
        {value}
      </span>
      <span style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", fontSize: 13, color: "var(--muted)" }}>
        {change}
        {sub}
      </span>
    </div>
  );
}

function SectionHead({ n, title, note }: { n: number; title: string; note?: string }) {
  return (
    <div className="sec-h">
      <span className="idx">{String(n).padStart(2, "0")}</span>
      <h2>{title}</h2>
      {note ? <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--muted)" }}>{note}</span> : null}
    </div>
  );
}

/** A designed client report. The same component renders the preview, the PDF, the downloaded HTML and the shared link. */
export function ReportDoc({ r, id = "report" }: { r: ReportSnapshot; id?: string }) {
  const t = themeOf(r.style);
  // Load the fonts once into <head>. A <link precedence> here would hold the whole report back until a new font sheet arrives.
  preinit(fontsUrl(t), { as: "style", precedence: "default" });
  const has = (s: ReportSnapshot["sections"][number]) => r.sections.includes(s);
  const date = new Date(r.at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const title = r.style.title?.trim() || "AI Visibility Report";
  const ai = r.ai;
  let n = 0;
  const brandLine = (
    <div className="brandrow">
      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {r.style.logo ? (
          // Logos come from any address the agency uses. A plain img keeps the report simple to print and export.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.style.logo} alt={r.style.agency || "Logo"} className="logo" />
        ) : null}
        {r.style.agency ? <span style={{ fontWeight: 600, fontSize: 15 }}>{r.style.agency}</span> : null}
      </span>
      <span className="lab">{date}</span>
    </div>
  );
  const heroText = (
    <>
      <span className="lab">
        Prepared for {r.brand.name} · {r.brand.domain}
      </span>
      <h1>{title}</h1>
      <span style={{ fontSize: 17, opacity: 0.85, maxWidth: 620 }}>{r.summary?.headline ?? `Last ${r.days} days, compared with the ${r.days} days before.`}</span>
    </>
  );
  const heroStats = ai ? (
    <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
      <Ring value={ai.visibility} label="AI visibility" />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="lab">AI visibility</span>
        <span style={{ fontSize: 15 }}>
          Named in {pctOf(ai.visibility)} of {num(ai.answers)} AI answers
        </span>
        <Change now={ai.visibility} before={ai.visibilityBefore} unit=" pts" />
      </div>
    </div>
  ) : null;

  return (
    <article id={id} className="rp">
      <style>{reportCss(t)}</style>

      {/* Cover */}
      {t.hero === "split" ? (
        <header className="hero hero-split">
          <div className="l">
            <div className="in">
              {brandLine}
              {heroText}
            </div>
          </div>
          <div className="r">
            <span className="lab">Last {r.days} days</span>
            {heroStats}
          </div>
        </header>
      ) : (
        <header className={`hero hero-${t.hero}`}>
          <div className="in">
            {brandLine}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) auto", gap: 28, alignItems: "end" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{heroText}</div>
              {heroStats}
            </div>
          </div>
        </header>
      )}

      {/* Scores */}
      {has("ai") && ai ? (
        <div className="grid g4">
          <Kpi label="Visibility" value={pctOf(ai.visibility)} change={<Change now={ai.visibility} before={ai.visibilityBefore} unit=" pts" />} sub="of AI answers" />
          <Kpi label="Sentiment" value={ai.sentiment === null ? "–" : Math.round(ai.sentiment)} sub="out of 100" />
          <Kpi label="Avg. position" value={ai.position === null ? "–" : `#${ai.position.toFixed(1)}`} sub="in AI lists" />
          <Kpi label="Rank" value={ai.rank ? `#${ai.rank}` : "–"} sub={`of ${ai.brands} brands`} />
        </div>
      ) : null}

      {/* Summary */}
      {r.summary ? (
        <section className="sec">
          <SectionHead n={++n} title="The short version" />
          <div className="grid g2">
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <p className="quote">{r.summary.headline}</p>
              <ul className="dots">
                {r.summary.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
            {r.summary.next.length ? (
              <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <span className="lab">Next steps</span>
                <ol className="steps">
                  {r.summary.next.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Wins and watch list */}
      {r.wins.length || r.drops.length ? (
        <section className="sec">
          <SectionHead n={++n} title="Wins and watch list" />
          <div className="grid g2">
            {[
              { title: "Top wins", list: r.wins, cls: "up" },
              { title: "Watch list", list: r.drops, cls: "down" },
            ].map((box) => (
              <div key={box.title} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <span className="lab">{box.title}</span>
                {box.list.length ? (
                  <table>
                    <tbody>
                      {box.list.map((c) => (
                        <tr key={c.text}>
                          <td>{c.text}</td>
                          <td className={`r chg ${c.change > 0 ? "up" : "down"}`}>
                            {c.change > 0 ? "+" : ""}
                            {c.change}
                            {c.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <span style={{ color: "var(--muted)", fontSize: 14 }}>Nothing to flag.</span>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* AI visibility by model */}
      {has("ai") && ai && ai.byModel.length ? (
        <section className="sec">
          <SectionHead n={++n} title="Visibility on each AI" note={`${num(ai.answers)} answers checked`} />
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {[...ai.byModel]
              .sort((a, b) => (b.now ?? 0) - (a.now ?? 0))
              .map((m) => (
                <div key={m.engine} style={{ display: "grid", gridTemplateColumns: "140px minmax(0,1fr) 64px 90px", gap: 16, alignItems: "center" }}>
                  <span style={{ color: "var(--ink)", fontWeight: 500 }}>{m.engine}</span>
                  <span className="bar">
                    <i style={{ width: `${m.now ?? 0}%` }} />
                    {m.before !== null ? <b style={{ left: `${m.before}%` }} title="Last period" /> : null}
                  </span>
                  <span className="num" style={{ fontSize: 20, textAlign: "right" }}>
                    {pctOf(m.now)}
                  </span>
                  <span style={{ textAlign: "right" }}>
                    <Change now={m.now} before={m.before} unit=" pts" />
                  </span>
                </div>
              ))}
          </div>
        </section>
      ) : null}

      {/* Competitors */}
      {has("competitors") && r.competitors?.length ? (
        <section className="sec">
          <SectionHead n={++n} title="Who AI recommends" note="Share of AI answers that name each brand" />
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th>Brand</th>
                  <th style={{ width: "38%" }}>Visibility</th>
                  <th className="r">Sentiment</th>
                  <th className="r">Position</th>
                </tr>
              </thead>
              <tbody>
                {r.competitors.map((c, i) => (
                  <tr key={c.name} className={c.isYou ? "you" : ""}>
                    <td style={{ color: "var(--muted)" }}>{i + 1}</td>
                    <td>
                      {c.name} {c.isYou ? <span className="pill">YOU</span> : null}
                    </td>
                    <td>
                      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span className="bar" style={{ flex: 1, opacity: c.isYou ? 1 : 0.55 }}>
                          <i style={{ width: `${c.visibility}%` }} />
                        </span>
                        <span style={{ width: 44, textAlign: "right" }}>{pctOf(c.visibility)}</span>
                      </span>
                    </td>
                    <td className="r">{c.sentiment === null ? "–" : Math.round(c.sentiment)}</td>
                    <td className="r">{c.position === null ? "–" : `#${c.position.toFixed(1)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Traffic */}
      {has("traffic") && r.traffic ? (
        <section className="sec">
          <SectionHead n={++n} title="Website traffic" />
          <div className="grid g3">
            <Kpi label="Visits" value={num(r.traffic.visits)} change={<Change now={r.traffic.visits} before={r.traffic.visitsBefore} />} />
            <Kpi label="From AI assistants" value={num(r.traffic.ai)} change={<Change now={r.traffic.ai} before={r.traffic.aiBefore} />} />
            <div className="card" style={{ display: "flex", alignItems: "center", gap: 16, color: "var(--ink)" }}>
              <Ring value={r.traffic.visits ? (r.traffic.ai / r.traffic.visits) * 100 : null} size={96} label="AI share" />
              <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="lab">AI share</span>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>of all visits</span>
              </span>
            </div>
          </div>
          {r.traffic.byEngine.some((e) => e.visits || e.prev) ? (
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <span className="lab">Visits by AI assistant</span>
              {r.traffic.byEngine
                .filter((e) => e.visits || e.prev)
                .sort((a, b) => b.visits - a.visits)
                .map((e) => (
                  <div key={e.engine} style={{ display: "grid", gridTemplateColumns: "140px minmax(0,1fr) 70px 80px", gap: 16, alignItems: "center" }}>
                    <span style={{ color: "var(--ink)" }}>{e.engine}</span>
                    <span className="bar">
                      <i style={{ width: `${r.traffic!.ai ? (e.visits / r.traffic!.ai) * 100 : 0}%` }} />
                    </span>
                    <span className="num" style={{ fontSize: 18, textAlign: "right" }}>
                      {num(e.visits)}
                    </span>
                    <span style={{ textAlign: "right" }}>
                      <Change now={e.visits} before={e.prev} />
                    </span>
                  </div>
                ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Visitors */}
      {has("visitors") && r.visitors ? (
        <section className="sec">
          <SectionHead n={++n} title="Visitors and leads" />
          <div className="grid g3">
            <Kpi label="Visitors" value={num(r.visitors.total)} />
            <Kpi label="Hot buyers" value={num(r.visitors.hot)} />
            <Kpi label="Took a key action" value={num(r.visitors.actions)} />
          </div>
          {r.visitors.top.length ? (
            <div className="card">
              <table>
                <thead>
                  <tr>
                    <th>Top visitors</th>
                    <th>Came from</th>
                    <th className="r">Buyer score</th>
                  </tr>
                </thead>
                <tbody>
                  {r.visitors.top.map((v) => (
                    <tr key={v.name}>
                      <td style={{ color: "var(--ink)" }}>
                        {v.emoji} {v.name}
                      </td>
                      <td>{v.source}</td>
                      <td className="r">
                        <span className="pill">
                          {v.score} · {v.label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Content */}
      {has("content") && r.content ? (
        <section className="sec">
          <SectionHead n={++n} title="Content" />
          <div className="grid g4">
            <Kpi label="Published" value={r.content.published} />
            <Kpi label="Writing" value={r.content.writing} />
            <Kpi label="Briefs ready" value={r.content.briefs} />
            <Kpi label="Planned" value={r.content.planned} />
          </div>
          {r.content.pages.length ? (
            <div className="card">
              <table>
                <thead>
                  <tr>
                    <th>Published page</th>
                    <th className="r">Cited by AI</th>
                    <th className="r">Visits</th>
                    <th className="r">From AI</th>
                  </tr>
                </thead>
                <tbody>
                  {r.content.pages.slice(0, 15).map((p) => (
                    <tr key={p.id}>
                      <td>
                        <span style={{ display: "block", color: "var(--ink)" }}>{p.keyword}</span>
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>{p.path}</span>
                      </td>
                      <td className="r">{p.cited === null ? "–" : p.cited ? pctOf(p.cited) : "Not yet"}</td>
                      <td className="r">{num(p.visits)}</td>
                      <td className="r">{num(p.aiVisits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      <footer className="foot">
        <span>{r.style.footer?.trim() || (r.style.agency ? `Prepared by ${r.style.agency}` : r.brand.domain)}</span>
        {r.style.whiteLabel ? null : <span className="lab">Made with Arrowsterr</span>}
      </footer>
    </article>
  );
}
