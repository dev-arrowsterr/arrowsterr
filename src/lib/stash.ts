"use client";

import { useCallback, useState, type SetStateAction } from "react";

// Remembers what someone was doing in each tool: their search, results and tab.
// Kept in memory while the app is open and in this browser tab's session storage, so switching
// pages or reloading brings it back. Cleared on sign out.

const PREFIX = "aw:";
const mem = new Map<string, unknown>();

function read<T>(key: string): T | undefined {
  if (mem.has(key)) return mem.get(key) as T;
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (raw !== null) {
      const v = JSON.parse(raw) as T;
      mem.set(key, v);
      return v;
    }
  } catch {
    // Storage blocked or full. Memory still works.
  }
  return undefined;
}

function write(key: string, v: unknown) {
  mem.set(key, v);
  try {
    const s = JSON.stringify(v);
    if (s.length < 1_500_000) sessionStorage.setItem(PREFIX + key, s);
    else sessionStorage.removeItem(PREFIX + key);
  } catch {
    // Storage blocked or full. Memory still works.
  }
}

/** Like useState, but the value survives page switches and reloads. Use a key that names the tool and the website. */
export function useStash<T>(key: string, init: T | (() => T)) {
  const [v, setV] = useState<T>(() => {
    const saved = read<T>(key);
    return saved !== undefined ? saved : typeof init === "function" ? (init as () => T)() : init;
  });
  const set = useCallback(
    (next: SetStateAction<T>) =>
      setV((prev) => {
        const val = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        write(key, val);
        return val;
      }),
    [key],
  );
  return [v, set] as const;
}

/** Set a saved value from outside the tool, like opening a draft from the calendar. */
export const putStash = (key: string, v: unknown) => write(key, v);

/** A saved value outside React, for loaders that want to skip a fetch. */
export const peek = <T,>(key: string) => read<T>(key);

/** Forget everything, for sign out. */
export function clearStash() {
  mem.clear();
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(PREFIX)) sessionStorage.removeItem(k);
  } catch {
    // Nothing to clear.
  }
}
