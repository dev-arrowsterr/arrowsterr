// The Prompts page as a read-only report, for share links and PDF.
import type { PromptsSnapshot } from "@/lib/reportTypes";

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${Math.round(n)}%`);
const SHORT: Record<string, string> = { "AI Overview": "AIO" };

export function PromptsDoc({ r }: { r: PromptsSnapshot }) {
  const s = r.scores;
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
              <tr key={p.prompt}>
                <td className="pl-6! text-ink">{p.prompt}</td>
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
      <p className="aw-small">#N is the brand&apos;s spot in the list of brands the AI answer named. Blank means it did not name the brand. Made with Arrowsterr.</p>
    </article>
  );
}
