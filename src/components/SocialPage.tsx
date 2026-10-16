"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { answered } from "@/lib/metrics";
import type { RunAuth } from "@/lib/runner";
import { citedKeys, NEGATIVE, POSITIVE, shareOfVoice, SOURCES, threadKey, type ListenSettings, type Mention, type MentionKind, type SocialSource } from "@/lib/social";
import type { View } from "@/lib/view";
import { Dropdown } from "./Pickers";
import { post } from "./research/shared";
import { SampleChips, SampleRows, ToolIntro } from "./ToolIntro";
import { Bar } from "./CompetitorPanel";
import { BrandName, Delta, Empty, favicon, Seg, SidePanel, Thinking, YOU_COLOR } from "./ui";

type Target = { name: string; domain: string | null; isYou: boolean };
type Info = { targets: Target[]; ranked: { name: string; domain: string | null; mentions: number }[]; limit: number; listen: ListenSettings; listenedOn: string | null };
type Mood = "all" | "positive" | "negative";

const PAGE = 40;
const KIND_LABEL: Record<MentionKind, string> = { question: "Question", complaint: "Complaint", praise: "Praise", comparison: "Comparison", news: "News", other: "Other" };
const when = (m: Mention) => Date.parse(m.posted_at ?? m.found_at);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const sourceIcon = (s: SocialSource, url: string) => favicon(SOURCES[s].domain || new URL(url).hostname);

function MoodTag({ score }: { score: number | null }) {
  if (score === null) return null;
  if (score >= POSITIVE) return <span className="aw-status aw-status--ranked">Positive</span>;
  if (score <= NEGATIVE) return <span className="aw-status aw-status--missed">Negative</span>;
  return <span className="aw-status aw-status--pending">Neutral</span>;
}

