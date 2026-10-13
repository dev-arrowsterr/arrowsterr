"use client";

import { useEffect, useState } from "react";
import { onUndoMessage, ownUndo, redoLast, undoLast } from "@/lib/undo";

/** Ctrl or Cmd + Z anywhere in the app, and a short note at the bottom saying what it did. */
export function UndoKeys() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.defaultPrevented || ownUndo(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        void undoLast();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        void redoLast();
      }
    };
    window.addEventListener("keydown", key);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onUndoMessage((m) => {
      setMessage(m);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(""), 3000);
    });
    return () => {
      window.removeEventListener("keydown", key);
      off();
      clearTimeout(timer);
    };
  }, []);

  return message ? (
    <div className="aw-undo" role="status" aria-live="polite">
      {message}
    </div>
  ) : null;
}
