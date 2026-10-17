"use client";

import type { RunAuth } from "@/lib/runner";
import type { View } from "@/lib/view";

/** The Agentic Writer. A stub: the writer build replaces this file. */
export function AgenticWriterPage({ view, auth, canEdit }: { view: View; auth: RunAuth; canEdit: boolean }) {
  void view;
  void auth;
  void canEdit;
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="aw-h2 mb-0!">Agentic Writer</h1>
    </header>
  );
}
