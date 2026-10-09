"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";
import { Logo } from "./Logo";

type Mode = "signin" | "signup" | "forgot";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="aw-dotgrid flex min-h-screen justify-center px-4 py-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <Logo size="md" />
        <div className="aw-frame">
          <div className="aw-frame__body flex flex-col gap-5">{children}</div>
        </div>
      </div>
    </main>
  );
}

/** Sign in, create an account, or reset a password. */
export function AuthScreen({ sb, invited }: { sb: SupabaseClient; invited: boolean }) {
  const [mode, setMode] = useState<Mode>(invited ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSent("");
    try {
      const redirect = window.location.origin;
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
        if (error) throw error;
        if (!data.session) setSent(`We sent a link to ${email}. Click it to finish creating your account.`);
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect });
        if (error) throw error;
        setSent(`If ${email} has an account, a reset link is on its way.`);
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    setError("");
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + window.location.pathname } });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => {
        setMode(m);
        setError("");
        setSent("");
      }}
      className={`flex-1 px-3 py-2 text-[15px] font-medium ${mode === m ? "bg-brand text-white" : "text-body hover:bg-surface-2"}`}
    >
      {label}
    </button>
  );

  return (
    <Frame>
      {mode === "forgot" ? (
        <h1 className="aw-h3 mb-0!">Reset your password</h1>
      ) : (
        <div role="tablist" className="flex gap-2 rounded-aw border border-rule bg-surface-2 p-1">
          {tab("signin", "Sign in")}
          {tab("signup", "Create account")}
        </div>
      )}
      {invited ? (
        <p className="aw-callout">You were invited to a workspace. Use the email address the invite was sent to.</p>
      ) : null}
      {mode !== "forgot" ? (
        <>
          <button type="button" className="aw-btn aw-btn--secondary aw-btn--block gap-3" onClick={google} disabled={busy}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            Continue with Google
          </button>
          <div className="flex items-center gap-3 text-[13px] text-muted">
            <span className="h-px flex-1 bg-rule" />
            or
            <span className="h-px flex-1 bg-rule" />
          </div>
        </>
      ) : null}
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div>
          <label className="aw-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            className="aw-input"
          />
        </div>
        {mode !== "forgot" ? (
          <div>
            <label className="aw-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              minLength={mode === "signup" ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="aw-input"
            />
            {mode === "signup" ? <p className="aw-small mt-2">At least 8 characters.</p> : null}
          </div>
        ) : null}
        {error ? <p className="aw-error">{error}</p> : null}
        {sent ? <p className="aw-callout text-[15px]!">{sent}</p> : null}
        <button type="submit" className="aw-btn aw-btn--primary aw-btn--block" disabled={busy}>
          {busy ? "Please wait..." : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
        </button>
      </form>
      {mode === "signin" ? (
        <button type="button" className="aw-text-link self-start" onClick={() => setMode("forgot")}>
          Forgot your password?
        </button>
      ) : mode === "forgot" ? (
        <button type="button" className="aw-text-link self-start" onClick={() => setMode("signin")}>
          Back to sign in
        </button>
      ) : null}
    </Frame>
  );
}

/** Shown after a password reset link is clicked. */
export function NewPassword({ sb, onDone }: { sb: SupabaseClient; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await sb.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  }

  return (
    <Frame>
      <h1 className="aw-h3 mb-0!">Choose a new password</h1>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div>
          <label className="aw-label" htmlFor="new-password">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            className="aw-input"
          />
        </div>
        {error ? <p className="aw-error">{error}</p> : null}
        <button type="submit" className="aw-btn aw-btn--primary aw-btn--block" disabled={busy}>
          {busy ? "Saving..." : "Save password"}
        </button>
      </form>
    </Frame>
  );
}
