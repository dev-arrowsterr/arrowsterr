/** Lowercase, trimmed, no repeats, at most 8. */
export function cleanTopicList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((t): t is string => typeof t === "string").map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 8);
}
