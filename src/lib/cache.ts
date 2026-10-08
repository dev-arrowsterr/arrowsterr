import "server-only";
import { adminClient } from "./serverAuth";

// Shared cache for DataForSEO results, stored in Supabase. Works across every workspace and survives restarts.
// Without SUPABASE_SECRET_KEY or the table, it simply calls through.

export const DAY = 864e5;
const memory = new Map<string, { at: number; data: unknown }>();

/** A saved result younger than `maxAge`, or undefined. */
export async function readCache<T>(key: string, maxAge: number): Promise<T | undefined> {
  const mem = memory.get(key);
  if (mem && Date.now() - mem.at < maxAge) return mem.data as T;
  const db = adminClient();
  if (!db) return undefined;
  const { data } = await db.from("keyword_cache").select("data, created_at").eq("key", key).maybeSingle();
  if (!data || Date.now() - Date.parse(data.created_at) >= maxAge) return undefined;
  memory.set(key, { at: Date.parse(data.created_at), data: data.data });
  return data.data as T;
}

export async function writeCache(key: string, data: unknown) {
  memory.set(key, { at: Date.now(), data });
  if (memory.size > 2000) memory.delete(memory.keys().next().value!);
  const db = adminClient();
  if (db) await db.from("keyword_cache").upsert({ key, data, created_at: new Date().toISOString() });
}

/** Read `key` if it is younger than `maxAge`, or run `load` and save the result. */
export async function cached<T>(key: string, maxAge: number, load: () => Promise<T>): Promise<{ data: T; hit: boolean }> {
  const hit = await readCache<T>(key, maxAge);
  if (hit !== undefined) return { data: hit, hit: true };
  const fresh = await load();
  await writeCache(key, fresh);
  return { data: fresh, hit: false };
}
