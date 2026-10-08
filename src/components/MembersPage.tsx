"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import {
  atLeast,
  createInvite,
  getUsage,
  listInvites,
  listMembers,
  removeMember,
  renameWorkspace,
  revokeInvite,
  setMemberRole,
  type Invite,
  type Member,
  type Role,
  type Usage,
  type Workspace,
} from "@/lib/db";

const ROLES: { id: Role; label: string; can: string }[] = [
  { id: "owner", label: "Owner", can: "Full control. Made the workspace." },
  { id: "admin", label: "Admin", can: "Invites people, changes roles, renames the workspace." },
  { id: "editor", label: "Editor", can: "Adds brands, edits prompts, runs checks." },
  { id: "viewer", label: "Viewer", can: "Sees the dashboard and prompts." },
];
const label = (r: Role) => ROLES.find((x) => x.id === r)?.label ?? r;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const inviteLink = (token: string) => `${window.location.origin}/?invite=${token}`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="aw-btn aw-btn--secondary aw-btn--sm"
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
      }
    >
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  const full = used >= limit;
  return (
    <div className="aw-card-stat flex flex-col gap-2">
      <span className="aw-small">{label}</span>
      <span className="aw-num text-[22px] font-medium text-ink">
        {used} <span className="text-[15px] font-normal text-muted">of {limit}</span>
      </span>
      <div
        className="h-2 overflow-hidden rounded-full bg-rule-faint"
        role="meter"
        aria-label={label}
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
      >
        <div className={`h-full ${full ? "bg-neg" : "bg-brand"}`} style={{ width: `${pct}%` }} />
      </div>
      {full ? <span className="text-[13px] font-medium text-neg">Limit reached</span> : null}
    </div>
  );
}

