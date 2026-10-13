import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiSettings } from "./db";

/** The workspace's own notes for the AI (Settings → AI), as lines for a prompt. Empty when there are none. */
export async function aiContext(sb: SupabaseClient, workspaceId: string): Promise<string> {
  const { data, error } = await sb.from("workspaces").select("ai_settings").eq("id", workspaceId).maybeSingle();
  if (error || !data?.ai_settings) return "";
  const s = data.ai_settings as AiSettings;
  const lines = [
    s.about?.trim() ? `About the business: ${s.about.trim()}` : "",
    s.audience?.trim() ? `Who we write for: ${s.audience.trim()}` : "",
    s.voice?.trim() ? `How we write: ${s.voice.trim()}` : "",
    s.avoid?.trim() ? `Never do or say: ${s.avoid.trim()}` : "",
  ].filter(Boolean);
  return lines.length ? `The team's own notes for the AI (these come first when they disagree with anything else):\n${lines.join("\n")}` : "";
}
