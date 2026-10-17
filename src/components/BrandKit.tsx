"use client";
/* eslint-disable @next/next/no-img-element -- logos come from any site, like BrandLogo */

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { preinit } from "react-dom";
import { cleanKit, contrast, DEFAULT_KIT, kitToTheme, readKitStream, type BrandKit, type KitColors, type KitPart, type KitRow } from "@/lib/brandKit";
import { FONTS, fontStack, fontsUrl, type Font } from "@/lib/reportTheme";
import type { RunAuth } from "@/lib/runner";
import { Dropdown } from "./Pickers";
import { ToolIntro } from "./ToolIntro";
import { Zippie } from "./Zippie";

// Brand Kits (docs/reports.md, section 31): the learning animation shown in onboarding and Settings,
// and the Settings → Brand Kit page.

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const NOT_RUN = "Run supabase/045_brand_kits.sql in Supabase to save Brand Kits.";

/** Learn a kit. onPart gets each part as the agent finds it; the promise ends with the finished kit. */
export async function streamKit(auth: RunAuth, website: string, brandId: string | null, onPart: (p: KitPart) => void) {
  const res = await fetch("/api/brand-kit", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` },
    body: JSON.stringify({ workspaceId: auth.workspaceId, website, brandId }),
  });
  if (!res.ok || !res.body) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || `The server returned ${res.status}.`);
  }
  return readKitStream(res.body.pipeThrough(new TextDecoderStream()), onPart);
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// The show runs in this order. Each stage waits for its real data, and stays on screen long enough to read.
const STAGES = ["scan", "colors", "fonts", "logo", "cover", "saved"] as const;
type Got = { title?: string; colors?: string[]; fonts?: string[]; logo?: { logo: string; onDark: boolean }; done?: Extract<KitPart, { part: "done" }> };

function useStage(got: Got) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const next = stage + 1;
    if (next >= STAGES.length) return;
    const finished = Boolean(got.done);
    // Colors and fonts may never come (a site with no CSS to read). The logo means they are not coming.
    const ready = [true, Boolean(got.colors || got.logo || finished), Boolean(got.fonts || got.logo || finished), Boolean(got.logo || finished), finished, finished][next];
    if (!ready) return;
    // With reduced motion the finished kit shows at once. Skipped stages pass at once too.
    const jump = reducedMotion() && finished;
    const skip = (next === 1 && !got.colors) || (next === 2 && !got.fonts);
    const t = setTimeout(() => setStage(jump ? STAGES.length - 1 : next), jump || skip ? 0 : next === STAGES.length - 1 ? 1300 : 850);
    return () => clearTimeout(t);
  }, [stage, got]);
  return STAGES[stage];
}

/**
 * Zippie reads a website and builds its Brand Kit on screen: the site, its colors, its fonts, its logo, then a
 * report cover that turns from Arrowsterr's look into theirs. onDone gets the saved kit.
 */
export function KitLearn({ auth, website, brandId = null, onDone, onAnother, onSkip }: { auth: RunAuth; website: string; brandId?: string | null; onDone: (kit: BrandKit, saved: boolean) => void; onAnother?: () => void; onSkip?: () => void }) {
  const [got, setGot] = useState<Got>({});
  const [error, setError] = useState("");
  const [tries, setTries] = useState(0);
  const started = useRef("");
  const stage = useStage(got);
  const at = STAGES.indexOf(stage);
  const domain = website.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();

  useEffect(() => {
    const key = `${website}|${brandId}|${tries}`;
    if (started.current === key) return; // once per try, also under React's double effects in development
    started.current = key;
    setGot({});
    setError("");
    streamKit(auth, website, brandId, (p) =>
      setGot((g) => {
        if (p.part === "site") return { ...g, title: p.title };
        if (p.part === "colors") return { ...g, colors: p.colors };
        if (p.part === "fonts") return { ...g, fonts: p.fonts };
        if (p.part === "logo") return { ...g, logo: { logo: p.logo, onDark: p.onDark } };
        if (p.part === "done") return { ...g, done: p };
        return g;
      }),
    ).catch((e) => setError(message(e)));
  }, [auth, website, brandId, tries]);

  const kit = got.done?.kit;
  const say = error
    ? "We could not read that site."
    : {
        scan: `Scanning ${domain}…`,
        colors: "Nice color palette.",
        fonts: "Reading your fonts.",
        logo: got.logo?.logo ? "Found your logo." : "No logo found. We set your name instead.",
        cover: "Putting your brand on a report.",
        saved: got.done?.saved === false ? NOT_RUN : "Brand Kit saved.",
      }[stage];
  const swatches = kit && at >= 4 ? [kit.colors.primary, kit.colors.secondary, kit.colors.ink, kit.colors.paper] : (got.colors ?? []);

  return (
    <section className="aw-kit" aria-label="Brand Kit">
      <p className="aw-kit__say" aria-live="polite">
        {say}
      </p>
      <div className={`aw-kit__card ${error ? "is-failed" : ""}`}>
        <div className="aw-kit__mark">
          {at >= 3 && got.logo?.logo ? (
            <img key="logo" className={`aw-kit__logo ${got.logo.onDark ? "is-on-dark" : ""}`} src={got.logo.logo} alt={`${kit?.name || got.title || domain} logo`} />
          ) : at >= 3 ? (
            <span key="name" className="aw-kit__name" style={{ fontFamily: kit ? fontStack(kit.fonts.heading) : undefined }}>
              {kit?.name || got.title || domain}
            </span>
          ) : (
            <Zippie key="zippie" size={56} mood={error ? "idle" : "thinking"} />
          )}
        </div>

        <ul className="aw-kit__swatches" aria-label="Colors">
          {at >= 1
            ? swatches.map((c, i) => (
                <li key={`${at >= 4 ? "kit" : "site"}-${c}-${i}`} style={{ background: c, animationDelay: `${i * 80}ms` }}>
                  <span className="aw-num">{c}</span>
                </li>
              ))
            : null}
        </ul>

        <div className="aw-kit__fonts" aria-label="Fonts">
          {kit && at >= 4 ? (
            <>
              <FontSample font={kit.fonts.heading} role="Headings" />
              <FontSample font={kit.fonts.body} role="Text" />
            </>
          ) : at >= 2 ? (
            (got.fonts ?? []).map((f, i) => (
              <span key={f} className="aw-kit__font" style={{ animationDelay: `${i * 80}ms` }}>
                {f}
              </span>
            ))
          ) : null}
        </div>

        <KitCover kit={at >= 4 && kit ? kit : null} />
      </div>

      {error ? (
        <div className="aw-kit__actions">
          <p className="aw-error">{error}</p>
          <button type="button" className="aw-btn aw-btn--accent" onClick={() => setTries((n) => n + 1)}>
            Try again
          </button>
          {onAnother ? (
            <button type="button" className="aw-text-link" onClick={onAnother}>
              Use another website
            </button>
          ) : null}
          {onSkip ? (
            <button type="button" className="aw-text-link text-muted!" onClick={onSkip}>
              Skip for now
            </button>
          ) : null}
        </div>
      ) : stage === "saved" && got.done ? (
        <div className="aw-kit__actions">
          <button type="button" className="aw-btn aw-btn--accent aw-btn--lg" onClick={() => onDone(got.done!.kit, got.done!.saved)}>
            Looks right →
          </button>
          {onAnother ? (
            <button type="button" className="aw-text-link" onClick={onAnother}>
              Use another website
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function FontSample({ font, role }: { font: Font; role: string }) {
  return (
    <span className="aw-kit__sample">
      <b style={{ fontFamily: fontStack(font) }}>Aa</b>
      <span>
        {font}
        <small>{role}</small>
      </span>
    </span>
  );
}

/** A small report cover in a kit's look. With no kit it shows Arrowsterr's own, ready to turn into theirs. */
export function KitCover({ kit }: { kit: BrandKit | null }) {
  const k = kit ?? { ...DEFAULT_KIT, name: "Your brand" };
  const t = kitToTheme(k);
  // Load the kit's fonts once into <head>.
  if (kit) preinit(fontsUrl(t), { as: "style", precedence: "default" });
  const vars = {
    "--k-hero": t.heroBg,
    "--k-hero-text": t.heroText,
    "--k-paper": t.paper,
    "--k-surface": t.surface,
    "--k-ink": t.ink,
    "--k-text": t.text,
    "--k-muted": t.muted,
    "--k-line": t.line,
    "--k-accent": t.accent,
    "--k-accent2": t.accent2,
    "--k-radius": `${Math.min(t.radius, 14)}px`,
    "--k-heading": fontStack(t.heading),
    "--k-body": fontStack(t.body),
  } as React.CSSProperties;
  return (
    <div className={`aw-kit__cover ${kit ? "is-theirs" : ""}`} style={vars} aria-hidden="true">
      <div className="aw-kit__hero">
        {kit?.logo ? <img src={kit.logo} alt="" /> : <b>{k.name}</b>}
        <span>AI visibility report</span>
      </div>
      <div className="aw-kit__body">
        <div className="aw-kit__kpis">
          <span>
            <small>Visibility</small>
            <b>64%</b>
          </span>
          <span>
            <small>Share of voice</small>
            <b>38%</b>
          </span>
        </div>
        <div className="aw-kit__bars">
          {[82, 64, 48, 31].map((w, i) => (
            <i key={i} style={{ width: `${w}%`, background: i ? "var(--k-accent2)" : "var(--k-accent)" }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────── Settings → Brand Kit ───────────────────────────────

const COLOR_FIELDS: { id: keyof KitColors; label: string }[] = [
  { id: "primary", label: "Main color" },
  { id: "secondary", label: "Second color" },
  { id: "ink", label: "Headings" },
  { id: "text", label: "Text" },
  { id: "muted", label: "Small notes" },
  { id: "paper", label: "Page" },
  { id: "surface", label: "Cards" },
  { id: "line", label: "Borders" },
];

type BrandLite = { id: string; name: string; domain: string };

/** Load the workspace's kits. null means the table is missing. */
function useKits(sb: SupabaseClient, workspaceId: string) {
  const [rows, setRows] = useState<KitRow[] | null | undefined>(undefined);
  const load = () =>
    sb
      .from("brand_kits")
      .select("key, brand_id, website, kit, learned_at, confirmed_at")
      .eq("workspace_id", workspaceId)
      .then(({ data, error }) => setRows(error ? (/brand_kits/.test(error.message) ? null : []) : ((data ?? []) as KitRow[]).map((r) => ({ ...r, kit: cleanKit(r.kit) }))));
  useEffect(() => {
    void load();
    // Once per workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);
  return { rows, reload: load };
}

export function BrandKitSettings({ sb, auth, canEdit, website: siteGuess, brands, clientKits }: { sb: SupabaseClient; auth: RunAuth; canEdit: boolean; website: string; brands: BrandLite[]; clientKits: boolean }) {
  const { rows, reload } = useKits(sb, auth.workspaceId);
  const [learning, setLearning] = useState<{ website: string; brandId: string | null } | null>(null);
  const [site, setSite] = useState(siteGuess);
  if (rows === undefined) return <p className="aw-small">Loading…</p>;
  if (rows === null) return <p className="aw-callout max-w-xl text-[15px]!">{NOT_RUN}</p>;
  const own = rows.find((r) => r.key === "workspace");

  if (learning)
    return (
      <KitLearn
        key={`${learning.website}|${learning.brandId}`}
        auth={auth}
        website={learning.website}
        brandId={learning.brandId}
        onDone={async () => {
          await sb.from("brand_kits").update({ confirmed_at: new Date().toISOString() }).eq("workspace_id", auth.workspaceId).eq("key", learning.brandId ?? "workspace");
          setLearning(null);
          void reload();
        }}
        onSkip={() => setLearning(null)}
      />
    );

  if (!own)
    return (
      <ToolIntro
        eyebrow="Brand Kit"
        title="Your brand, learned from your website"
        lead="Zippie reads your site and saves your logo, colors, fonts and voice. Your reports use it."
        action={
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (site.trim()) setLearning({ website: site.trim(), brandId: null });
            }}
          >
            <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="acme.com" aria-label="Website" className="aw-input w-64!" disabled={!canEdit} />
            <button type="submit" className="aw-btn aw-btn--accent" disabled={!canEdit || !site.trim()}>
              Learn my brand
            </button>
          </form>
        }
      />
    );

  return (
    <div className="flex flex-col gap-10">
      <KitEditor key={own.learned_at ?? "own"} sb={sb} workspaceId={auth.workspaceId} row={own} canEdit={canEdit} onLearn={() => setLearning({ website: own.website || siteGuess, brandId: null })} />
      {clientKits && brands.length ? (
        <section className="flex flex-col gap-3">
          <h3 className="aw-h4 mb-0!">Client brands</h3>
          <div className="aw-frame overflow-x-auto">
            <table className="aw-table aw-table--compact">
              <tbody>
                {brands.map((b) => {
                  const r = rows.find((x) => x.brand_id === b.id);
                  return (
                    <tr key={b.id}>
                      <td className="font-medium text-ink">{b.name}</td>
                      <td>
                        {r ? (
                          <span className="aw-kit__mini">
                            {[r.kit.colors.primary, r.kit.colors.secondary, r.kit.colors.ink].map((c, i) => (
                              <i key={i} style={{ background: c }} />
                            ))}
                          </span>
                        ) : (
                          <span className="aw-status aw-status--pending">Not learned</span>
                        )}
                      </td>
                      <td className="text-right">
                        {canEdit ? (
                          <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => setLearning({ website: r?.website || b.domain, brandId: b.id })}>
                            {r ? "Learn again" : "Learn"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** Every field of a kit, with a live cover next to it. Saves on the button. */
function KitEditor({ sb, workspaceId, row, canEdit, onLearn }: { sb: SupabaseClient; workspaceId: string; row: KitRow; canEdit: boolean; onLearn: () => void }) {
  const [kit, setKit] = useState<BrandKit>(row.kit);
  const [saved, setSaved] = useState<BrandKit>(row.kit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changed = JSON.stringify(kit) !== JSON.stringify(saved);
  const set = (patch: Partial<BrandKit>) => setKit((k) => ({ ...k, ...patch }));
  const setColor = (id: keyof KitColors, v: string) => set({ colors: { ...kit.colors, [id]: v } });
  // Text that will not read on the cards. Saving swaps it for a color that does.
  const weak = (["ink", "text", "muted"] as const).filter((k) => /^#[0-9a-f]{6}$/i.test(kit.colors[k]) && /^#[0-9a-f]{6}$/i.test(kit.colors.surface) && contrast(kit.colors[k], kit.colors.surface) < 4.5);

  async function save() {
    setBusy(true);
    setError("");
    const clean = cleanKit(kit, row.kit);
    const now = new Date().toISOString();
    const { error: e } = await sb.from("brand_kits").update({ kit: clean, confirmed_at: now, updated_at: now }).eq("workspace_id", workspaceId).eq("key", row.key);
    if (e) setError(e.message);
    else {
      setKit(clean);
      setSaved(clean);
    }
    setBusy(false);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) void save();
        }}
      >
        {error ? <p className="aw-error">{error}</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="aw-label">Name</span>
            <input className="aw-input" value={kit.name} maxLength={60} disabled={!canEdit} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="aw-label">Logo address</span>
            <input className="aw-input" value={kit.logo.startsWith("data:") ? "Logo from your site" : kit.logo} disabled={!canEdit || kit.logo.startsWith("data:")} placeholder="https://" onChange={(e) => set({ logo: e.target.value.trim() })} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-[14px] text-ink">
          <input type="checkbox" className="h-4 w-4 accent-[#0943B0]" checked={kit.logoOnDark} disabled={!canEdit} onChange={(e) => set({ logoOnDark: e.target.checked })} />
          The logo is light and needs a dark background
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="aw-label">Colors</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {COLOR_FIELDS.map((f) => (
              <label key={f.id} className="aw-kit__color">
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(kit.colors[f.id]) ? kit.colors[f.id] : "#000000"} disabled={!canEdit} onChange={(e) => setColor(f.id, e.target.value)} aria-label={f.label} />
                <span>
                  <small>{f.label}</small>
                  <input className="aw-num" value={kit.colors[f.id]} maxLength={7} disabled={!canEdit} onChange={(e) => setColor(f.id, e.target.value.trim())} aria-label={`${f.label} hex`} />
                </span>
              </label>
            ))}
          </div>
          {weak.length ? <p className="aw-small text-warn!">{weak.map((k) => COLOR_FIELDS.find((f) => f.id === k)?.label).join(" and ")} hard to read on cards. Saving picks a darker color.</p> : null}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <span className="aw-label">Heading font</span>
            <Dropdown label="Heading font" value={kit.fonts.heading} disabled={!canEdit} onChange={(v) => set({ fonts: { ...kit.fonts, heading: v } })} options={FONTS.map((f) => ({ id: f, label: f }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="aw-label">Text font</span>
            <Dropdown label="Text font" value={kit.fonts.body} disabled={!canEdit} onChange={(v) => set({ fonts: { ...kit.fonts, body: v } })} options={FONTS.map((f) => ({ id: f, label: f }))} />
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="aw-label">Corners (px)</span>
            <input type="number" min={0} max={28} className="aw-input aw-num" value={kit.radius} disabled={!canEdit} onChange={(e) => set({ radius: Number(e.target.value) })} />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="aw-label">Footer line</span>
            <input className="aw-input" value={kit.footer} maxLength={140} disabled={!canEdit} placeholder="hello@acme.com · acme.com" onChange={(e) => set({ footer: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="aw-label">Tone of voice</span>
            <input className="aw-input" value={kit.voice.tone.join(", ")} disabled={!canEdit} placeholder="Clear, warm, expert" onChange={(e) => set({ voice: { ...kit.voice, tone: e.target.value.split(",").map((t) => t.trim()).slice(0, 3) } })} />
          </label>
        </div>

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="aw-btn aw-btn--primary" disabled={busy || !changed}>
              Save
            </button>
            {changed ? (
              <button type="button" className="aw-btn aw-btn--secondary" onClick={() => setKit(saved)}>
                Discard changes
              </button>
            ) : null}
            <button type="button" className="aw-text-link ml-auto" onClick={onLearn}>
              Learn again{row.website ? ` from ${row.website}` : ""}
            </button>
          </div>
        ) : null}
      </form>
      <div className="flex flex-col gap-2 lg:sticky lg:top-6 lg:self-start">
        <KitCover kit={cleanKit(kit, row.kit)} />
      </div>
    </div>
  );
}
