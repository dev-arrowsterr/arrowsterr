import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanKit, type BrandKit } from "./brandKit";
import { cleanVoice, type BrandVoice } from "./brandVoice";

// Everything a writer needs to sound and look like one brand: its voice, its kit and its guidelines.
// A minimal version for the Agentic Writer; the Brand page's version replaces it on merge.

export type BrandContext = { voice: BrandVoice | null; kit: BrandKit | null; guidelines: { body: string; links: string[] } | null };

/** A brand's voice (047), its Brand Kit (045) and its guidelines. A missing part is null. */
export async function loadBrandContext(db: SupabaseClient, brandId: string): Promise<BrandContext> {
  const [v, k] = await Promise.all([
    db.from("brand_voices").select("voice").eq("brand_id", brandId).maybeSingle(),
    db.from("brand_kits").select("kit").eq("brand_id", brandId).maybeSingle(),
  ]);
  const voice = !v.error && v.data?.voice ? cleanVoice(v.data.voice) : null;
  const kit = !k.error && k.data?.kit ? cleanKit(k.data.kit) : null;
  return { voice, kit, guidelines: null };
}
