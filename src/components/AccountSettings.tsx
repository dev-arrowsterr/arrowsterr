"use client";

import type { Factor, SupabaseClient, User } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { Dropdown } from "./Pickers";
import { ROLES } from "./Onboarding";
import { avatarFromFile } from "./WorkspaceAvatar";
import { getProfile, saveProfile, type UserProfile } from "@/lib/db";
import { recordUndo } from "@/lib/undo";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A saved note or an error, shown at the top of a settings page. */
function Status({ error, saved }: { error: string; saved: string }) {
  if (error) return <p className="aw-error">{error}</p>;
  if (saved) return <p className="aw-callout text-[15px]!">{saved}</p>;
  return null;
}

/** A person's photo, or their first letter on brand blue. */
export function PersonAvatar({ src, name, size = 32 }: { src: string | null | undefined; name: string; size?: number }) {
  if (src)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-brand font-medium text-white" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

type Meta = {
  first_name?: string;
  last_name?: string;
  role?: string;
  full_name?: string;
  name?: string;
};

/** Your name, role, photo and email. */
export function ProfileSettings({ sb, user }: { sb: SupabaseClient; user: User }) {
  const meta = (user.user_metadata ?? {}) as Meta;
  const [guessFirst = "", ...guessLast] = String(meta.full_name ?? meta.name ?? "")
    .trim()
    .split(/\s+/);
  const [first, setFirst] = useState(meta.first_name ?? guessFirst);
  const [last, setLast] = useState(meta.last_name ?? guessLast.join(" "));
  const [role, setRole] = useState(meta.role ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    getProfile(sb, user.id).then(setProfile);
  }, [sb, user.id]);

  const fullName = [first.trim(), last.trim()].filter(Boolean).join(" ");
  const changed = first !== (meta.first_name ?? guessFirst) || last !== (meta.last_name ?? guessLast.join(" ")) || role !== (meta.role ?? "");

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await fn();
      setSaved(done);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function photo(avatar: string | null) {
    await run(
      async () => {
        await saveProfile(sb, user.id, { avatar, full_name: fullName || null });
        setProfile((p) => ({ full_name: p?.full_name ?? null, avatar }));
      },
      avatar ? "Photo saved." : "Photo removed.",
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-8">
      <Status error={error} saved={saved} />

      <section className="flex flex-col gap-3">
        <span className="aw-label mb-0!">Photo</span>
        <div className="flex items-center gap-4">
          <PersonAvatar src={profile?.avatar} name={fullName || email} size={56} />
          {profile === null ? (
            <span className="text-[13px] text-muted">Photos turn on once supabase/034_settings.sql has been run.</span>
          ) : (
            <>
              <label className="aw-btn aw-btn--secondary aw-btn--sm cursor-pointer">
                Upload photo
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={busy || profile === undefined}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    try {
                      await photo(await avatarFromFile(file));
                    } catch (err) {
                      setError(message(err));
                    }
                  }}
                />
              </label>
              {profile?.avatar ? (
                <button type="button" className="aw-text-link text-[13px]" disabled={busy} onClick={() => photo(null)}>
                  Remove
                </button>
              ) : null}
            </>
          )}
        </div>
      </section>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const { error: err } = await sb.auth.updateUser({
              data: {
                first_name: first.trim(),
                last_name: last.trim(),
                role: role || null,
                full_name: fullName,
              },
            });
            if (err) throw err;
            if (profile !== null) await saveProfile(sb, user.id, { full_name: fullName || null });
          }, "Profile saved.");
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="aw-label" htmlFor="pf-first">
              First name
            </label>
            <input id="pf-first" className="aw-input" value={first} onChange={(e) => setFirst(e.target.value)} maxLength={60} autoComplete="given-name" />
          </div>
          <div>
            <label className="aw-label" htmlFor="pf-last">
              Last name
            </label>
            <input id="pf-last" className="aw-input" value={last} onChange={(e) => setLast(e.target.value)} maxLength={60} autoComplete="family-name" />
          </div>
        </div>
        <div>
          <span className="aw-label">Your role</span>
          <Dropdown label="Your role" value={role} onChange={setRole} placeholder="Pick one" className="aw-dropdown--field w-full" options={ROLES.map((r) => ({ id: r, label: r }))} />
        </div>
        <div>
          <button type="submit" className="aw-btn aw-btn--primary" disabled={busy || !changed}>
            Save profile
          </button>
        </div>
      </form>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const { error: err } = await sb.auth.updateUser({ email: email.trim() }, { emailRedirectTo: window.location.origin });
            if (err) throw err;
          }, `We sent a link to ${email.trim()}. Open it to finish the change. Until then you still sign in with ${user.email}.`);
        }}
      >
        <label className="aw-label mb-0!" htmlFor="pf-email">
          Email
        </label>
        <div className="flex gap-3">
          <input id="pf-email" type="email" className="aw-input" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          <button type="submit" className="aw-btn aw-btn--secondary" disabled={busy || email.trim().toLowerCase() === (user.email ?? "").toLowerCase()}>
            Change
          </button>
        </div>
      </form>
    </div>
  );
}

