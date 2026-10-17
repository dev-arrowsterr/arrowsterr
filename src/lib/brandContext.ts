import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanGuidelines, kitForBrand } from "./brandGuidelines";
import type { BrandKit } from "./brandKit";
import { cleanVoice, type BrandVoice } from "./brandVoice";

/** Everything the Brand page holds about one brand, for the Agentic Writer's prompts. */
export type BrandContext = {
  voice: BrandVoice | null;
  kit: BrandKit | null;
  guidelines: { body: string; links: string[] } | null;
};

/**
 * A brand's Tone of voice, Brand Kit and written guidelines (docs/content-v2.md, Brand). Each part is null when
 * it isn't set up yet, or its table is missing. Uploaded reference files are left out; the page shows them.
 * db reads with its own access: the server's client reads any brand, a person's client only their workspace's.
 */
export async function loadBrandContext(db: SupabaseClient, brandId: string): Promise<BrandContext> {
  const none: BrandContext = { voice: null, kit: null, guidelines: null };
  const { data: brand } = await db.from("brands").select("id, workspace_id, domain").eq("id", brandId).maybeSingle();
  if (!brand) return none;
  const b = brand as { id: string; workspace_id: string; domain: string };
  const [voice, kits, count, guide] = await Promise.all([
    db.from("brand_voices").select("voice").eq("brand_id", b.id).maybeSingle(),
    db.from("brand_kits").select("key, website, kit").eq("workspace_id", b.workspace_id).in("key", [b.id, "workspace"]),
    db.from("brands").select("id", { count: "exact", head: true }).eq("workspace_id", b.workspace_id),
    db.from("brand_guidelines").select("brand_id, body, links, files, updated_at").eq("brand_id", b.id).maybeSingle(),
  ]);
  const v = (voice.data as { voice: unknown } | null)?.voice;
  const g = cleanGuidelines(guide.data);
  return {
    voice: v ? cleanVoice(v) : null,
    kit: kits.data ? kitForBrand(kits.data as { key: string; website: string | null; kit: unknown }[], b, count.count ?? 1) : null,
    guidelines: g && (g.body.trim() || g.links.length) ? { body: g.body, links: g.links } : null,
  };
}
