"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Shown when the root layout itself fails. It renders its own page, so the app's CSS is not here: styles are inline.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#F8F8FF", color: "#061B44", fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        <title>Something went wrong · Arrowsterr</title>
        <main style={{ maxWidth: 420, margin: 16, padding: 32, textAlign: "center", background: "#fff", borderRadius: 8, boxShadow: "0 0 0 1px #E6E8F0" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700 }}>Something went wrong</h1>
          <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.6, color: "#46557A" }}>
            We&apos;ve been told about it. Try again, and if it keeps happening, email support@arrowsterr.com
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ height: 36, padding: "0 16px", border: 0, borderRadius: 6, background: "#0943B0", color: "#fff", font: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
          {error.digest ? <p style={{ margin: "16px 0 0", fontSize: 12, color: "#5C6B89", fontFamily: "ui-monospace, Menlo, monospace" }}>Ref {error.digest}</p> : null}
        </main>
      </body>
    </html>
  );
}