/** Password, 2-step sign-in, and signing out other devices. */
export function SecuritySettings({ sb, user }: { sb: SupabaseClient; user: User }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [setup, setSetup] = useState<{
    id: string;
    qr: string;
    secret: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const google = (user.app_metadata?.providers as string[] | undefined)?.includes("google");

  const load = useCallback(async () => {
    const { data } = await sb.auth.mfa.listFactors();
    setFactors((data?.all ?? []).filter((f) => f.factor_type === "totp" && f.status === "verified"));
  }, [sb]);

  useEffect(() => {
    // Loading from Supabase on first render is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await fn();
      setSaved(done);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    await run(async () => {
      // A setup that was never finished blocks a new one, so clear it first.
      const { data: list } = await sb.auth.mfa.listFactors();
      for (const f of list?.all ?? []) if (f.status === "unverified") await sb.auth.mfa.unenroll({ factorId: f.id });
      const { data, error: err } = await sb.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
      });
      if (err) throw err;
      setSetup({
        id: data.id,
        qr: data.totp.qr_code,
        secret: data.totp.secret,
      });
      setCode("");
    }, "");
  }

  const on = Boolean(factors?.length);

  return (
    <div className="flex max-w-xl flex-col gap-10">
      <Status error={error} saved={saved} />

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (password !== again) return setError("The two passwords do not match.");
          run(async () => {
            const { error: err } = await sb.auth.updateUser({ password });
            if (err) throw err;
            setPassword("");
            setAgain("");
          }, "Password changed.");
        }}
      >
        <div>
          <h3 className="aw-h4">Password</h3>
          <p className="aw-small mt-1">{google ? "You sign in with Google. Set a password to also sign in with your email." : "At least 8 characters."}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="aw-label" htmlFor="sec-new">
              New password
            </label>
            <input id="sec-new" type="password" className="aw-input" minLength={8} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div>
            <label className="aw-label" htmlFor="sec-again">
              Type it again
            </label>
            <input id="sec-again" type="password" className="aw-input" minLength={8} required autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </div>
        </div>
        <div>
          <button type="submit" className="aw-btn aw-btn--primary" disabled={busy || !password}>
            Change password
          </button>
        </div>
      </form>

      <section className="flex flex-col gap-4">
        <div>
          <h3 className="aw-h4">
            2-step sign-in <span className={`aw-tag ml-2 ${on ? "" : "text-muted"}`}>{factors === null ? "…" : on ? "On" : "Off"}</span>
          </h3>
          <p className="aw-small mt-1">After your password or Google, enter a 6-digit code from an app like Google Authenticator, 1Password or Authy.</p>
        </div>
        {setup ? (
          <form
            className="flex flex-col gap-4 rounded-aw border border-rule p-5"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const { error: err } = await sb.auth.mfa.challengeAndVerify({
                  factorId: setup.id,
                  code: code.trim(),
                });
                if (err) throw err;
                setSetup(null);
                await load();
              }, "2-step sign-in is on. You will need a code each time you sign in.");
            }}
          >
            <p className="text-[14px] text-body">1. Scan this with your authenticator app.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="QR code for your authenticator app" width={176} height={176} className="rounded-aw border border-rule bg-white p-2" />
            <p className="text-[13px] text-muted">
              Can&apos;t scan? Type this key: <code className="aw-mono break-all text-ink">{setup.secret}</code>
            </p>
            <label className="text-[14px] text-body" htmlFor="sec-code">
              2. Enter the 6-digit code it shows.
            </label>
            <div className="flex gap-3">
              <input
                id="sec-code"
                className="aw-input aw-mono max-w-40"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
              <button type="submit" className="aw-btn aw-btn--primary" disabled={busy || code.length !== 6}>
                Turn on
              </button>
              <button
                type="button"
                className="aw-btn aw-btn--secondary"
                onClick={() => {
                  sb.auth.mfa.unenroll({ factorId: setup.id });
                  setSetup(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : on ? (
          <div>
            <button
              type="button"
              className="aw-btn aw-btn--secondary"
              disabled={busy}
              onClick={() => {
                if (!confirm("Turn off 2-step sign-in? You will only need your password or Google to sign in.")) return;
                run(async () => {
                  for (const f of factors ?? []) {
                    const { error: err } = await sb.auth.mfa.unenroll({
                      factorId: f.id,
                    });
                    if (err) throw err;
                  }
                  await load();
                }, "2-step sign-in is off.");
              }}
            >
              Turn off
            </button>
          </div>
        ) : (
          <div>
            <button type="button" className="aw-btn aw-btn--primary" disabled={busy || factors === null} onClick={start}>
              Turn on 2-step sign-in
            </button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h3 className="aw-h4">Other devices</h3>
          <p className="aw-small mt-1">Sign out on every other computer and phone. You stay signed in here.</p>
        </div>
        <div>
          <button
            type="button"
            className="aw-btn aw-btn--secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const { error: err } = await sb.auth.signOut({
                  scope: "others",
                });
                if (err) throw err;
              }, "Signed out everywhere else.")
            }
          >
            Sign out other devices
          </button>
        </div>
      </section>
    </div>
  );
}

