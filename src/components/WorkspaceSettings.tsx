"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import { Dropdown } from "./Pickers";
import { recordUndo } from "@/lib/undo";
import { atLeast, getWorkspaceSettings, saveWorkspaceSettings, type AiSettings, type PlanUsage, type Workspace, type WorkspaceSettings } from "@/lib/db";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const NOT_RUN = "These settings turn on once supabase/034_settings.sql has been run in Supabase → SQL Editor.";
/** Shared email services. A workspace can't let everyone at one of these in. */
const SHARED_EMAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.de",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "hey.com",
  "fastmail.com",
  "web.de",
  "orange.fr",
  "free.fr",
  "libero.it",
]);

/** The workspace's settings, loaded once. undefined while loading, null before the migration. */
function useSettings(sb: SupabaseClient, ws: Workspace) {
  const [s, setS] = useState<WorkspaceSettings | null | undefined>(undefined);
  useEffect(() => {
    getWorkspaceSettings(sb, ws.id).then(setS);
  }, [sb, ws.id]);
  return [s, setS] as const;
}

function Status({ error, saved }: { error: string; saved: string }) {
  if (error) return <p className="aw-error">{error}</p>;
  if (saved) return <p className="aw-callout text-[15px]!">{saved}</p>;
  return null;
}

/** The time zone dates and times use across the workspace. */
export function TimezoneSetting({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const [s, setS] = useSettings(sb, ws);
  const [error, setError] = useState("");
  const isAdmin = atLeast(ws.role, "admin");
  const zones = useMemo(() => {
    const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
    return all.map((z) => ({ id: z, label: z.replace(/_/g, " ") }));
  }, []);
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const value = s?.timezone ?? "";

  async function save(next: string, was: string) {
    setError("");
    try {
      await saveWorkspaceSettings(sb, ws.id, { timezone: next || null });
      setS((x) => (x ? { ...x, timezone: next || null } : x));
      recordUndo({
        label: "the time zone change",
        undo: () => save(was, next),
        redo: () => save(next, was),
      });
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <section className="flex max-w-3xl flex-col gap-3">
      <span className="aw-label mb-0!">Time zone</span>
      {s === null ? (
        <p className="aw-small">{NOT_RUN}</p>
      ) : (
        <>
          <div className="max-w-sm">
            <Dropdown
              label="Time zone"
              value={value}
              disabled={!isAdmin || s === undefined}
              placeholder={`Your computer's (${browser.replace(/_/g, " ")})`}
              className="aw-dropdown--field w-full"
              options={[
                {
                  id: "",
                  label: `Your computer's (${browser.replace(/_/g, " ")})`,
                },
                ...zones,
              ]}
              onChange={(z) => save(z, value)}
            />
          </div>
          <p className="aw-small">Used for dates in Background actions and exports.</p>
        </>
      )}
      {error ? <p className="aw-error">{error}</p> : null}
    </section>
  );
}

const AI_FIELDS: {
  id: keyof AiSettings;
  label: string;
  hint: string;
  rows: number;
}[] = [
  {
    id: "about",
    label: "About the business",
    hint: "What you sell, who you are, what makes you different. Facts the AI can use.",
    rows: 4,
  },
  {
    id: "audience",
    label: "Who you write for",
    hint: "The readers and buyers. Their job, their problems, how much they know.",
    rows: 3,
  },
  {
    id: "voice",
    label: "How you write",
    hint: "Tone, style and rules. For example: short sentences, US spelling, no jargon.",
    rows: 3,
  },
  {
    id: "avoid",
    label: "Never do or say",
    hint: "Claims, words, competitors or topics the AI must stay away from.",
    rows: 3,
  },
];

/** Notes the AI reads before it writes a brief or helps in the writer. */
export function AiSettingsPage({ sb, ws }: { sb: SupabaseClient; ws: Workspace }) {
  const [s, setS] = useSettings(sb, ws);
  const [draft, setDraft] = useState<AiSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const isAdmin = atLeast(ws.role, "admin");
  const now = draft ?? s?.ai_settings ?? {};
  const changed = Boolean(draft) && AI_FIELDS.some((f) => (draft?.[f.id] ?? "") !== (s?.ai_settings[f.id] ?? ""));

  async function save(next: AiSettings, was: AiSettings, note: string) {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await saveWorkspaceSettings(sb, ws.id, { ai_settings: next });
      setS((x) => (x ? { ...x, ai_settings: next } : x));
      setDraft(null);
      setSaved(note);
      recordUndo({
        label: "the AI notes change",
        undo: () => save(was, next, "AI notes put back."),
        redo: () => save(next, was, "AI notes saved."),
      });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  if (s === null) return <p className="aw-callout max-w-xl text-[15px]!">{NOT_RUN}</p>;
  return (
    <form
      className="flex max-w-2xl flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft && s) save(draft, s.ai_settings, "AI notes saved. Briefs and the writer use them from now on.");
      }}
    >
      <p className="text-[15px] text-body">
        The AI reads these notes before it writes a content brief or helps you in the writer. They add to each website&apos;s brand guideline, and win when the two disagree.
      </p>
      <Status error={error} saved={saved} />
      {AI_FIELDS.map((f) => (
        <div key={f.id}>
          <label className="aw-label" htmlFor={`ai-${f.id}`}>
            {f.label}
          </label>
          <textarea
            id={`ai-${f.id}`}
            className="aw-input min-h-0!"
            rows={f.rows}
            maxLength={2000}
            disabled={!isAdmin || s === undefined}
            value={now[f.id] ?? ""}
            onChange={(e) => setDraft({ ...now, [f.id]: e.target.value })}
            placeholder={f.hint}
          />
        </div>
      ))}
      {isAdmin ? (
        <div className="flex gap-3">
          <button type="submit" className="aw-btn aw-btn--primary" disabled={busy || !changed}>
            Save
          </button>
          {changed ? (
            <button type="button" className="aw-btn aw-btn--secondary" onClick={() => setDraft(null)}>
              Discard changes
            </button>
          ) : null}
        </div>
      ) : (
        <p className="aw-small">Only admins can change these.</p>
      )}
    </form>
  );
}

/** Let people with a company email join on their own. */
export function AccessSettings({ sb, ws, email }: { sb: SupabaseClient; ws: Workspace; email: string }) {
  const [s, setS] = useSettings(sb, ws);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const isAdmin = atLeast(ws.role, "admin");
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  const shared = SHARED_EMAIL.has(domain);
  const on = Boolean(s?.allowed_domain);

  async function save(patch: Partial<WorkspaceSettings>, note: string, undo?: Partial<WorkspaceSettings>) {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await saveWorkspaceSettings(sb, ws.id, patch);
      setS((x) => (x ? { ...x, ...patch } : x));
      setSaved(note);
      if (undo)
        recordUndo({
          label: "the access change",
          undo: () => save(undo, "Access put back."),
          redo: () => save(patch, note),
        });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  if (s === null) return <p className="aw-callout max-w-xl text-[15px]!">{NOT_RUN}</p>;
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Status error={error} saved={saved} />
      <section className="flex flex-col gap-4 rounded-aw border border-rule p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="aw-h4">Join with a company email</h3>
            <p className="aw-small mt-1">
              {shared
                ? `You sign in with ${domain}, which anyone can sign up for. An admin with a company email can turn this on.`
                : `Anyone who signs up with an @${domain} email joins this workspace on their own, without an invite. They still need a free seat.`}
            </p>
          </div>
          {isAdmin && !shared ? (
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[14px] text-ink">
              <input
                type="checkbox"
                checked={on}
                disabled={busy || s === undefined}
                onChange={(e) =>
                  save(
                    e.target.checked ? { allowed_domain: domain } : { allowed_domain: null },
                    e.target.checked ? `People with an @${domain} email can now join.` : "Only invited people can join now.",
                    {
                      allowed_domain: s?.allowed_domain ?? null,
                    },
                  )
                }
              />
              {on ? "On" : "Off"}
            </label>
          ) : null}
        </div>
        {on && s ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-rule-faint pt-4">
            <span className="text-[14px] text-body">
              People from <strong className="text-ink">@{s.allowed_domain}</strong> join as
            </span>
            <Dropdown<"viewer" | "editor">
              label="Role for people who join"
              className="aw-dropdown--sm"
              value={s.join_role}
              disabled={!isAdmin || busy}
              options={[
                { id: "viewer", label: "Viewer" },
                { id: "editor", label: "Editor" },
              ]}
              onChange={(r) => save({ join_role: r }, `New people join as ${r === "editor" ? "Editors" : "Viewers"}.`, { join_role: s.join_role })}
            />
          </div>
        ) : null}
      </section>
      {!isAdmin ? <p className="aw-small">Only admins can change who gets in.</p> : null}
      <section className="flex flex-col gap-2">
        <h3 className="aw-h4">Single sign-on (SAML)</h3>
        <p className="aw-small">
          Sign in through Okta, Microsoft Entra or Google Workspace comes with Enterprise. Write to <a href="mailto:sales@arrowsterr.com">sales@arrowsterr.com</a> to set it up.
        </p>
      </section>
    </div>
  );
}

