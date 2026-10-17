"use client";

import { useEffect, useState } from "react";
import type { RunAuth } from "@/lib/runner";
import { Zippie } from "./Zippie";
import { ZippiePage, type ZippieWhere } from "./ZippiePage";

/**
 * Ask Zippie, on every page: a round button in the bottom-right corner that opens Zippie's chat over the page.
 * The chat loads on first open and then stays mounted, so a reply keeps streaming while the panel is closed.
 */
export function ZippieWidget({ auth, canEdit, where, open, onOpen }: { auth: RunAuth; canEdit: boolean; where: ZippieWhere; open: boolean; onOpen: (open: boolean) => void }) {
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onOpen(false);
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onOpen]);

  return (
    <div className="print:hidden">
      {open ? null : (
        <button type="button" className="aw-zippie-fab" onClick={() => onOpen(true)} aria-label="Ask Zippie" title="Ask Zippie">
          <Zippie size={34} mood="idle" />
        </button>
      )}
      {seen ? (
        <div className={open ? "aw-zippie-panel" : "hidden"} role="dialog" aria-label="Zippie">
          <ZippiePage auth={auth} canEdit={canEdit} compact where={where} onClose={() => onOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
