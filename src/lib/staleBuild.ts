// A tab left open across a deploy can load code from two builds at once. That breaks in odd ways,
// like "l is not a function". One full reload fixes it, so the error pages do that once per minute.
const KEY = "aw.reloadedAt";

/** True for errors that come from a stale or missing chunk rather than a bug on the page. */
export function looksStale(error: Error) {
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|is not a function|is not a constructor|Cannot read properties of undefined \(reading 'call'\)/i.test(`${error.name} ${error.message}`);
}

/** Reload the page once for a stale-build error. Returns true when a reload started. */
export function reloadOnce(error: Error) {
  if (typeof window === "undefined" || !looksStale(error)) return false;
  try {
    const last = Number(sessionStorage.getItem(KEY)) || 0;
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
