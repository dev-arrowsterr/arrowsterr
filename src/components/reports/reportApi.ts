import type { RunAuth } from "@/lib/runner";

/** POST to a report route as the signed-in member. Throws the route's error text. */
export async function post<T>(auth: RunAuth, path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` },
    body: JSON.stringify({ ...body, workspaceId: auth.workspaceId }),
  });
  const out = await res.json().catch(() => ({ error: `The server returned ${res.status}.` }));
  if (!res.ok) throw Object.assign(new Error(out.error || `Error ${res.status}`), { limit: Boolean(out.limit) });
  return out as T;
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "2h ago", "3d ago", or a date. */
export function ago(iso: string | null | undefined) {
  if (!iso) return "–";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
