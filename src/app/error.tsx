"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import Link from "next/link";
import { ErrorScreen } from "@/components/ErrorScreen";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <ErrorScreen
      code="Error"
      title="Something went wrong"
      actions={
        <>
          <button type="button" className="aw-btn aw-btn--primary" onClick={() => retry()}>
            Try again
          </button>
          <Link className="aw-btn aw-btn--secondary" href="/">
            Go home
          </Link>
        </>
      }
    >
      We&apos;ve been told about it. Try again, and if it keeps happening, email support@arrowsterr.com
      {error.digest ? <span className="mt-2 block font-mono text-[12px] text-muted">Ref {error.digest}</span> : null}
    </ErrorScreen>
  );
}
