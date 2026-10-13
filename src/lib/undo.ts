"use client";

// One Undo for the whole app. Each change records how to take itself back (and redo itself).
// Ctrl or Cmd + Z undoes the last change, Ctrl + Shift + Z or Ctrl + Y redoes it, anywhere in the app.
// Text boxes keep their own typing undo, so the shortcut only reaches this list outside them.

export type Step = {
  /** What changed, in a few words: "removed a prompt". */
  label: string;
  undo: () => unknown;
  redo?: () => unknown;
  /** Changes with the same key a moment apart merge into one step, like typing in one cell. */
  key?: string;
  at?: number;
};

const past: Step[] = [];
const future: Step[] = [];
const listeners = new Set<(message: string) => void>();
let quiet = 0;
const MERGE_MS = 1500;
const say = (m: string) => listeners.forEach((fn) => fn(m));

/**
 * Run fn without recording what it changes, for work that records itself as one step
 * (a sheet saving many cells) and for undo and redo themselves. Only the synchronous part counts,
 * so changes record before their first await.
 */
export function quietly<T>(fn: () => T): T {
  quiet++;
  try {
    return fn();
  } finally {
    quiet--;
  }
}

export function recordUndo(step: Step) {
  if (quiet) return;
  const now = Date.now();
  const top = past[past.length - 1];
  if (step.key && top?.key === step.key && now - (top.at ?? 0) < MERGE_MS) {
    // Keep the first step's undo, which goes all the way back, and the newest redo.
    top.redo = step.redo;
    top.at = now;
  } else {
    past.push({ ...step, at: now });
    if (past.length > 100) past.shift();
  }
  future.length = 0;
}

export async function undoLast() {
  const s = past.pop();
  if (!s) return say("Nothing to undo");
  try {
    await quietly(s.undo);
    if (s.redo) future.push(s);
    say(`Undid ${s.label}`);
  } catch (e) {
    say(`Could not undo ${s.label}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function redoLast() {
  const s = future.pop();
  if (!s?.redo) return say("Nothing to redo");
  try {
    await quietly(s.redo);
    past.push(s);
    say(`Redid ${s.label}`);
  } catch (e) {
    say(`Could not redo ${s.label}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Hear what undo and redo did, for the message at the bottom of the screen. */
export function onUndoMessage(fn: (message: string) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** True when a key press belongs to a place with its own undo: a text box or a rich text editor. */
export function ownUndo(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el?.closest) return false;
  if (el.closest("[contenteditable=''], [contenteditable='true'], textarea")) return true;
  const input = el.closest("input");
  return Boolean(input && !["checkbox", "radio", "button", "submit", "range", "color", "file"].includes(input.type));
}
