"use client";

import { useEffect } from "react";

/** Counts one view of a share link, at most once a day per browser. */
export function LinkViews({ token }: { token: string }) {
  useEffect(() => {
    const key = `rl_seen_${token.slice(0, 16)}`;
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (localStorage.getItem(key) === today) return;
      localStorage.setItem(key, today);
    } catch {
      // Private windows may block storage. The view still counts.
    }
    void fetch("/api/r/view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => {});
  }, [token]);
  return null;
}
