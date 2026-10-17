"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";
import type { RunAuth } from "@/lib/runner";
import { BrandGuidelines } from "./BrandGuidelines";
import { BrandKitPanel } from "./BrandKit";
import { BrandVoiceSettings } from "./BrandVoice";

type Section = "voice" | "kit" | "guidelines";
const SECTIONS: { id: Section; label: string }[] = [
  { id: "voice", label: "Tone of voice" },
  { id: "kit", label: "Brand Kit" },
  { id: "guidelines", label: "Guidelines" },
];
const SECTION_KEY = "arrowsterr.brandSection"; // each person's last section, kept in this browser
const readSection = (): Section => {
  try {
    const v = localStorage.getItem(SECTION_KEY);
    return v === "kit" || v === "guidelines" ? v : "voice";
  } catch {
    return "voice";
  }
};

/**
 * Brand (docs/content-v2.md): everything the Agentic Writer writes from, for the brand on screen. Tone of voice,
 * the Brand Kit and written guidelines, one section at a time beside a sub-nav. The writer reads all three
 * through loadBrandContext in src/lib/brandContext.ts.
 */
export function BrandPage({ sb, auth, brand, brandCount, canEdit }: { sb: SupabaseClient; auth: RunAuth; brand: { id: string; name: string; domain: string }; brandCount: number; canEdit: boolean }) {
  const [section, setSectionState] = useState<Section>(readSection);
  const setSection = (s: Section) => {
    setSectionState(s);
    try {
      localStorage.setItem(SECTION_KEY, s);
    } catch {}
  };
  return (
    <div className="flex flex-col gap-6 md:flex-row md:gap-10">
      <nav className="flex shrink-0 flex-col gap-4 md:sticky md:top-6 md:w-52 md:self-start" aria-label="Brand">
        <h1 className="aw-h2 mb-0!">Brand</h1>
        <div className="flex flex-col gap-0.5">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" aria-current={section === s.id ? "page" : undefined} onClick={() => setSection(s.id)} className={`aw-mod__item ${section === s.id ? "is-on" : ""}`}>
              {s.label}
            </button>
          ))}
        </div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <h2 className="aw-h3 mb-0!">{SECTIONS.find((s) => s.id === section)?.label}</h2>
        {section === "voice" ? (
          <BrandVoiceSettings key={brand.id} auth={auth} brand={brand} canEdit={canEdit} />
        ) : section === "kit" ? (
          <BrandKitPanel key={brand.id} sb={sb} auth={auth} canEdit={canEdit} brand={brand} brandCount={brandCount} />
        ) : (
          <BrandGuidelines key={brand.id} sb={sb} workspaceId={auth.workspaceId} brand={brand} canEdit={canEdit} />
        )}
      </div>
    </div>
  );
}