/** How long Arrowsterr keeps each kind of data. */
export function RetentionSettings({ plan }: { plan: PlanUsage | null }) {
  const days = plan?.limits.historyDays;
  const span = days ? (days >= 365 ? `${Math.round(days / 365)} year${days >= 730 ? "s" : ""}` : `${days} days`) : null;
  const rows: [string, string][] = [
    [
      "AI answers and visibility history",
      span
        ? `Charts and tables reach back ${span} on the ${plan?.name} plan. Older results stay saved and show again on a plan with longer history.`
        : "Charts reach back as far as your plan allows. Older results stay saved.",
    ],
    ["Prompts, topics and competitors", "Kept until you remove them or the brand."],
    ["Content Plan, briefs and drafts", "Kept until you delete them."],
    ["Keyword research and bulk analyses", "Saved runs are kept until you delete them."],
    ["Members and invites", "Kept while the person is in the workspace. Removing someone ends their access right away."],
  ];
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="aw-table-wrap">
        <table className="aw-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>How long we keep it</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([what, how]) => (
              <tr key={what}>
                <td className="font-medium whitespace-nowrap text-ink">{what}</td>
                <td>{how}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="flex flex-col gap-2">
        <h3 className="aw-h4">Removing data</h3>
        <ul className="aw-list aw-list--tight">
          <li className="text-[15px]!">Removing a brand deletes all of its answers and history.</li>
          <li className="text-[15px]!">
            <span>
              To delete the whole workspace or your account, write to <a href="mailto:support@arrowsterr.com">support@arrowsterr.com</a> from your account email.
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
