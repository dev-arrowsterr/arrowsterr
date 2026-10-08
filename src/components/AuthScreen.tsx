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
      className={`flex-1 px-3 py-2 text-[15px] font-medium ${mode === m ? "bg-ink text-white" : "text-body hover:bg-paper"}`}
    >
      {label}
    </button>
  );

  return (
    <Frame>
      {mode === "forgot" ? (
        <h1 className="aw-h3 mb-0!">Reset your password</h1>
      ) : (
        <div role="tablist" className="flex gap-2 border border-rule p-1">
          {tab("signin", "Sign in")}
          {tab("signup", "Create account")}
        </div>
      )}
      {invited ? (
        <p className="aw-callout text-[15px]!">You were invited to a workspace. Use the email address the invite was sent to.</p>
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
