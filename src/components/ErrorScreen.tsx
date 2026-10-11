import type { ReactNode } from "react";
import { Logo } from "./Logo";

/** The full-page message behind the 404 and error pages. */
export function ErrorScreen({ code, title, children, actions }: { code: string; title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <main className="aw-dotgrid flex min-h-screen items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <Logo size="md" />
        <div className="aw-frame aw-frame--shadow w-full">
          <div className="aw-frame__body flex flex-col items-center gap-3">
            <span className="aw-chip">{code}</span>
            <h1 className="aw-h3 mb-0!">{title}</h1>
            <div className="text-[14px] text-body">{children}</div>
            <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
