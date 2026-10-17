import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupaConfig = { url: string; key: string };

let client: SupabaseClient | null = null;

/** One Supabase client for the browser. Sessions are kept in this browser and refresh on their own. */
export function getSupabase({ url, key }: SupaConfig): SupabaseClient {
  client ??= createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
  });
  return client;
}

/** The browser's client, once the app has made it. Pages that aren't handed one use this. */
export function currentSupabase(): SupabaseClient {
  if (!client) throw new Error("Supabase is not set up yet.");
  return client;
}