type Prefs = { weekly: boolean; alerts: boolean; jobs: boolean };
const NOTIFY: { id: keyof Prefs; label: string; hint: string }[] = [
  { id: "weekly", label: "Weekly summary", hint: "Monday morning: each brand's AI visibility for the week, against the week before, and the brands AI named most." },
  { id: "alerts", label: "Visibility alerts", hint: "When a brand's AI visibility moves by your alert size, or a competitor overtakes it. Checked after each daily run." },
  { id: "jobs", label: "Content Plan and briefs", hint: "When a Content Plan or a brief you started is ready, or didn't finish." },
];

/** Which emails you get from this workspace. */
export function NotificationSettings({ sb, wsId, wsName, userId, alertsOnPlan }: { sb: SupabaseClient; wsId: string; wsName: string; userId: string; alertsOnPlan: boolean }) {
  const [prefs, setPrefs] = useState<Prefs | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    sb.from("notification_prefs")
      .select("weekly, alerts, jobs")
      .eq("workspace_id", wsId)
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error: err }) => setPrefs(err ? null : ((data as Prefs | null) ?? { weekly: true, alerts: true, jobs: true })));
  }, [sb, wsId, userId]);

  async function set(next: Prefs, was: Prefs) {
    setError("");
    setPrefs(next);
    const { error: err } = await sb.from("notification_prefs").upsert({ workspace_id: wsId, user_id: userId, ...next, updated_at: new Date().toISOString() }, { onConflict: "workspace_id,user_id" });
    if (err) {
      setPrefs(was);
      setError(err.message);
    } else recordUndo({ label: "the email change", undo: () => set(was, next), redo: () => set(next, was) });
  }

  if (prefs === null) return <p className="aw-callout max-w-xl text-[15px]!">Email choices turn on once supabase/035_notifications.sql has been run in Supabase → SQL Editor. Until then, every email is on.</p>;
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <p className="text-[15px] text-body">
        Emails from <strong className="text-ink">{wsName}</strong>, sent to you only. Each person in the workspace picks their own.
      </p>
      {error ? <p className="aw-error">{error}</p> : null}
      <div className="aw-table-wrap">
        <table className="aw-table">
          <tbody>
            {NOTIFY.map((n) => (
              <tr key={n.id}>
                <td>
                  <div className="font-medium text-ink">
                    {n.label}
                    {n.id === "alerts" && !alertsOnPlan ? <span className="aw-tag ml-2">Pro and up</span> : null}
                  </div>
                  <div className="aw-small">{n.hint}</div>
                </td>
                <td className="w-24 text-right">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-[14px] text-ink">
                    <input type="checkbox" checked={prefs?.[n.id] ?? true} disabled={!prefs} onChange={(e) => prefs && set({ ...prefs, [n.id]: e.target.checked }, prefs)} />
                    {(prefs?.[n.id] ?? true) ? "On" : "Off"}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="aw-small">Alerts go out when visibility moves 5 points or more, unless an admin picked another size under Integrations → Slack alerts. Every email has an unsubscribe link.</p>
    </div>
  );
}
