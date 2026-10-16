"use client";

import { useEffect, useState } from "react";
import { KIND_LABEL, PURPOSES, purposeOf, type OutreachTarget } from "@/lib/outreach";
import { BrandLogo } from "../BrandLogo";
import { favicon, SidePanel, Thinking } from "../ui";

/** Pick what the emails are for, and an optional note, then write one draft per target. */
export function CraftDialog({ targets, busy, onStart, onClose }: { targets: OutreachTarget[]; busy: boolean; onStart: (purpose: string, note: string) => void; onClose: () => void }) {
  const kinds = [...new Set(targets.map((t) => t.kind))];
  const options = PURPOSES.filter((p) => kinds.some((k) => p.kinds.includes(k)));
  const [purpose, setPurpose] = useState(options[0]?.id ?? "custom");
  const [note, setNote] = useState("");
  const p = purposeOf(purpose);
  const fits = targets.filter((t) => p?.kinds.includes(t.kind)).length;
  const noEmail = targets.filter((t) => p?.kinds.includes(t.kind) && !t.email).length;
  return (
    <SidePanel title={`Write ${targets.length === 1 ? "an email" : `${targets.length} emails`}`} kicker={kinds.map((k) => KIND_LABEL[k]).join(", ")} onClose={onClose} narrow>
      <fieldset className="flex flex-col gap-2">
        <legend className="aw-label mb-2">What is the email for?</legend>
        {options.map((o) => (
          <label key={o.id} className={`flex cursor-pointer items-start gap-3 border px-4 py-3 ${purpose === o.id ? "border-brand bg-brand-pale" : "border-rule hover:bg-surface-2"}`}>
            <input type="radio" name="purpose" checked={purpose === o.id} onChange={() => setPurpose(o.id)} className="mt-1 h-4 w-4 accent-[var(--aw-brand)]" />
            <span className="flex flex-col gap-0.5">
              <span className="text-[14px] font-medium text-ink">{o.label}</span>
              <span className="aw-small">{o.id === "custom" ? "Say what to ask for in the note below." : `For ${o.kinds.map((k) => KIND_LABEL[k].toLowerCase()).join(", ")}`}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="aw-label">{purpose === "custom" ? "What should the email ask for?" : "Anything to offer or mention (optional)"}</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} rows={3} placeholder="Like: offer a free Pro account, or mention our new study on AI search" className="aw-input" />
      </label>
      <p className="aw-small">
        {fits} of {targets.length} fit this purpose{noEmail ? `. ${noEmail} have no email yet, so you'll need to add one before sending` : ""}. Each draft uses 2 tasks.
      </p>
      <div className="flex gap-2">
        <button type="button" className="aw-btn aw-btn--accent" disabled={busy || !fits || (purpose === "custom" && !note.trim())} onClick={() => onStart(purpose, note.trim())}>
          {busy ? "Starting…" : `Write ${fits} ${fits === 1 ? "draft" : "drafts"}`}
        </button>
        <button type="button" className="aw-btn aw-btn--secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </SidePanel>
  );
}

const gmailLink = (t: OutreachTarget, subject: string, body: string) =>
  `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(t.email ?? "")}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/** Every draft in the list: pick one on the left, edit it on the right, then copy it, open it in Gmail or mark it sent. */
export function EmailsView({
  targets,
  canEdit,
  busy,
  onSave,
  onRewrite,
  onSent,
  onAddEmail,
}: {
  targets: OutreachTarget[];
  canEdit: boolean;
  busy: boolean;
  onSave: (t: OutreachTarget, subject: string, body: string) => Promise<void>;
  onRewrite: (t: OutreachTarget) => void;
  onSent: (t: OutreachTarget, undo: boolean) => void;
  onAddEmail: (t: OutreachTarget) => void;
}) {
  const [pick, setPick] = useState<string | null>(targets[0]?.id ?? null);
  const cur = targets.find((t) => t.id === pick) ?? targets[0];
  const [subject, setSubject] = useState(cur?.draft_subject ?? "");
  const [body, setBody] = useState(cur?.draft_body ?? "");
  const [copied, setCopied] = useState(false);
  const dirty = Boolean(cur) && (subject !== (cur?.draft_subject ?? "") || body !== (cur?.draft_body ?? ""));

  // Load the picked draft into the editor, and again when a rewrite lands.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubject(cur?.draft_subject ?? "");
    setBody(cur?.draft_body ?? "");
    setCopied(false);
  }, [cur?.id, cur?.drafted_at, cur?.draft_subject, cur?.draft_body]);

  if (!targets.length) return <p className="aw-small px-5 py-5">No emails yet. Select targets and click Write emails.</p>;

  const ready = targets.filter((t) => t.draft_status === "ready").length;
  return (
    <div className="flex flex-wrap">
      <nav aria-label="Drafts" className="flex w-full flex-col border-rule md:w-72 md:border-r">
        <span className="aw-small border-b border-rule-faint px-4 py-2.5">
          {ready} of {targets.length} ready
        </span>
        {targets.map((t) => (
          <button key={t.id} type="button" aria-current={t.id === cur?.id ? "true" : undefined} onClick={() => setPick(t.id)} className={`flex items-center justify-between gap-2 border-b border-rule-faint px-4 py-3 text-left ${t.id === cur?.id ? "bg-brand-pale" : "hover:bg-surface-2"}`}>
            <span className="flex min-w-0 items-center gap-2">
              {t.domain ? <BrandLogo src={favicon(t.domain)} name={t.name} size={16} /> : null}
              <span className="truncate text-[14px] font-medium text-ink">{t.name}</span>
            </span>
            <span className={`aw-status shrink-0 ${t.status === "sent" ? "aw-status--ranked" : t.draft_status === "ready" ? "aw-status--pending" : t.draft_status === "failed" ? "aw-status--missed" : "aw-status--warn"}`}>
              {t.status === "sent" ? "Sent" : t.draft_status === "ready" ? "Ready" : t.draft_status === "failed" ? "Failed" : "Writing"}
            </span>
          </button>
        ))}
      </nav>

      {cur ? (
        <div className="flex min-w-0 flex-[999_1_480px] flex-col">
          <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 border-b border-rule-faint px-5 py-4 text-[14px]">
            <span className="text-muted">To</span>
            <span className="flex items-center gap-2">
              {cur.email ? <span className="truncate text-ink">{cur.email}</span> : <span className="text-muted">No email yet</span>}
              {canEdit && !cur.email ? (
                <button type="button" className="aw-text-link text-[13px]" onClick={() => onAddEmail(cur)}>
                  Add email
                </button>
              ) : null}
            </span>
            <span className="text-muted">For</span>
            <span className="text-ink">{purposeOf(cur.draft_purpose)?.label ?? "–"}</span>
            {cur.draft_status === "ready" ? (
              <>
                <label htmlFor="draft-subject" className="text-muted">
                  Subject
                </label>
                <input id="draft-subject" value={subject} onChange={(e) => setSubject(e.target.value)} readOnly={!canEdit} maxLength={200} className="aw-input py-1.5! text-[14px]!" />
              </>
            ) : null}
          </div>

          {cur.draft_status === "pending" ? (
            <div className="p-5">
              <Thinking text={`Reading ${cur.name} and writing the email`} />
            </div>
          ) : cur.draft_status === "failed" ? (
            <div className="flex flex-col items-start gap-3 p-5">
              <p className="aw-error">{cur.draft_error ?? "The draft didn't finish."}</p>
              {canEdit ? (
                <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={busy} onClick={() => onRewrite(cur)}>
                  Try again
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <label htmlFor="draft-body" className="sr-only">
                Email
              </label>
              <textarea id="draft-body" value={body} onChange={(e) => setBody(e.target.value)} readOnly={!canEdit} rows={14} className="min-h-72 resize-y border-0 px-5 py-4 text-[15px] leading-relaxed text-ink outline-none" />
              {cur.draft_why ? (
                <p className="mx-5 mb-4 bg-brand-pale px-4 py-3 text-[13px] text-body">
                  <b className="font-medium text-ink">Why it&apos;s written this way: </b>
                  {cur.draft_why}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 border-t border-rule-faint px-5 py-3">
                {canEdit ? (
                  <>
                    <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={busy || !dirty} onClick={() => void onSave(cur, subject, body)}>
                      {dirty ? "Save changes" : "Saved"}
                    </button>
                    <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={busy} onClick={() => onRewrite(cur)}>
                      Rewrite
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="aw-btn aw-btn--secondary aw-btn--sm"
                  onClick={() => void navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).then(() => setCopied(true))}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
                <span className="flex-1" />
                {cur.email ? (
                  <a href={gmailLink(cur, subject, body)} target="_blank" rel="noopener noreferrer" className="aw-btn aw-btn--accent aw-btn--sm">
                    Open in Gmail
                  </a>
                ) : null}
                {canEdit ? (
                  <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" disabled={busy} onClick={() => onSent(cur, cur.status === "sent")}>
                    {cur.status === "sent" ? "Mark as not sent" : "Mark as sent"}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
