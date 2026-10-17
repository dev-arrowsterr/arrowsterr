"use client";

import { useEffect, useState } from "react";
import { cleanVoice, MAX_URLS, type BrandVoice, type VoiceRow } from "@/lib/brandVoice";
import type { RunAuth } from "@/lib/runner";
import { post } from "./research/shared";
import { Thinking } from "./ui";

type Form = { tone: string; sentences: string; use: string; avoid: string; naming: string; reader: string };
const toForm = (v: BrandVoice): Form => ({ tone: v.tone.join(", "), sentences: v.sentences, use: v.use.join(", "), avoid: v.avoid.join(", "), naming: v.naming, reader: v.reader });
const FIELDS: { id: keyof Form; label: string; area?: boolean }[] = [
  { id: "tone", label: "Tone" },
  { id: "sentences", label: "Sentence length" },
  { id: "use", label: "Words to use", area: true },
  { id: "avoid", label: "Words to avoid", area: true },
  { id: "naming", label: "How the brand names itself and its product" },
  { id: "reader", label: "Target reader" },
];

/** Brand › Tone of voice: paste links or text, distill, check the fields, save. */
export function BrandVoiceSettings({ auth, brand, canEdit }: { auth: RunAuth; brand: { id: string; name: string }; canEdit: boolean }) {
  const [row, setRow] = useState<VoiceRow | null | undefined>(undefined);
  const [setup, setSetup] = useState("");
  const [urls, setUrls] = useState("");
  const [text, setText] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [fresh, setFresh] = useState(false); // the fields came from a distill that isn't saved yet
  const [busy, setBusy] = useState<"" | "distill" | "save">("");
  const [error, setError] = useState("");
  const [skipped, setSkipped] = useState<{ url: string; error: string }[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    post<{ row: VoiceRow | null; setup?: string }>(auth, "/api/brand-voice", { action: "get", brandId: brand.id })
      .then((r) => {
        if (!live) return;
        setRow(r.row);
        setSetup(r.setup ?? "");
        setUrls(r.row?.sample_urls.join("\n") ?? "");
        setText(r.row?.sample_text ?? "");
        setForm(r.row?.voice ? toForm(cleanVoice(r.row.voice)) : null);
      })
      .catch((e) => {
        if (!live) return;
        setRow(null);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [auth, brand.id]);

  async function distill() {
    setBusy("distill");
    setError("");
    setSkipped([]);
    setSaved(false);
    try {
      const r = await post<{ voice: BrandVoice; skipped: { url: string; error: string }[] }>(auth, "/api/brand-voice", { action: "distill", brandId: brand.id, urls, text });
      setForm(toForm(r.voice));
      setSkipped(r.skipped);
      setFresh(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  async function save() {
    if (!form) return;
    setBusy("save");
    setError("");
    try {
      const r = await post<{ row: VoiceRow }>(auth, "/api/brand-voice", { action: "save", brandId: brand.id, urls, text, voice: form, distilled: fresh });
      setRow(r.row);
      setForm(toForm(cleanVoice(r.row.voice)));
      setFresh(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  if (row === undefined) return <Thinking text="Loading..." />;
  const lines = urls.split(/[\s,]+/).filter(Boolean).length;
  return (
    <section className="flex max-w-2xl flex-col gap-5">
      <p className="text-[13px] text-muted">How {brand.name} writes. Every article is written from it.</p>
      {setup ? <div className="aw-callout">{setup}</div> : null}
      {error ? <p className="aw-error">{error}</p> : null}

      <div className="aw-frame flex flex-col gap-4 p-5">
        <label className="flex flex-col gap-1.5">
          <span className="flex items-center justify-between">
            <span className="aw-label">Links to your best writing</span>
            <span className="aw-num text-[11px] text-muted">
              {lines} / {MAX_URLS}
            </span>
          </span>
          <textarea value={urls} disabled={!canEdit} onChange={(e) => setUrls(e.target.value)} rows={4} placeholder={`https://${brand.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com/blog/...`} className="aw-textarea text-[13px]!" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="aw-label">Or paste text</span>
          <textarea value={text} disabled={!canEdit} onChange={(e) => setText(e.target.value)} rows={5} className="aw-textarea text-[13px]!" />
        </label>
        {skipped.length ? (
          <ul className="flex flex-col gap-1 text-[12px] text-muted">
            {skipped.map((s) => (
              <li key={s.url}>
                Skipped {s.url}: {s.error}
              </li>
            ))}
          </ul>
        ) : null}
        {canEdit ? (
          <button type="button" className={`aw-btn ${form ? "aw-btn--secondary" : "aw-btn--primary"} aw-btn--sm self-start`} disabled={Boolean(busy) || Boolean(setup) || (!urls.trim() && !text.trim())} onClick={distill}>
            {busy === "distill" ? "Distilling..." : form ? "Distill again" : "Distill"}
          </button>
        ) : null}
      </div>

      {busy === "distill" ? <Thinking text="Reading your pages..." /> : null}

      {form ? (
        <div className="aw-frame flex flex-col gap-4 p-5">
          {FIELDS.map((f) => (
            <label key={f.id} className="flex flex-col gap-1.5">
              <span className="aw-label">{f.label}</span>
              {f.area ? (
                <textarea value={form[f.id]} disabled={!canEdit} onChange={(e) => setForm({ ...form, [f.id]: e.target.value })} rows={2} className="aw-textarea text-[13px]!" />
              ) : (
                <input value={form[f.id]} disabled={!canEdit} onChange={(e) => setForm({ ...form, [f.id]: e.target.value })} className="aw-input py-2! text-[14px]!" />
              )}
            </label>
          ))}
          {canEdit ? (
            <span className="flex items-center gap-3">
              <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" disabled={Boolean(busy)} onClick={save}>
                {busy === "save" ? "Saving..." : "Save"}
              </button>
              {saved ? <span className="text-[12px] text-muted">Saved</span> : fresh ? <span className="text-[12px] text-muted">Not saved</span> : row?.updated_at ? <span className="text-[12px] text-muted">Saved {new Date(row.updated_at).toLocaleDateString()}</span> : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