/** Workspace name, members and their roles, and invites. */
export function MembersPage({ sb, ws, userId, onChanged }: { sb: SupabaseClient; ws: Workspace; userId: string; onChanged: () => Promise<void> }) {
  const isAdmin = atLeast(ws.role, "admin");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [name, setName] = useState(ws.name);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [made, setMade] = useState<Invite | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async () => {
    try {
      setMembers(await listMembers(sb, ws.id));
      setUsage(await getUsage(sb, ws.id));
      if (isAdmin) setInvites(await listInvites(sb, ws.id));
    } catch (e) {
      setError(message(e));
    }
  }, [sb, ws.id, isAdmin]);

  useEffect(() => {
    // Loading from Supabase on first render is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function act(fn: () => Promise<unknown>, done?: string) {
    setError("");
    setSaved("");
    try {
      await fn();
      if (done) setSaved(done);
      await load();
    } catch (e) {
      setError(message(e));
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    await act(async () => {
      setMade(await createInvite(sb, ws.id, userId, email, role));
      setEmail("");
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <h1 className="aw-h2 mb-0!">Workspace & members</h1>
      {error ? <p className="aw-error">{error}</p> : null}
      {saved ? <p className="aw-callout text-[15px]!">{saved}</p> : null}

      <section className="flex flex-col gap-3">
        <label className="aw-label mb-0!" htmlFor="ws-name">
          Workspace name
        </label>
        {isAdmin ? (
          <form
            className="flex gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim())
                act(async () => {
                  await renameWorkspace(sb, ws.id, name.trim());
                  await onChanged();
                }, "Workspace renamed.");
            }}
          >
            <input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} className="aw-input" required />
            <button type="submit" className="aw-btn aw-btn--secondary" disabled={name.trim() === ws.name}>
              Save
            </button>
          </form>
        ) : (
          <p id="ws-name" className="text-[16px] text-ink">
            {ws.name}
          </p>
        )}
      </section>

      {usage ? (
        <section className="flex flex-col gap-3">
          <h2 className="aw-h4">Usage</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Meter label="Brands" used={usage.brands} limit={usage.brandLimit} />
            <Meter label="Prompts" used={usage.prompts} limit={usage.promptLimit} />
            <Meter label="AI answers today" used={usage.answersToday} limit={usage.answerLimit} />
          </div>
          <p className="aw-small">One AI answer is one prompt on one engine. The count resets at midnight UTC.</p>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="aw-h4">Members</h2>
        <div className="aw-table-wrap">
          <table className="aw-table aw-table--compact">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(members ?? []).map((m) => {
                const self = m.user_id === userId;
                const editable = isAdmin && m.role !== "owner";
                return (
                  <tr key={m.user_id}>
                    <td className="break-all">
                      {m.email ?? "Unknown"}
                      {self ? <span className="aw-small"> (you)</span> : null}
                    </td>
                    <td>
                      {editable ? (
                        <select
                          aria-label={`Role for ${m.email ?? "member"}`}
                          className="aw-select py-1!"
                          value={m.role}
                          onChange={(e) => act(() => setMemberRole(sb, ws.id, m.user_id, e.target.value as Role), "Role updated.")}
                        >
                          {ROLES.filter((r) => r.id !== "owner").map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="aw-tag">{label(m.role)}</span>
                      )}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {m.role === "owner" ? null : self ? (
                        <button
                          type="button"
                          className="aw-btn aw-btn--secondary aw-btn--sm"
                          onClick={() => {
                            if (confirm(`Leave ${ws.name}?`)) act(async () => {
                              await removeMember(sb, ws.id, userId);
                              await onChanged();
                            });
                          }}
                        >
                          Leave workspace
                        </button>
                      ) : isAdmin ? (
                        <button
                          type="button"
                          className="aw-btn aw-btn--secondary aw-btn--sm"
                          onClick={() => {
                            if (confirm(`Remove ${m.email ?? "this member"}?`)) act(() => removeMember(sb, ws.id, m.user_id), "Member removed.");
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {members === null ? (
                <tr>
                  <td colSpan={3} className="aw-small">
                    Loading...
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {isAdmin ? (
        <section className="flex flex-col gap-4">
          <h2 className="aw-h4">Invite someone</h2>
          <form onSubmit={invite} className="flex flex-col gap-3 sm:flex-row">
            <input
              type="email"
              aria-label="Email to invite"
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="aw-input"
            />
            <select aria-label="Role" className="aw-select sm:w-40" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.filter((r) => r.id !== "owner").map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <button type="submit" className="aw-btn aw-btn--primary">
              Create invite
            </button>
          </form>
          {made ? (
            <div className="aw-callout flex flex-col gap-3 text-[15px]!">
              <span>
                Send this link to {made.email}. They sign in or create an account with that email to join as {label(made.role)}.
              </span>
              <code className="break-all text-[13px]">{inviteLink(made.token)}</code>
              <div>
                <CopyButton text={inviteLink(made.token)} />
              </div>
            </div>
          ) : null}

          {invites.length ? (
            <div className="aw-table-wrap">
              <table className="aw-table aw-table--compact">
                <thead>
                  <tr>
                    <th>Pending invite</th>
                    <th>Role</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((i) => (
                    <tr key={i.id}>
                      <td className="break-all">{i.email}</td>
                      <td>
                        <span className="aw-tag">{label(i.role)}</span>
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <span className="inline-flex gap-2">
                          <CopyButton text={inviteLink(i.token)} />
                          <button
                            type="button"
                            className="aw-btn aw-btn--secondary aw-btn--sm"
                            onClick={() =>
                              act(async () => {
                                await revokeInvite(sb, i.id);
                                if (made?.id === i.id) setMade(null);
                              }, "Invite revoked.")
                            }
                          >
                            Revoke
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="aw-h4">Roles</h2>
        <ul className="aw-list aw-list--tight">
          {ROLES.map((r) => (
            <li key={r.id} className="text-[15px]!">
              <strong>{r.label}:</strong> {r.can}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