/** Social listening: posts about you and the competitors AI names most, share of voice, the threads AI cites and reply drafts. */
export function SocialPage({ view, sb, reader, auth }: { view: View; sb: SupabaseClient; reader: RunAuth | null; auth: RunAuth | null }) {
  const { brand, days, current, filter } = view;
  const [rows, setRows] = useState<Mention[] | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [mood, setMood] = useState<Mood>("all");
  const [citedOnly, setCitedOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [reply, setReply] = useState<{ m: Mention; text: string | null; error: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [tracking, setTracking] = useState<{ off: boolean; auto: boolean; picks: string[] } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const since = new Date(Date.now() - 2 * days * 864e5).toISOString();
    const { data, error: err } = await sb.from("mentions").select("*").eq("brand_id", brand.id).gte("found_at", since).order("found_at", { ascending: false }).limit(3000);
    if (err) {
      setError(/mentions/.test(err.message) ? "Run supabase/038_social.sql in Supabase." : err.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as Mention[]);
    setLoadedAt(Date.now());
    if (reader) setInfo(await post<Info>(reader, "/api/social", { action: "targets", brandId: brand.id }).catch((e) => (setError(e instanceof Error ? e.message : String(e)), null)));
  }, [sb, brand.id, days, reader]);

  useEffect(() => {
    // Loading on open (and when the brand or period changes) is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const cited = useMemo(() => citedKeys(answered(current, filter)), [current, filter]);
  const start = loadedAt - days * 864e5;
  const now = useMemo(() => (rows ?? []).filter((m) => when(m) >= start).sort((a, b) => when(b) - when(a)), [rows, start]);
  const before = useMemo(() => (rows ?? []).filter((m) => when(m) < start && when(m) >= start - days * 864e5), [rows, start, days]);
  const names = info?.targets ?? [...new Map((rows ?? []).map((m) => [m.name.toLowerCase(), { name: m.name, isYou: m.is_you, domain: null }])).values()];
  const voice = shareOfVoice(names, now, before, cited);
  const domainOf = (n: string) => (n.toLowerCase() === brand.name.toLowerCase() ? brand.domain : names.find((t) => t.name.toLowerCase() === n.toLowerCase())?.domain ?? null);

  const communities = useMemo(() => {
    const map = new Map<string, { author: string; source: SocialSource; n: number; names: Map<string, number> }>();
    for (const m of now) {
      if (!m.author || m.source === "hn" || m.source === "news") continue;
      const k = `${m.source}:${m.author.toLowerCase()}`;
      const row = map.get(k) ?? { author: m.author, source: m.source, n: 0, names: new Map<string, number>() };
      row.n++;
      row.names.set(m.name, (row.names.get(m.name) ?? 0) + 1);
      map.set(k, row);
    }
    return [...map.values()].sort((a, b) => b.n - a.n).slice(0, 10);
  }, [now]);

  const listed = now.filter(
    (m) =>
      (!name || m.name.toLowerCase() === name.toLowerCase()) &&
      (!source || m.source === source) &&
      (mood === "all" || (m.sentiment !== null && (mood === "positive" ? m.sentiment >= POSITIVE : m.sentiment <= NEGATIVE))) &&
      (!citedOnly || cited.has(threadKey(m.url))),
  );

  const startListening = async () => {
    if (!auth) return;
    setBusy(true);
    setError(null);
    try {
      await post(auth, "/api/social", { action: "start", brandId: brand.id });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const draft = async (m: Mention) => {
    if (!auth) return;
    setCopied(false);
    setReply({ m, text: null, error: null });
    try {
      const { text } = await post<{ text: string }>(auth, "/api/social/reply", { mentionId: m.id });
      setReply({ m, text, error: null });
    } catch (e) {
      setReply({ m, text: null, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const saveTracking = async () => {
    if (!auth || !tracking) return;
    setBusy(true);
    setError(null);
    try {
      await post(auth, "/api/social", { action: "save", brandId: brand.id, off: tracking.off, picks: tracking.auto ? null : tracking.picks });
      // Names added today get their first check now. Names already checked today wait until tomorrow.
      if (!tracking.off) await post(auth, "/api/social", { action: "start", brandId: brand.id });
      setTracking(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (rows === null) return <Thinking text="Loading social posts" />;
  if (error && !rows.length && !info) return <div className="aw-error max-w-2xl">{error}</div>;

  if (!rows.length) {
    if (info?.listenedOn) return <Empty>Listening since {day(`${info.listenedOn}T00:00:00Z`)}. Posts show up here as they are found, usually within the hour.</Empty>;
    if (info && info.limit <= 0) return <Empty>Social listening isn&apos;t on your plan.</Empty>;
    return (
      <>
        {error ? <div className="aw-error max-w-2xl">{error}</div> : null}
        <ToolIntro
          title="See what people say about you and your competitors"
          lead={`Arrowsterr reads Reddit, X, LinkedIn, YouTube, Hacker News and the news every day for ${brand.name} and the competitors AI names most next to you.`}
          action={
            auth ? (
              <button type="button" className="aw-btn aw-btn--accent" onClick={startListening} disabled={busy}>
                {busy ? "Starting…" : "Start listening"}
              </button>
            ) : (
              <span className="aw-small">An editor can start listening.</span>
            )
          }
          features={[
            { title: "Share of voice", text: "Who gets talked about most, and how warmly.", visual: <SampleRows rows={[["You", 42, "42%"], ["Competitor A", 31, "31%"], ["Competitor B", 18, "18%"]]} /> },
            { title: "Threads AI cites", text: "Posts that ChatGPT, Perplexity and Google AI also use as sources. Answer these first.", visual: <SampleChips items={[["AI cites", "#FEF3C7"], ["Question", "#E0E7FF"]]} /> },
            { title: "Top communities", text: "The subreddits and accounts where your competitors get discussed.", visual: <SampleRows rows={[["r/SaaS", 12], ["r/marketing", 8], ["@growthteam", 5]]} /> },
            { title: "Reply drafts", text: "Zippie drafts a helpful reply in your voice. You post it." },
          ]}
        />
      </>
    );
  }

  const sources = [...new Set(now.map((m) => m.source))];
  return (
    <div className="flex flex-col gap-8">
      {error ? <div className="aw-error max-w-2xl">{error}</div> : null}

      <section className="aw-frame">
        <div className="aw-frame__head justify-between">
          <h2 className="aw-h4">Share of voice</h2>
          {auth && info ? (
            <button
              type="button"
              className="aw-btn aw-btn--secondary aw-btn--sm"
              onClick={() => setTracking({ off: Boolean(info.listen.off), auto: !info.listen.picks?.length, picks: info.listen.picks?.length ? info.listen.picks : info.targets.filter((t) => !t.isYou).map((t) => t.name) })}
            >
              Tracking
            </button>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="aw-table">
            <thead>
              <tr>
                <th>Brand</th>
                <th className="w-32">Mentions</th>
                <th className="w-56">Share</th>
                <th className="w-28">Positive</th>
                <th className="w-28">Negative</th>
                <th className="w-36">Top source</th>
                <th className="w-28">AI cites</th>
              </tr>
            </thead>
            <tbody>
              {voice.map((v) => (
                <tr key={v.name} className={v.isYou ? "is-you" : "cursor-pointer"} onClick={() => setName(name.toLowerCase() === v.name.toLowerCase() ? "" : v.name)}>
                  <td className="truncate">
                    <BrandName name={v.name} domain={domainOf(v.name)} logo={v.isYou ? brand.logo : undefined} isYou={v.isYou} size={20} />
                  </td>
                  <td className="aw-num whitespace-nowrap">
                    {v.mentions} <Delta now={v.mentions} before={v.before} digits={0} />
                  </td>
                  <td>
                    <Bar v={v.share} color={v.isYou ? YOU_COLOR : "#111111"} />
                  </td>
                  <td className="aw-num">{v.mentions ? `${Math.round(v.positive)}%` : "–"}</td>
                  <td className="aw-num">{v.mentions ? `${Math.round(v.negative)}%` : "–"}</td>
                  <td>{v.topSource ? SOURCES[v.topSource].label : "–"}</td>
                  <td className="aw-num">{v.cited || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {communities.length ? (
        <section className="aw-frame">
          <div className="aw-frame__head">
            <h2 className="aw-h4">Top communities</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="aw-table">
              <thead>
                <tr>
                  <th>Community</th>
                  <th className="w-36">Source</th>
                  <th className="w-28">Posts</th>
                  <th>Brands discussed</th>
                </tr>
              </thead>
              <tbody>
                {communities.map((c) => (
                  <tr key={`${c.source}:${c.author}`}>
                    <td className="font-medium text-ink">{c.author}</td>
                    <td>{SOURCES[c.source].label}</td>
                    <td className="aw-num">{c.n}</td>
                    <td className="truncate">
                      {[...c.names.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .map(([n, k]) => `${n} (${k})`)
                        .join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="aw-frame">
        <div className="aw-frame__head flex-wrap justify-between gap-3">
          <h2 className="aw-h4">Posts</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Dropdown label="Brand" value={name} onChange={(v) => (setName(v), setShown(PAGE))} className="aw-dropdown--sm" options={[{ id: "", label: "All brands" }, ...voice.map((v) => ({ id: v.name, label: v.isYou ? `${v.name} (you)` : v.name }))]} />
            <Dropdown label="Source" value={source} onChange={(v) => (setSource(v), setShown(PAGE))} className="aw-dropdown--sm" options={[{ id: "", label: "All sources" }, ...sources.map((s) => ({ id: s, label: SOURCES[s].label }))]} />
            <Seg
              label="Sentiment"
              value={mood}
              onChange={(v) => (setMood(v), setShown(PAGE))}
              options={[
                { id: "all", label: "All" },
                { id: "positive", label: "Positive" },
                { id: "negative", label: "Negative" },
              ]}
            />
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <input type="checkbox" checked={citedOnly} onChange={(e) => (setCitedOnly(e.target.checked), setShown(PAGE))} className="h-4 w-4 accent-[var(--aw-brand)]" />
              AI cites
            </label>
          </div>
        </div>
        {listed.length ? (
          <ul className="divide-y divide-rule-faint">
            {listed.slice(0, shown).map((m) => (
              <li key={m.id} className="flex gap-3 px-4 py-4 sm:px-6">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sourceIcon(m.source, m.url)} alt="" width={20} height={20} className="mt-0.5 h-5 w-5 shrink-0" loading="lazy" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <a href={m.url} target="_blank" rel="noopener noreferrer" className="aw-text-link font-medium break-words">
                    {m.title}
                  </a>
                  {m.snippet ? <p className="line-clamp-2 text-[14px] break-words text-body">{m.snippet}</p> : null}
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                    <span>{SOURCES[m.source].label}</span>
                    {m.author ? <span>· {m.author}</span> : null}
                    <span>· {m.posted_at ? day(m.posted_at) : `Found ${day(m.found_at)}`}</span>
                    <span className="aw-status aw-status--pending">{m.name}</span>
                    <MoodTag score={m.sentiment} />
                    {m.kind ? <span className="aw-status aw-status--pending">{KIND_LABEL[m.kind]}</span> : null}
                    {cited.has(threadKey(m.url)) ? <span className="aw-status aw-status--warn">AI cites</span> : null}
                  </div>
                </div>
                {auth ? (
                  <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm h-fit shrink-0" onClick={() => draft(m)}>
                    Draft reply
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="aw-small px-6 py-5">No posts match these filters.</p>
        )}
        {listed.length > shown ? (
          <div className="border-t border-rule-faint px-6 py-3">
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setShown(shown + PAGE)}>
              Show more
            </button>
          </div>
        ) : null}
      </section>

      {reply ? (
        <SidePanel title="Reply draft" kicker={`${SOURCES[reply.m.source].label} · ${reply.m.name}`} onClose={() => setReply(null)} narrow>
          <a href={reply.m.url} target="_blank" rel="noopener noreferrer" className="aw-text-link font-medium">
            {reply.m.title}
          </a>
          {reply.error ? (
            <div className="aw-error">{reply.error}</div>
          ) : reply.text === null ? (
            <Thinking text="Writing a reply" />
          ) : (
            <>
              <textarea className="aw-input min-h-64 text-[15px]!" value={reply.text} onChange={(e) => setReply({ ...reply, text: e.target.value })} aria-label="Reply draft" />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="aw-btn aw-btn--accent"
                  onClick={() => {
                    void navigator.clipboard.writeText(reply.text ?? "").then(() => setCopied(true));
                  }}
                >
                  {copied ? "Copied" : "Copy reply"}
                </button>
                <a href={reply.m.url} target="_blank" rel="noopener noreferrer" className="aw-btn aw-btn--secondary">
                  Open the post
                </a>
                <button type="button" className="aw-btn aw-btn--secondary" onClick={() => draft(reply.m)}>
                  Write another
                </button>
              </div>
            </>
          )}
        </SidePanel>
      ) : null}

      {tracking && info ? (
        <SidePanel title="Tracking" kicker={`${brand.name} plus up to ${info.limit} competitors`} onClose={() => setTracking(null)} narrow>
          <label className="flex items-center gap-2 text-[14px] text-ink">
            <input type="checkbox" checked={!tracking.off} onChange={(e) => setTracking({ ...tracking, off: !e.target.checked })} className="h-4 w-4 accent-[var(--aw-brand)]" />
            Listening on
          </label>
          <Seg
            label="Competitors"
            value={tracking.auto ? "auto" : "picks"}
            onChange={(v) => setTracking({ ...tracking, auto: v === "auto" })}
            options={[
              { id: "auto", label: "Top named by AI" },
              { id: "picks", label: "My picks" },
            ]}
          />
          <div className="border border-rule">
            <table className="aw-table">
              <thead>
                <tr>
                  <th className="w-12" />
                  <th>Competitor</th>
                  <th className="w-40">AI mentions, 30 days</th>
                </tr>
              </thead>
              <tbody>
                {info.ranked.map((r, i) => {
                  const on = tracking.auto ? i < info.limit : tracking.picks.some((p) => p.toLowerCase() === r.name.toLowerCase());
                  const full = !on && tracking.picks.length >= info.limit;
                  return (
                    <tr key={r.name}>
                      <td>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={tracking.auto || full}
                          onChange={() => setTracking({ ...tracking, picks: on ? tracking.picks.filter((p) => p.toLowerCase() !== r.name.toLowerCase()) : [...tracking.picks, r.name] })}
                          aria-label={`Track ${r.name}`}
                          className="h-4 w-4 accent-[var(--aw-brand)]"
                        />
                      </td>
                      <td>
                        <BrandName name={r.name} domain={r.domain} size={18} />
                      </td>
                      <td className="aw-num">{r.mentions}</td>
                    </tr>
                  );
                })}
                {!info.ranked.length ? (
                  <tr>
                    <td colSpan={3} className="aw-small">
                      No competitors named by AI in the last 30 days.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="aw-btn aw-btn--accent" onClick={saveTracking} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </SidePanel>
      ) : null}
    </div>
  );
}
