"use client";

import { useState } from "react";

/** The password form for a protected share link. */
export function UnlockForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/r/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : { error: "Could not reach the server." };
    if (res?.ok) return window.location.reload();
    setBusy(false);
    setError(data.error ?? "That password is not right.");
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 border border-rule bg-surface p-6">
      <h1 className="text-lg font-semibold text-ink">This report has a password</h1>
      <input type="password" className="aw-input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoFocus autoComplete="off" />
      {error ? <p className="text-sm text-neg">{error}</p> : null}
      <button type="submit" className="aw-btn aw-btn--primary" disabled={busy || !password}>
        {busy ? "Opening…" : "Open report"}
      </button>
    </form>
  );
}
