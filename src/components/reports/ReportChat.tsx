"use client";

import { useEffect, useRef, useState } from "react";
import { describeChanges, type ChatChanges, type ChatReply, type ChatTurn } from "@/lib/reportChat";
import type { ReportDocument } from "@/lib/reportDoc";
import type { ReportRange } from "@/lib/reportRange";
import type { ReportTheme } from "@/lib/reportTheme";
import type { RunAuth } from "@/lib/runner";
import { Zippie } from "../Zippie";
import { errText, post } from "./reportApi";

// Zippie in the report editor (docs/reports.md, section 31.4): chat on the left, the report changes on the right.

type Message = ChatTurn & { done?: string[] };
const SAVE_KEY = (id: string) => `arrowsterr.reportchat.${id}`;
const SUGGESTIONS = ["Write the AI summary", "Make it a one-pager", "Use my Brand Kit", "Compare with last year", "Make it dark and premium"];

function readChat(id: string): Message[] {
  try {
    const v = JSON.parse(localStorage.getItem(SAVE_KEY(id)) || "[]");
    return Array.isArray(v) ? v.slice(-40) : [];
  } catch {
    return [];
  }
}

export function ReportChat({
  auth,
  reportId,
  brand,
  doc,
  range,
  name,
  title,
  theme,
  canEdit,
  onChanges,
}: {
  auth: RunAuth;
  reportId: string;
  brand: string;
  doc: ReportDocument;
  range: ReportRange;
  name: string;
  title: string;
  theme: ReportTheme;
  canEdit: boolean;
  /** Put Zippie's changes on the report. Resolves once they are on. */
  onChanges: (c: ChatChanges) => Promise<void>;
}) {
  const [messages, setMessages] = useState<Message[]>(() => readChat(reportId));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SAVE_KEY(reportId), JSON.stringify(messages.slice(-40)));
    } catch {
      // Storage blocked. The chat lasts until the tab closes.
    }
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [messages, reportId]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setDraft("");
    setError("");
    setBusy(true);
    const history = messages.map(({ role, text: t }) => ({ role, text: t }));
    setMessages((m) => [...m, { role: "you", text: message }]);
    try {
      const out = await post<ChatReply>(auth, "/api/reports/chat", { reportId, message, history, doc, range, name, title, theme });
      await onChanges(out.changes);
      setMessages((m) => [...m, { role: "zippie", text: out.reply, done: describeChanges(out.changes) }]);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="aw-chat" aria-label="Chat with Zippie">
      <div ref={list} className="aw-chat__list">
        <div className="aw-chat__msg aw-chat__msg--zippie">
          <Zippie size={28} mood="happy" />
          <p>I filled this report with {brand || "your brand"}&apos;s numbers. Ask me to change blocks, dates or the look, or to explain a number.</p>
        </div>
        {messages.map((m, i) =>
          m.role === "you" ? (
            <p key={i} className="aw-chat__msg aw-chat__msg--you">
              {m.text}
            </p>
          ) : (
            <div key={i} className="aw-chat__msg aw-chat__msg--zippie">
              <Zippie size={28} mood="idle" />
              <div className="flex min-w-0 flex-col gap-2">
                {m.done?.length ? (
                  <ul className="aw-chat__done" aria-label="What changed">
                    {m.done.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                ) : null}
                <p>{m.text}</p>
              </div>
            </div>
          ),
        )}
        {busy ? (
          <div className="aw-chat__msg aw-chat__msg--zippie">
            <Zippie size={28} mood="thinking" />
            <p className="text-muted">Working on it…</p>
          </div>
        ) : null}
      </div>
      {error ? <p className="aw-error mx-3">{error}</p> : null}
      {canEdit ? (
        <div className="aw-chat__foot">
          <div className="aw-chat__chips">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="aw-chat__chip" disabled={busy} onClick={() => void send(s)}>
                {s}
              </button>
            ))}
          </div>
          <form
            className="aw-chat__box"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <textarea
              value={draft}
              rows={2}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              placeholder="Ask Zippie anything…"
              aria-label="Message Zippie"
              maxLength={2000}
            />
            <button type="submit" className="aw-btn aw-btn--primary aw-btn--sm" disabled={busy || !draft.trim()} aria-label="Send">
              ↑
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
